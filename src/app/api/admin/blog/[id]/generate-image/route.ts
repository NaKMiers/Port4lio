import { NextResponse, type NextRequest } from 'next/server'

import { jsonError, serviceErrorResponse } from '@/lib/api-response'
import { IMAGE_MODEL_OPTIONS } from '@/lib/blog/generation-fields'
import { ImageGenError } from '@/lib/blog/image-gen'
import { generateImageUrl } from '@/lib/blog/image-service'
import { connectDatabase } from '@/lib/mongodb'
import {
  BLOG_GENERATE_IMAGE_LIMIT,
  checkRateLimit,
  clientIpFrom,
} from '@/lib/rate-limit'
import { readJsonBody } from '@/lib/read-json-body'
import { requireOwner } from '@/lib/require-owner'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
/**
 * One `generateContent` round trip plus a Cloudinary upload. The Cloudinary leg is well under
 * a minute, but image generation itself measurably runs past a minute on real prompts - see
 * `DEFAULT_TIMEOUT_MS` in `image-gen.ts`, which this has to stay above or the platform would
 * cut the request before that client-side timeout ever gets a chance to fire.
 */
export const maxDuration = 150

/** A prompt is capped at 2000 chars by the schema; room for UTF-8 and the model field on top. */
const MAX_BODY_BYTES = 8 * 1024

const ALLOWED_MODELS = new Set<string>(
  IMAGE_MODEL_OPTIONS.map(option => option.value)
)

/**
 * [POST] /api/admin/blog/<id>/generate-image - draw the cover from its prompt.
 *
 * ```
 *   { model }                         ← IMAGE_MODEL_OPTIONS only, never a free-text model id
 *            │
 *            ▼
 *   requireOwner · rate limit · input checks
 *            │
 *   image-service.generateImageUrl   post exists, not deleted ──▶ Gemini ──▶ Cloudinary
 *            │
 *            ▼
 *   { url, model }                    NOT written to the post - see below
 * ```
 *
 * ## The prompt travels in the request body, not read from the document
 *
 * Unlike `image-prompt/route.ts`, which reads the post's saved body to WRITE a prompt, this
 * route only READS one - and the editor already holds it in memory, very often with edits the
 * author has not pressed Save on yet. Requiring a flush first, the way `regenerateImagePrompt`
 * does, would mean editing the prompt and pressing Generate loses the edit if Save happens to
 * fail; sending it directly means Generate always draws from what is on screen.
 *
 * ## Why this never writes `post.coverImage` itself
 *
 * `BlogEditor.uploadCover` - the file-picker path - only ever calls `patch({ coverImage: url })`
 * and leaves persisting it to the next manual Save, same as every other field in this editor.
 * A generated image is the same kind of value by the same door, so it gets the same treatment:
 * the client patches local state with the URL this route returns, and Save is what commits it.
 * Writing it here as a side effect would make Generate the one field in the editor that saves
 * itself, silently, the moment the button is pressed. (The site MCP's `generate_image` has an
 * explicit attach mode for that instead - `patchImageIntoPost` in the same service.)
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
      '[api/admin/blog/[id]/generate-image] database unreachable',
      error
    )
    return jsonError('Unable to reach the database right now.', 503)
  }

  const limit = await checkRateLimit(
    clientIpFrom(request),
    BLOG_GENERATE_IMAGE_LIMIT
  )
  if (!limit.ok)
    return NextResponse.json(
      { error: 'Too many image generations. Give it a minute.' },
      {
        status: 429,
        headers: { 'Retry-After': String(limit.retryAfterSeconds) },
      }
    )

  const parsed = await readJsonBody<{ model?: unknown; prompt?: unknown }>(
    request,
    { maxBytes: MAX_BODY_BYTES }
  )
  if (!parsed.ok) return jsonError(parsed.error, parsed.status)

  const model =
    typeof parsed.body?.model === 'string' ? parsed.body.model.trim() : ''
  if (!ALLOWED_MODELS.has(model))
    return jsonError('Choose an image model first.', 400)

  const prompt =
    typeof parsed.body?.prompt === 'string' ? parsed.body.prompt.trim() : ''
  if (!prompt)
    return jsonError(
      'Write an image prompt first - Generate reads from it.',
      400
    )

  try {
    const { id } = await params
    const result = await generateImageUrl({
      postId: id,
      prompt,
      model,
      name: 'cover',
    })
    if (!result.ok) return serviceErrorResponse(result)

    return NextResponse.json({
      url: result.value.url,
      model: result.value.model,
    })
  } catch (error) {
    if (error instanceof ImageGenError)
      return jsonError(error.message, error.status === 429 ? 429 : 502)

    console.error('[api/admin/blog/[id]/generate-image] failed', error)
    return jsonError('Could not generate a cover image right now.', 500)
  }
}
