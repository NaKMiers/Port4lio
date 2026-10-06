import 'server-only'

import mongoose from 'mongoose'

import type { IndexingSummary } from '@/lib/blog/index-status-badge'
import { postUrl } from '@/lib/blog/seo'
import { connectDatabase } from '@/lib/mongodb'
import {
  inspectUrl,
  parseServiceAccount,
  SearchConsoleError,
  submitSitemap,
  type ServiceAccount,
} from '@/lib/search-console'
import { resolveSiteOrigin } from '@/lib/seo'
import { PostModel, type PostIndexStatus } from '@/models/Post'
import {
  SEARCH_CONSOLE_STATE_ID,
  SearchConsoleStateModel,
  type SearchConsoleStateDocument,
  type SitemapTrigger,
} from '@/models/SearchConsoleState'

/**
 * Google index status for blog posts - the one service behind the board's Re-check, Check all
 * and Resubmit sitemap, and the publish hook (`sitemap-resubmit.ts`).
 *
 * ```
 *   getIndexingConfig()   env + origin ──▶ { configured, problem }   never throws, no secrets out
 *
 *   inspectPost(id)       config ──▶ 503 unconfigured | bad_config
 *                         post   ──▶ 404 not_found | 409 not_published
 *                         Google ──▶ ok:   $set every result field (null if absent), checkedAt,
 *                                          $unset lastError
 *                                    fail: $set lastError, lastErrorAt only (prior result kept)
 *                         write filter { _id, status: 'published' }, timestamps: false
 *                                    no match (archived mid-call) ──▶ 409 not_published
 *
 *   resubmitSitemap(t)    config ──▶ 503 · Google ──▶ SearchConsoleState (ok clears lastError)
 * ```
 *
 * ## Why the post write filters on status
 *
 * The Google call can take up to 15s. If the owner archives or deletes the post meanwhile,
 * an unconditional write would recreate `indexStatus` on a post that left `published` - and
 * on re-publish the board would show an "Indexed" from before Google saw the URL 404. The
 * filter makes that write miss instead.
 *
 * ## Why `timestamps: false`
 *
 * `updatedAt` is the editor's stale-save check (R9), illustrate-run's publish fence and the
 * board's sort key. A status check is bookkeeping, not an edit, and must move none of them.
 */

export type IndexingCode = 'unconfigured' | 'bad_config'

export type IndexingConfig =
  | {
      configured: true
      problem: null
      account: ServiceAccount
      siteUrl: string
      origin: string
    }
  | { configured: false; problem: string; code: IndexingCode }

type Failure = {
  ok: false
  status: number
  error: string
  extra?: Record<string, unknown>
}
type Result<T> = { ok: true; value: T } | Failure

const fail = (
  status: number,
  error: string,
  extra?: Record<string, unknown>
): Failure => ({ ok: false, status, error, extra })

/** Does the property cover this origin? Catches www vs apex and preview hosts before Google does. */
export function originInProperty(origin: string, siteUrl: string): boolean {
  if (siteUrl.startsWith('sc-domain:')) {
    const domain = siteUrl.slice('sc-domain:'.length).toLowerCase()
    let host: string
    try {
      host = new URL(origin).hostname.toLowerCase()
    } catch {
      return false
    }
    return host === domain || host.endsWith(`.${domain}`)
  }
  return `${origin.replace(/\/$/, '')}/`.startsWith(siteUrl)
}

export function getIndexingConfig(): IndexingConfig {
  const rawKey = process.env.GSC_SERVICE_ACCOUNT_JSON?.trim()
  const siteUrl = process.env.GSC_SITE_URL?.trim()
  if (!rawKey || !siteUrl)
    return {
      configured: false,
      code: 'unconfigured',
      problem:
        'Search Console is not set up. Set GSC_SERVICE_ACCOUNT_JSON and GSC_SITE_URL - see .env.example.',
    }

  const parsed = parseServiceAccount(rawKey)
  if (!parsed.ok)
    return { configured: false, code: 'bad_config', problem: parsed.problem }

  if (!siteUrl.startsWith('sc-domain:') && !/^https?:\/\/.+\/$/.test(siteUrl))
    return {
      configured: false,
      code: 'bad_config',
      problem:
        'GSC_SITE_URL must be the exact property id: sc-domain:example.com, or https://example.com/ with the trailing slash.',
    }

  let origin: string
  try {
    origin = resolveSiteOrigin().replace(/\/$/, '')
  } catch (error) {
    return {
      configured: false,
      code: 'bad_config',
      problem:
        error instanceof Error
          ? error.message
          : 'The site origin could not be resolved.',
    }
  }

  if (!originInProperty(origin, siteUrl))
    return {
      configured: false,
      code: 'bad_config',
      problem: `The site origin ${origin} is not inside the Search Console property ${siteUrl}. Set NEXT_PUBLIC_SITE_URL to the property's origin.`,
    }

  return {
    configured: true,
    problem: null,
    account: parsed.account,
    siteUrl,
    origin,
  }
}

