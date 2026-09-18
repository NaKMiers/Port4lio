import { revalidatePath } from 'next/cache'
import { NextResponse, type NextRequest } from 'next/server'

import { jsonError } from '@/lib/api-response'
import { postsUsingSeries } from '@/lib/blog/series-data'
import { connectDatabase } from '@/lib/mongodb'
import { readJsonBody } from '@/lib/read-json-body'
import { requireOwner } from '@/lib/require-owner'
import { SeriesModel } from '@/models/Series'

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
 *   revalidatePath('/blog')                    ← the copy is rendered there
 * ```
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

  const parsed = await readJsonBody<{ title?: unknown; blurb?: unknown; order?: unknown; slug?: unknown }>(
    request,
    { maxBytes: MAX_BODY_BYTES }
  )
  if (!parsed.ok) return jsonError(parsed.error, parsed.status)
  const body = parsed.body ?? {}

  if ('slug' in body && body.slug !== undefined) {
    return jsonError(
      'A series slug cannot be changed - posts reference it. Create the new series, move the posts, then delete the old one.',
      400
    )
  }

  try {
    await connectDatabase()

    const { id } = await params
    const series = await SeriesModel.findById(id)
    if (!series) return jsonError('Series not found.', 404)

    if (typeof body.title === 'string') {
      const title = body.title.trim()
      if (!title) return jsonError('A title is required.', 400)
      series.title = title
    }
    if (typeof body.blurb === 'string') series.blurb = body.blurb.trim()
    if (typeof body.order === 'number' && Number.isFinite(body.order)) {
      series.order = Math.round(body.order)
    }

    await series.save()
    revalidatePath('/blog')

    return NextResponse.json({
      series: {
        id: String(series._id),
        slug: series.slug,
        title: series.title,
        blurb: series.blurb,
        order: series.order,
      },
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'ValidationError') {
      return jsonError(error.message, 400)
    }
    return jsonError('Unable to save the series right now.', 500)
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const denied = requireOwner(request)
  if (denied) return denied

  try {
    await connectDatabase()

    const { id } = await params
    const series = await SeriesModel.findById(id)
    if (!series) return jsonError('Series not found.', 404)

    const inUse = await postsUsingSeries(series.slug)
    if (inUse.length > 0) {
      return NextResponse.json(
        {
          error: `"${series.title}" is still used by ${inUse.length} post${inUse.length === 1 ? '' : 's'}. Move them to another series first.`,
          posts: inUse,
        },
        { status: 409 }
      )
    }

    await series.deleteOne()
    revalidatePath('/blog')

    return NextResponse.json({ ok: true })
  } catch {
    return jsonError('Unable to delete the series right now.', 500)
  }
}
