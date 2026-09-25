import { unstable_cache } from 'next/cache'

import { connectDatabase } from '@/lib/mongodb'
import { PROFILE_DOCUMENT_ID, ProfileModel } from '@/models/Profile'
import type { PublicProfile } from './profile-public'
import { PUBLIC_PROFILE_PROJECTION, toPublicProfile } from './profile-public'

import {
  readPublishedResumeSource,
  type PublishedResumeSource,
} from '@/lib/cv/cv-service'
import { makeEmptyProfile, normalizeProfile } from './profile'

export const PUBLIC_PROFILE_CACHE_TAG = 'public-profile'
const PUBLIC_PROFILE_REVALIDATE_SECONDS = 60

class PublicProfileDataError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'PublicProfileDataError'
  }
}

/**
 * Reads the singleton profile with the public field projection applied at the query, so
 * private fields never enter this process. See `profile-public.ts` for the allowlist.
 */
async function readPublicProfileDocument(): Promise<Record<
  string,
  unknown
> | null> {
  try {
    await connectDatabase()
    const doc = await ProfileModel.findById(PROFILE_DOCUMENT_ID)
      .select(PUBLIC_PROFILE_PROJECTION)
      .lean()
    return doc ? (doc as Record<string, unknown>) : null
  } catch (error) {
    console.error('Failed to load public profile from MongoDB.', error)
    throw new PublicProfileDataError(
      'Failed to load public profile from MongoDB.',
      { cause: error }
    )
  }
}

async function loadPublicProfileUncached(): Promise<PublicProfile> {
  const doc = await readPublicProfileDocument()
  if (!doc) return toPublicProfile(makeEmptyProfile())

  return toPublicProfile(normalizeProfile(doc))
}

/**
 * The uncached read, exported for the blog and for nothing else.
 *
 * D3 forbids `unstable_cache` in the blog read path, so `loadPublicProfile` below cannot be
 * used there. That is not a performance objection - it is that the blog's freshness story is
 * route-segment ISR plus `revalidatePath` with a literal path, and `revalidatePath` does not
 * touch an `unstable_cache` entry. A post page reading through that cache could clear its ISR
 * shell and still render a stale author name, with nothing to invalidate it but a timer.
 *
 * The blog needs this at all because its JSON-LD must carry a full inline `Person` node:
 * `personEntityId()` returns only a string `@id`, and the node itself is built once in
 * `buildPortfolioJsonLdGraph` and rendered only under `(me)`. A post emitting a bare `@id`
 * reference would emit an `author` with no `name` - a required property - so every post
 * needs the real fields.
 *
 * The cost is one indexed read of a singleton document per post render, and post pages are
 * ISR-cached for 300 seconds, so it is one read per post per five minutes.
 */
export { loadPublicProfileUncached }

export const loadPublicProfile = unstable_cache(
  loadPublicProfileUncached,
  ['public-profile'],
  {
    revalidate: PUBLIC_PROFILE_REVALIDATE_SECONDS,
    tags: [PUBLIC_PROFILE_CACHE_TAG],
  }
)

async function loadPublishedResumeUncached(): Promise<PublishedResumeSource> {
  try {
    return await readPublishedResumeSource()
  } catch (error) {
    console.error('Failed to load resume from MongoDB.', error)
    throw new PublicProfileDataError('Failed to load resume from MongoDB.', {
      cause: error,
    })
  }
}

/**
 * The published CV, for `/cv` only (multi-cv-plan.md, "Read paths").
 *
 * ```
 *   loadPublishedResume ──▶ cv-service.readPublishedResumeSource
 *        ├─ findPublished()   the CV with the latest publishedAt ──▶ its resume
 *        ├─ none yet          (the CV tab never opened since deploy) ──▶ profile.resume, the
 *        │                    legacy block, or undefined ──▶ deriveResume prints the seed
 *        └─ + profile.avatar  the photo fallback
 * ```
 *
 * Cached under `PUBLIC_PROFILE_CACHE_TAG`, which `cv-service` expires (`{ expire: 0 }`) after
 * every Save CV and Publish, so the first full load of `/cv` after a publish is the new CV.
 * It never migrates: a public read does not write, so until the owner opens the CV tab `/cv`
 * prints exactly what it printed before multi-CV shipped.
 *
 * Kept off the public profile allowlist on purpose: `/cv` renders these contact details
 * as a page - as it always has - but they are never served as machine-readable JSON to
 * the public, which is what makes them cheap to harvest at scale. `avatar` is on the
 * allowlist already, so including it here exposes nothing new.
 *
 * The one machine-readable exception is token-gated: the site MCP's `get_profile`
 * (section `resume`, via `profile-sections.ts`) and `get_me` hand the published CV, contact
 * details included, to a `p4_` agent token holding `read`. That is the owner's own agent
 * reading the owner's own CV, and it reveals nothing `/cv` does not already publish
 * (docs/designs/mcp/mcp.md premise 5, mcp-plan.md C7). No public route serves it as JSON,
 * and no CV but the published one is ever served at all.
 */
export const loadPublishedResume = unstable_cache(
  loadPublishedResumeUncached,
  ['public-resume'],
  {
    revalidate: PUBLIC_PROFILE_REVALIDATE_SECONDS,
    tags: [PUBLIC_PROFILE_CACHE_TAG],
  }
)

/** Its own query - `updatedAt` is not on the public projection. */
async function getPublicProfileUpdatedAtUncached(): Promise<Date | null> {
  try {
    await connectDatabase()
    const doc = await ProfileModel.findById(PROFILE_DOCUMENT_ID)
      .select('updatedAt')
      .lean()
    const raw = (doc as Record<string, unknown> | null)?.updatedAt
    if (raw instanceof Date) return raw
    if (typeof raw === 'string' || typeof raw === 'number') return new Date(raw)
    return null
  } catch (error) {
    console.error(
      'Failed to load public profile timestamp from MongoDB.',
      error
    )
    throw new PublicProfileDataError(
      'Failed to load public profile timestamp from MongoDB.',
      {
        cause: error,
      }
    )
  }
}

export const getPublicProfileUpdatedAt = unstable_cache(
  getPublicProfileUpdatedAtUncached,
  ['public-profile-updated-at'],
  {
    revalidate: PUBLIC_PROFILE_REVALIDATE_SECONDS,
    tags: [PUBLIC_PROFILE_CACHE_TAG],
  }
)
