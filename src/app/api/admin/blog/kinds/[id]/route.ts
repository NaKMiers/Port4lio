import { revalidatePath } from 'next/cache'
import { NextResponse, type NextRequest } from 'next/server'

import { jsonError } from '@/lib/api-response'
import { postsUsingKind } from '@/lib/blog/kind-data'
import { connectDatabase } from '@/lib/mongodb'
import { readJsonBody } from '@/lib/read-json-body'
import { requireOwner } from '@/lib/require-owner'
import { KindModel } from '@/models/Kind'

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
 *   revalidatePath('/blog')                    ← `label` prints on the card
 * ```
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
  const body = parsed.body ?? {}

  if ('slug' in body && body.slug !== undefined)
    return jsonError(
      'A kind slug cannot be changed - posts reference it. Create the new kind, move the posts, then delete the old one.',
      400
    )

  try {
    await connectDatabase()

    const { id } = await params
    const kind = await KindModel.findById(id)
    if (!kind) return jsonError('Kind not found.', 404)

    if (typeof body.label === 'string') {
      const label = body.label.trim()
      if (!label) return jsonError('A label is required.', 400)
      kind.label = label
    }
    if (typeof body.eyebrow === 'boolean') kind.eyebrow = body.eyebrow
    if (typeof body.order === 'number' && Number.isFinite(body.order))
      kind.order = Math.round(body.order)

    await kind.save()
    revalidatePath('/blog')

    return NextResponse.json({
      kind: {
        id: String(kind._id),
        slug: kind.slug,
        label: kind.label,
        eyebrow: kind.eyebrow,
        order: kind.order,
      },
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'ValidationError')
      return jsonError(error.message, 400)

    return jsonError('Unable to save the kind right now.', 500)
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const denied = requireOwner(request)
  if (denied) return denied

  try {
    await connectDatabase()

    const { id } = await params
    const kind = await KindModel.findById(id)
    if (!kind) return jsonError('Kind not found.', 404)

    // Checked before the in-use count, because it is the one an owner cannot work around by
    // moving posts - saying so first avoids sending them to reassign posts pointlessly.
    if ((await KindModel.countDocuments({})) <= 1)
      return jsonError(
        'This is the only kind left. Every post must have one, so create another before deleting this.',
        409
      )

    const inUse = await postsUsingKind(kind.slug)
    if (inUse.length > 0)
      return NextResponse.json(
        {
          error: `"${kind.label}" is still used by ${inUse.length} post${inUse.length === 1 ? '' : 's'}. Move them to another kind first.`,
          posts: inUse,
        },
        { status: 409 }
      )

    await kind.deleteOne()
    revalidatePath('/blog')

    return NextResponse.json({ ok: true })
  } catch {
    return jsonError('Unable to delete the kind right now.', 500)
  }
}
