import { NextResponse, type NextRequest } from 'next/server'

import { jsonError, serviceErrorResponse } from '@/lib/api-response'
import { createBarePost, listBoardPosts } from '@/lib/blog/post-service'
import { readJsonBody } from '@/lib/read-json-body'
import { requireOwner } from '@/lib/require-owner'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Sized like the contact form's: a create carries a slug and a title, nothing large. */
const CREATE_MAX_BODY_BYTES = 8 * 1024

/**
 * [GET] /api/admin/blog - the board's list
 * [POST] /api/admin/blog - create a draft
 *
 * ```
 *   requireOwner ──▶ (POST) readJsonBody ──▶ lib/blog/post-service ──▶ JSON
 * ```
 *
 * Both gated by `requireOwner`. This is one of six handlers behind that call, and the gate is
 * the first statement in each of them rather than the first statement after a database
 * connection - a 401 should cost an unauthorised caller nothing of ours. The rules themselves
 * (what the list carries, what a slug may be) live in `post-service.ts`, which the site MCP
 * calls too.
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
    return NextResponse.json({ posts: await listBoardPosts() })
  } catch (error) {
    console.error('[api/admin/blog] list failed', error)
    return jsonError('Unable to load posts right now.', 500)
  }
}

export async function POST(request: NextRequest) {
  const denied = requireOwner(request)
  if (denied) return denied

  const parsed = await readJsonBody<{ slug?: unknown; title?: unknown }>(
    request,
    {
      maxBytes: CREATE_MAX_BODY_BYTES,
    }
  )
  if (!parsed.ok) return jsonError(parsed.error, parsed.status)

  try {
    const result = await createBarePost(parsed.body ?? {})
    if (!result.ok) return serviceErrorResponse(result)
    return NextResponse.json(result.value, { status: 201 })
  } catch (error) {
    console.error('[api/admin/blog] create failed', error)
    return jsonError('Unable to create the post right now.', 500)
  }
}
