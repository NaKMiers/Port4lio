import mongoose from 'mongoose'
import { NextResponse, type NextRequest } from 'next/server'

import { jsonError } from '@/lib/api-response'
import { GenerationRunError, runGeneration } from '@/lib/blog/generate-run'
import { normaliseSpec } from '@/lib/blog/generation-fields'
import { connectDatabase } from '@/lib/mongodb'
import {
  BLOG_GENERATE_LIMIT,
  checkRateLimit,
  clientIpFrom,
} from '@/lib/rate-limit'
import { readJsonBody } from '@/lib/read-json-body'
import { requireOwner } from '@/lib/require-owner'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Longer than any other route here, because the work is a model call plus a Shiki pass.
 *
 * A 2000-word post from a thinking model runs past a minute on its own, and `renderMarkdown`
 * adds the ~5.5s Shiki bootstrap on a cold process. The client's `LLM_TIMEOUT` is 180s and
 * this is 300 so the platform never cuts the request off before our own timeout produces a
 * message that says what happened.
 */
export const maxDuration = 300

/** The spec is a couple of dozen short fields. 32KiB is generous for that and small for anything else. */
const MAX_BODY_BYTES = 32 * 1024

/**
 * [POST] /api/admin/blog/generate - write a post with a model and save it as archived.
 *
 * ```
 *   requireOwner ──▶ 401
 *        ▼
 *   connectDatabase ──▶ 503
 *        ▼
 *   checkRateLimit(BLOG_GENERATE_LIMIT) ──▶ 429    10 per 10 min: this one costs money
 *        ▼
 *   readJsonBody ──▶ 413 / 400
 *        ▼
 *   normaliseSpec          unknown keys and options dropped, reported as warnings
 *        ▼
 *   kinds + series + published slugs        the closed sets the model must choose from
 *        ▼
 *   chatCompletion ──▶ 502 / 504            LlmError carries a message fit to show
 *        ▼
 *   parseGeneratedDraft ──▶ 422             nothing the model said is trusted
 *        ▼
 *   unique slug · pillar guard · renderMarkdown
 *        ▼
 *   PostModel.create({ status: 'archived' })        ← never 'published'
 * ```
 *
 * ## Why a generated post is created `archived` and not `draft`
 *
 * It is the state the owner asked for, and it is also the right one. `archived` means "not
 * public, and not something I am in the middle of writing" - which is exactly what a post
 * nobody has read yet is. A board full of drafts is a board where the generated ones are
 * indistinguishable from the half-finished real ones, and the whole point of the archive
 * default is that publishing stays a separate, deliberate press.
 *
 * The cost is real and worth stating: `archived -> draft` is refused by
 * `PATCH /api/admin/blog/[id]`, so a generated post can never become a draft. It can be
 * edited and published from where it is, which is the path that matters, but it will not
 * join the drafts list.
 *
 * ## Why nothing here is revalidated
 *
 * An archived post has no public surface. `/blog/<slug>` 404s for it, the sitemap and RSS
 * filter on `status: 'published'`, and the slug is brand new so nothing was ever cached under
 * it. The first `revalidatePublishedPost` this post needs comes from the PATCH that publishes
 * it - the same reasoning `POST /api/admin/blog` gives for creating a draft without one.
 */
export async function POST(request: NextRequest) {
  const denied = requireOwner(request)
  if (denied) return denied

  // connectDatabase before the limiter, because `checkRateLimit` writes its counter to Mongo
  // and fails OPEN on error - a limiter above the connect waves everything through on a cold
  // invocation while looking like it is throttling. Same ordering as every other route.
  try {
    await connectDatabase()
  } catch (error) {
    console.error('[api/admin/blog/generate] database unreachable', error)
    return jsonError('Unable to reach the database right now.', 503)
  }

  const limit = await checkRateLimit(clientIpFrom(request), BLOG_GENERATE_LIMIT)
  if (!limit.ok)
    return NextResponse.json(
      {
        error:
          'That is a lot of generating. Give it a few minutes - each one costs a model call.',
      },
      {
        status: 429,
        headers: { 'Retry-After': String(limit.retryAfterSeconds) },
      }
    )

  const parsed = await readJsonBody<{ spec?: unknown; postId?: unknown }>(
    request,
    {
      maxBytes: MAX_BODY_BYTES,
    }
  )
  if (!parsed.ok) return jsonError(parsed.error, parsed.status)

  const { spec, dropped } = normaliseSpec(parsed.body?.spec)
  const warnings = [...dropped]

  /*
    `postId` turns this from "write a post" into "rewrite this post".

    One handler rather than a second route, because everything up to the save is identical -
    the same spec, the same context, the same prompt, the same validation of the reply. Only
    the last step differs, and splitting it would mean two copies of the part that is hard and
    one copy each of the part that is easy.

    It is read here and the document is loaded LATER, immediately before the save. Loading it
    now would mean holding a mongoose document across a model call that can take ninety
    seconds, which is ninety seconds of window for the version in hand to go stale against an
    editor tab that is still saving.
  */
  const postId =
    typeof parsed.body?.postId === 'string' ? parsed.body.postId.trim() : ''
  if (postId && !mongoose.Types.ObjectId.isValid(postId))
    return jsonError('Post not found.', 404)

  let run
  try {
    run = await runGeneration({ spec, warnings, postId: postId || undefined })
  } catch (error) {
    /*
      Every message and status here was chosen inside `runGeneration` rather than re-derived.

      The distinctions are load-bearing: 502 means the provider failed and the same brief is
      worth retrying, 422 means the brief produced an answer we could not use and the brief is
      what has to change, 409 means a slug or a pillar slot was taken. Mapping them back from
      a message string at this layer is how they get flattened to 500.
    */
    if (error instanceof GenerationRunError)
      return jsonError(error.message, error.status)

    console.error('[api/admin/blog/generate] unexpected failure', error)
    return jsonError('The post could not be generated.', 500)
  }

  const saved = run.post
  return NextResponse.json(
    {
      id: String(saved._id),
      slug: saved.slug,
      title: saved.title,
      status: saved.status,
      replaced: run.replaced,
      warnings: run.warnings,
      imageCount: saved.imagePrompts.length,
      usage: run.usage,
      model: run.model,
    },
    { status: run.replaced ? 200 : 201 }
  )
}
