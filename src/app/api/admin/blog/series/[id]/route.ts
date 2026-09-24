import { NextResponse, type NextRequest } from 'next/server'

import { jsonError, serviceErrorResponse } from '@/lib/api-response'
import { deleteSeries, updateSeries } from '@/lib/blog/taxonomy-service'
import { readJsonBody } from '@/lib/read-json-body'
import { requireOwner } from '@/lib/require-owner'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_BODY_BYTES = 8 * 1024

type RouteContext = { params: Promise<{ id: string }> }

/**
 * [PATCH]  /api/admin/blog/series/[id] - retitle, re-blurb, reorder
 * [DELETE] /api/admin/blog/series/[id] - remove, only if nothing references it
 *
 * ```
 *   requireOwner ──▶ 401
 *        │
 *   PATCH  slug in body              ──▶ 400   ← identity is not editable. See below.
 *          title empty               ──▶ 400
 *        │
 *   DELETE posts still reference it  ──▶ 409 + the list of them
 *        │
 *   taxonomy-service: save ──▶ revalidatePath('/blog')   ← the copy is rendered there
 * ```
 *
 * The rules and the revalidation run inside `lib/blog/taxonomy-service.ts` (C8), so no
 * front door can relabel without invalidating; this handler is the gate and the response.
 *
 * ## The slug cannot be changed, and refusing is better than silently migrating
 *
 * `Post.series` stores the slug, so a rename has to either update every referencing post in
 * the same breath or orphan them. The second is data loss. The first is a multi-document
 * write with no transaction around it, on a surface where the honest alternative - create the
 * new series, move the posts, delete the old one - is three explicit steps the owner can see
 * and stop halfway through. This is the same reasoning that freezes a published post's own
 * slug, and a rename here would break more than one URL.
 *
 * Title and blurb are the presentational fields and are freely editable; they are what the
 * index renders, and nothing references them by value.
 *
 * ## Why DELETE refuses rather than unassigning
 *
 * Unassigning would delete the series and quietly set `series: null` on every post using it,
 * which restructures the public index - those posts fall out of their cluster and into
 * "Everything else" - without anyone asking for that. Refusing costs one extra step and
 * makes the restructure something the owner did on purpose.
 *
 * The count includes soft-deleted posts. A `deleted` post still holds its series reference
 * and can be restored, so deleting a series it points at would leave a dangling value on a
 * document that comes back.
 *
 * ## `revalidatePath('/blog')` with a literal path
 *
 * The index carries the title and blurb, so editing either makes it stale for the length of
 * its 300s window. A literal path, never the pattern form - see `lib/blog/revalidate.ts` for
 * what the pattern form does here, which is nothing at all.
 */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const denied = requireOwner(request)
  if (denied) return denied

  const parsed = await readJsonBody<{
    title?: unknown
    blurb?: unknown
    order?: unknown
    slug?: unknown
  }>(request, { maxBytes: MAX_BODY_BYTES })
  if (!parsed.ok) return jsonError(parsed.error, parsed.status)

  try {
    const { id } = await params
    const result = await updateSeries(id, parsed.body ?? {})
    if (!result.ok) return serviceErrorResponse(result)
    return NextResponse.json({ series: result.value })
  } catch {
    return jsonError('Unable to save the series right now.', 500)
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const denied = requireOwner(request)
  if (denied) return denied

  try {
    const { id } = await params
    const result = await deleteSeries(id)
    if (!result.ok) return serviceErrorResponse(result)
    return NextResponse.json({ ok: true })
  } catch {
    return jsonError('Unable to delete the series right now.', 500)
  }
}