export function indexingSummary(): IndexingSummary {
  const config = getIndexingConfig()
  return { configured: config.configured, problem: config.problem }
}

function configFailure(
  config: Extract<IndexingConfig, { configured: false }>
): Failure {
  return fail(503, config.problem, { code: config.code })
}

export async function inspectPost(
  id: string
): Promise<Result<PostIndexStatus | null>> {
  const config = getIndexingConfig()
  if (!config.configured) return configFailure(config)

  if (!mongoose.Types.ObjectId.isValid(id))
    return fail(404, 'Post not found.', { code: 'not_found' })

  await connectDatabase()
  const post = await PostModel.findById(id).select('slug status').lean()
  if (!post) return fail(404, 'Post not found.', { code: 'not_found' })
  if (post.status !== 'published')
    return fail(
      409,
      'Only published posts can be checked - Google cannot index the others.',
      { code: 'not_published' }
    )

  const filter = { _id: post._id, status: 'published' as const }
  const options = {
    returnDocument: 'after' as const,
    timestamps: false,
    projection: { indexStatus: 1 },
  }
  const notPublished = fail(
    409,
    'This post stopped being published while it was being checked.',
    { code: 'not_published' }
  )

  try {
    const fields = await inspectUrl(
      config.account,
      config.siteUrl,
      postUrl(config.origin, post.slug)
    )
    const $set: Record<string, unknown> = {
      'indexStatus.checkedAt': new Date(),
    }
    for (const [key, value] of Object.entries(fields))
      $set[`indexStatus.${key}`] = value
    const updated = await PostModel.findOneAndUpdate(
      filter,
      {
        $set,
        $unset: { 'indexStatus.lastError': 1, 'indexStatus.lastErrorAt': 1 },
      },
      options
    ).lean()
    if (!updated) return notPublished
    return { ok: true, value: updated.indexStatus ?? null }
  } catch (error) {
    if (!(error instanceof SearchConsoleError)) throw error
    const updated = await PostModel.findOneAndUpdate(
      filter,
      {
        $set: {
          'indexStatus.lastError': error.message.slice(0, 500),
          'indexStatus.lastErrorAt': new Date(),
        },
      },
      options
    ).lean()
    if (!updated) return notPublished
    return fail(error.status, error.message, {
      code: error.code,
      indexStatus: updated.indexStatus ?? null,
    })
  }
}

/** A fixed-_id upsert can race itself on first insert; Mongo does not retry it. Once is enough. */
async function writeSitemapState(update: Record<string, unknown>) {
  const run = () =>
    SearchConsoleStateModel.findOneAndUpdate(
      { _id: SEARCH_CONSOLE_STATE_ID },
      update,
      { returnDocument: 'after' as const, upsert: true }
    ).lean()
  try {
    return await run()
  } catch (error) {
    if ((error as { code?: number }).code !== 11000) throw error
    return run()
  }
}

export async function resubmitSitemap(
  trigger: SitemapTrigger
): Promise<Result<SearchConsoleStateDocument | null>> {
  const config = getIndexingConfig()
  if (!config.configured) return configFailure(config)

  await connectDatabase()
  try {
    await submitSitemap(
      config.account,
      config.siteUrl,
      `${config.origin}/sitemap.xml`
    )
    const sitemap = await writeSitemapState({
      $set: { lastSubmittedAt: new Date(), lastTrigger: trigger },
      $unset: { lastError: 1, lastErrorAt: 1 },
    })
    return { ok: true, value: sitemap }
  } catch (error) {
    if (!(error instanceof SearchConsoleError)) throw error
    const sitemap = await writeSitemapState({
      $set: {
        lastError: error.message.slice(0, 500),
        lastErrorAt: new Date(),
        lastTrigger: trigger,
      },
    })
    return fail(error.status, error.message, { code: error.code, sitemap })
  }
}

/** The board's header state. A failed read costs the marker, never the board. */
export async function readSitemapState(): Promise<SearchConsoleStateDocument | null> {
  try {
    await connectDatabase()
    return await SearchConsoleStateModel.findById(
      SEARCH_CONSOLE_STATE_ID
    ).lean()
  } catch (error) {
    console.error(
      '[blog] search console state unavailable - board loads without it',
      error
    )
    return null
  }
}
