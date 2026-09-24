import { NextResponse, type NextRequest } from 'next/server'

import { jsonError, serviceErrorResponse } from '@/lib/api-response'
import { deleteKind, updateKind } from '@/lib/blog/taxonomy-service'
import { readJsonBody } from '@/lib/read-json-body'
import { requireOwner } from '@/lib/require-owner'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_BODY_BYTES = 8 * 1024

type RouteContext = { params: Promise<{ id: string }> }

/**
 * [PATCH]  /api/admin/blog/kinds/[id] - relabel, toggle the eyebrow, reorder
 * [DELETE] /api/admin/blog/kinds/[id] - remove, if nothing uses it AND it is not the last one
 *
 * ```
 *   requireOwner ──▶ 401
 *        │
 *   PATCH  slug in body              ──▶ 400   ← posts reference it. Same as series.
 *        │
 *   DELETE posts still reference it  ──▶ 409 + the list of them
 *          it is the only kind left  ──▶ 409   ← the rule series does not need
 *        │
 *   taxonomy-service: save ──▶ revalidatePath('/blog')   ← `label` prints on the card
 * ```
 *
 * The rules and the revalidation run inside `lib/blog/taxonomy-service.ts` (C8), so no
 * front door can relabel without invalidating; this handler is the gate and the response.
 *
 * ## The last-kind guard, which has no series equivalent
 *
 * `Post.series` is nullable - a post with no series renders under "Everything else", which is
 * a real and reasonable state. `Post.kind` is `required`, so there is no such thing as a post
 * without one. Emptying this collection would therefore not degrade the blog, it would break
 * post creation outright: `POST /api/admin/blog` asks `defaultKindSlug()` for a kind and has
 * nothing to fall back on, because the schema default that used to cover this was removed
 * precisely so it could not name a deleted kind.
 *
 * Refusing here is what keeps that unreachable. The alternative - let the collection empty and
 * handle it at create time - trades a clear error now for a confusing one later, at the
 * moment somebody is trying to start writing.
 *
 * ## Why `revalidatePath` and not just a dialog refresh
 *
 * `label` is printed on the card for any kind with `eyebrow` set, so relabelling `note` to
 * `Quick note` changes `/blog` - which would otherwise hold the old word for its 300s window.
 * A literal path, never the pattern form; see `lib/blog/revalidate.ts`.
 */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const denied = requireOwner(request)
  if (denied) return denied

  const parsed = await readJsonBody<{
    label?: unknown
    eyebrow?: unknown
    order?: unknown
    slug?: unknown
  }>(request, { maxBytes: MAX_BODY_BYTES })
  if (!parsed.ok) return jsonError(parsed.error, parsed.status)

  try {
    const { id } = await params
    const result = await updateKind(id, parsed.body ?? {})
    if (!result.ok) return serviceErrorResponse(result)
    return NextResponse.json({ kind: result.value })
  } catch {
    return jsonError('Unable to save the kind right now.', 500)
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const denied = requireOwner(request)
  if (denied) return denied

  try {
    const { id } = await params
    const result = await deleteKind(id)
    if (!result.ok) return serviceErrorResponse(result)
    return NextResponse.json({ ok: true })
  } catch {
    return jsonError('Unable to delete the kind right now.', 500)
  }
}
