import mongoose from 'mongoose'
import { NextResponse, type NextRequest } from 'next/server'

import { jsonError, serviceErrorResponse } from '@/lib/api-response'
import { writeImagePrompt } from '@/lib/blog/image-service'
import { LlmError } from '@/lib/blog/llm'
import { connectDatabase } from '@/lib/mongodb'
import {
  BLOG_IMAGE_PROMPT_LIMIT,
  checkRateLimit,
  clientIpFrom,
} from '@/lib/rate-limit'
import { readJsonBody } from '@/lib/read-json-body'
import { requireOwner } from '@/lib/require-owner'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** A sentence, not a post. Well inside the platform default, so no `maxDuration` is needed. */
const MAX_BODY_BYTES = 2 * 1024

/**
 * [POST] /api/admin/blog/<id>/image-prompt - rewrite one image prompt, in place.
 *
 * ```
 *   { target: 'cover' }              ──▶ post.coverImagePrompt
 *   { target: 'body', key: 'image1' } ──▶ post.imagePrompts[key]
 *                         │
 *                         ▼
 *   requireOwner · rate limit · input checks
 *                         ▼
 *   image-service.writeImagePrompt   the prose AROUND the placeholder ──▶ router ──▶ saved
 * ```
 *
 * ## Why this writes to the document instead of returning the prompt to the editor
 *
 * The editor calls this only after flushing its own manual save (`BlogEditor.regenerateImagePrompt`),
 * so this route's copy of the document is not stale by the time it reads it - but a prompt
 * returned to the client and merged into local state by re-running `patch` would still race a
 * save the author triggers in the meantime: that PATCH would carry the editor's whole state,
 * built before this response landed, and write the old prompt back over the new one. Saving
 * here and having the editor merge the response into its local copy afterwards means the
 * durable value is written once, by the only request that knows it.
 *
 * ## Why the body carries the post id and nothing else
 *
 * Everything the prompt needs - title, excerpt, the body, the surrounding paragraph - is read
 * from the document rather than sent by the client. The client's copy may be a keystroke
 * ahead, which costs a slightly stale context and nothing more; accepting the text over the
 * wire would mean a 512KiB body on a route that otherwise needs two kilobytes, and a second
 * place where post content enters the system.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = requireOwner(request)
  if (denied) return denied

  try {
    await connectDatabase()
  } catch (error) {
    console.error(
      '[api/admin/blog/[id]/image-prompt] database unreachable',
      error
    )
    return jsonError('Unable to reach the database right now.', 503)
  }

  const limit = await checkRateLimit(
    clientIpFrom(request),
    BLOG_IMAGE_PROMPT_LIMIT
  )
  if (!limit.ok)
    return NextResponse.json(
      { error: 'Too many prompt rewrites. Give it a minute.' },
      {
        status: 429,
        headers: { 'Retry-After': String(limit.retryAfterSeconds) },
      }
    )

  const parsed = await readJsonBody<{ target?: unknown; key?: unknown }>(
    request,
    {
      maxBytes: MAX_BODY_BYTES,
    }
  )
  if (!parsed.ok) return jsonError(parsed.error, parsed.status)

  const wantsCover = parsed.body?.target === 'cover'
  const key = typeof parsed.body?.key === 'string' ? parsed.body.key.trim() : ''

  if (!wantsCover && !key)
    return jsonError(
      'Ask for the cover, or name the placeholder to rewrite.',
      400
    )

  try {
    const { id } = await params
    const result = await writeImagePrompt(
      id,
      wantsCover ? { cover: true } : { cover: false, key }
    )
    if (!result.ok) return serviceErrorResponse(result)

    return NextResponse.json(result.value)
  } catch (error) {
    if (error instanceof LlmError)
      return jsonError(error.message, error.status === 429 ? 429 : 502)

    // Both siblings map a schema rejection to 4xx rather than 500 - it is the caller's data,
    // not our outage, and a 500 invites a retry that will fail identically.
    if (error instanceof mongoose.Error.ValidationError)
      return jsonError(error.message, 400)

    console.error('[api/admin/blog/[id]/image-prompt] failed', error)
    return jsonError('Could not write an image prompt right now.', 500)
  }
}
