import { NextResponse, type NextRequest } from 'next/server'

import { jsonError } from '@/lib/api-response'
import { connectDatabase } from '@/lib/mongodb'
import { readJsonBody } from '@/lib/read-json-body'
import { requireOwner } from '@/lib/require-owner'
import { isReservedSlug, PostModel, SLUG_PATTERN } from '@/models/Post'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Sized like the contact form's: a create carries a slug and a title, nothing large. */
const CREATE_MAX_BODY_BYTES = 8 * 1024

/**
 * [GET] /api/admin/blog - the board's list
 * [POST] /api/admin/blog - create a draft
 *
 * Both gated by `requireOwner`. This is one of six handlers behind that call, and the gate is
 * the first statement in each of them rather than the first statement after a database
 * connection - a 401 should cost an unauthorised caller nothing of ours.
 *
 * ## Why the list includes every status
 *
 * This is the owner's board, so drafts and archived posts are the point of looking at it.
 * `deleted` is included too, deliberately: a soft-deleted post still holds its slug, and a
 * board that hid them would leave the author unable to explain why a slug they "deleted" is
 * refused on create. The UI greys them; the API does not lie about them.
 */
export async function GET(request: NextRequest) {
  const denied = requireOwner(request)
  if (denied) return denied

  try {
    await connectDatabase()

    // Both bodies are `select: false`, so the board cannot accidentally ship 30 posts'
    // markdown to a browser that only renders their titles.
    const posts = await PostModel.find({})
      .select('slug title kind series isPillar status language publishedAt contentUpdatedAt updatedAt')
      .sort({ updatedAt: -1 })
      .lean()

    return NextResponse.json({ posts })
  } catch (error) {
    console.error('[api/admin/blog] list failed', error)
    return jsonError('Unable to load posts right now.', 500)
  }
}

export async function POST(request: NextRequest) {
  const denied = requireOwner(request)
  if (denied) return denied

  const parsed = await readJsonBody<{ slug?: unknown; title?: unknown }>(request, {
    maxBytes: CREATE_MAX_BODY_BYTES,
  })
  if (!parsed.ok) return jsonError(parsed.error, parsed.status)

  const slug = typeof parsed.body?.slug === 'string' ? parsed.body.slug.trim() : ''
  const title = typeof parsed.body?.title === 'string' ? parsed.body.title.trim() : ''

  if (!SLUG_PATTERN.test(slug)) {
    return jsonError('Slug must match ^[a-z0-9-]{1,80}$.', 400)
  }

  /**
   * The denylist is checked here as well as in the schema, and that duplication is wanted.
   *
   * The schema validator is the backstop that catches any write path - a script, a future
   * handler, a migration. This check is the one that produces a message an author can act
   * on, naming the slug and the rule, instead of a mongoose ValidationError surfaced as a
   * generic 400. Belt and braces, where the braces are also legible.
   */
  if (isReservedSlug(slug)) {
    return jsonError(`"${slug}" is reserved by a route and cannot be a post slug.`, 400)
  }

  if (!title) {
    return jsonError('A title is required.', 400)
  }

  try {
    await connectDatabase()

    const existing = await PostModel.findOne({ slug }).select('slug status').lean()
    if (existing) {
      // Named rather than generic, because the non-obvious case is a soft-deleted post still
      // holding the slug. An author who deleted something an hour ago and gets "already
      // taken" with no explanation will assume the delete failed.
      const because =
        existing.status === 'deleted'
          ? ' (a deleted post still holds this slug, so a new post cannot inherit its contact attributions)'
          : ''
      return jsonError(`The slug "${slug}" is already taken${because}.`, 409)
    }

    const created = await PostModel.create({ slug, title, status: 'draft' })

    // No revalidation here on purpose: a draft has no public surface to invalidate.
    return NextResponse.json({ id: String(created._id), slug: created.slug }, { status: 201 })
  } catch (error) {
    console.error('[api/admin/blog] create failed', error)
    return jsonError('Unable to create the post right now.', 500)
  }
}
