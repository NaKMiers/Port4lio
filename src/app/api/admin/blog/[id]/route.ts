import { NextResponse, type NextRequest } from 'next/server'

import { jsonError, serviceErrorResponse } from '@/lib/api-response'
import {
  loadEditorPost,
  patchPost,
  permanentDeletePost,
  softDeletePost,
  type PatchBody,
} from '@/lib/blog/post-service'
import { connectDatabase } from '@/lib/mongodb'
import { BLOG_SAVE_LIMIT, checkRateLimit, clientIpFrom } from '@/lib/rate-limit'
import { readJsonBody } from '@/lib/read-json-body'
import { requireOwner } from '@/lib/require-owner'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** A post body can be long. 512KiB is well above any real post and well under the platform. */
const PATCH_MAX_BODY_BYTES = 512 * 1024

/**
 * [GET|PATCH|DELETE] /api/admin/blog/<id>
 *
 * ```
 *   PATCH
 *     requireOwner ──▶ 401
 *          ▼
 *     checkRateLimit(BLOG_SAVE_LIMIT)  ──▶ 429     backstop, not abuse - see rate-limit.ts
 *          ▼
 *     readJsonBody  ──▶ 413 / 400
 *          ▼
 *     post-service.patchPost          baseUpdatedAt stale ──▶ 409 { code: 'stale' }   (R9, optional)
 *                                     archived→draft      ──▶ 409
 *                                     slug edit when published ──▶ 409
 *                                     renderMarkdown ──▶ bodyHtml, save, stamp publishedAt ONCE
 *                                     revalidatePublishedPost(slug)
 * ```
 *
 * Thin by design: the transition rules, the render and the revalidation live in
 * `lib/blog/post-service.ts`, so the site MCP's tools cannot skip any of them (C8). What
 * stays here is what only a browser request has - the owner cookie, the IP rate limit, the
 * body bound - and turning a result into JSON.
 *
 * ## Why revalidation runs on every mutating verb
 *
 * PATCH and DELETE both, not just the publish transition. Wiring it to status changes alone
 * was the first plan and a control run disproved it twice: after a delete, `/blog/second`
 * still served its full HTML and the sitemap still listed it; after a content edit, the live
 * page kept the old text for the whole `revalidate` window with nothing indicating why. The
 * calls are inside the service now, for the same reason.
 *
 * ## `baseUpdatedAt` (R9)
 *
 * The editor sends the `updatedAt` it loaded. When the post changed since - an agent's
 * `update_post`, an image run - the save is a 409 with `code: 'stale'` and the editor shows
 * Reload / Overwrite anyway; Overwrite resends without the field. A PATCH without it behaves
 * exactly as before, and only a PATCH that sent it gets `updatedAt` back, so the editor can
 * keep its base current.
 */

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, { params }: RouteContext) {
  const denied = requireOwner(request)
  if (denied) return denied

  try {
    const { id } = await params
    const post = await loadEditorPost(id)

    if (!post) return jsonError('Post not found.', 404)

    // The editor needs the source, which no public read ever returns.
    return NextResponse.json({ post: post.toObject() })
  } catch (error) {
    console.error('[api/admin/blog/[id]] read failed', error)
    return jsonError('Unable to load the post right now.', 500)
  }
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const denied = requireOwner(request)
  if (denied) return denied

  // connectDatabase first: `checkRateLimit` writes its counter to Mongo and fails OPEN on
  // error, so a limiter above the connect would wave everything through on a cold
  // invocation while looking like it was throttling. Same ordering as every other route.
  try {
    await connectDatabase()
  } catch (error) {
    console.error('[api/admin/blog/[id]] database unreachable', error)
    return jsonError('Unable to reach the database right now.', 503)
  }

  const limit = await checkRateLimit(clientIpFrom(request), BLOG_SAVE_LIMIT)
  if (!limit.ok)
    return NextResponse.json(
      { error: 'Saving too fast - the editor is retrying. Give it a moment.' },
      {
        status: 429,
        headers: { 'Retry-After': String(limit.retryAfterSeconds) },
      }
    )

  const parsed = await readJsonBody<PatchBody>(request, {
    maxBytes: PATCH_MAX_BODY_BYTES,
  })
  if (!parsed.ok) return jsonError(parsed.error, parsed.status)

  const body = parsed.body ?? {}

  try {
    const { id } = await params
    const result = await patchPost(id, body)
    if (!result.ok) return serviceErrorResponse(result)

    const { slug, status, updatedAt } = result.value
    return NextResponse.json({
      ok: true,
      slug,
      status,
      ...(body.baseUpdatedAt !== undefined
        ? { updatedAt: new Date(updatedAt).toISOString() }
        : {}),
    })
  } catch (error) {
    console.error('[api/admin/blog/[id]] save failed', error)
    return jsonError('Unable to save the post right now.', 500)
  }
}

/**
 * Delete. Soft by default; `?permanent=true` removes the document and frees the slug.
 *
 * ```
 *   DELETE /api/admin/blog/<id>
 *        └─▶ status = 'deleted'          reversible, slug retained forever
 *
 *   DELETE /api/admin/blog/<id>?permanent=true
 *        ├─ status !== 'deleted'   ──▶ 409     must be soft-deleted FIRST
 *        ├─ ContactMessage rows    ──▶ 409 + count, unless &acknowledge=true
 *        ▼
 *     deleteOne() + PostEvent purge  ── irreversible, slug released
 * ```
 *
 * The reasoning for each step - why the soft delete keeps the slug, why the purge is
 * post-first, why `relatedSlugs` on other posts are pulled, why revalidation cannot fail the
 * response - is in `softDeletePost` and `permanentDeletePost` in `post-service.ts`, where the
 * code now is. Permanent purge is owner-only and never exposed to an agent.
 */
export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const denied = requireOwner(request)
  if (denied) return denied

  const permanent = request.nextUrl.searchParams.get('permanent') === 'true'
  const acknowledged =
    request.nextUrl.searchParams.get('acknowledge') === 'true'

  try {
    const { id } = await params

    if (!permanent) {
      const result = await softDeletePost(id)
      if (!result.ok) return serviceErrorResponse(result)
      return NextResponse.json({ ok: true, slug: result.value.slug })
    }

    const result = await permanentDeletePost(id, { acknowledged })
    if (!result.ok) return serviceErrorResponse(result)
    const { slug, contactMessages, eventsRemoved, unlinkedFrom, revalidated } =
      result.value
    return NextResponse.json({
      ok: true,
      slug,
      permanent: true,
      contactMessages,
      eventsRemoved,
      unlinkedFrom,
      revalidated,
    })
  } catch (error) {
    console.error('[api/admin/blog/[id]] delete failed', error)
    return jsonError('Unable to delete the post right now.', 500)
  }
}
