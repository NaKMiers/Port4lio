import mongoose from 'mongoose'
import { NextResponse, type NextRequest } from 'next/server'

import { jsonError } from '@/lib/api-response'
import { MAX_IMAGE_PROMPTS } from '@/lib/blog/constants'
import { findImagePlaceholders } from '@/lib/blog/image-placeholders'
import {
  buildImagePromptRequest,
  contextAround,
  normaliseImagePrompt,
  type ImagePromptTarget,
} from '@/lib/blog/image-prompt'
import { chatCompletion, extractJsonObject, LlmError } from '@/lib/blog/llm'
import { DEFAULT_MODEL } from '@/lib/blog/generation-fields'
import { connectDatabase } from '@/lib/mongodb'
import {
  BLOG_IMAGE_PROMPT_LIMIT,
  checkRateLimit,
  clientIpFrom,
} from '@/lib/rate-limit'
import { readJsonBody } from '@/lib/read-json-body'
import { requireOwner } from '@/lib/require-owner'
import { PostModel } from '@/models/Post'

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
 *   requireOwner · rate limit · load post
 *                         ▼
 *   buildImagePromptRequest(post)  ← the prose AROUND the placeholder, not the whole post
 *                         ▼
 *   chatCompletion ──▶ {"prompt": "..."} ──▶ saved, and returned
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
    if (!mongoose.Types.ObjectId.isValid(id))
      return jsonError('Post not found.', 404)

    const post = await PostModel.findById(id).select('+bodyMarkdown')
    if (!post) return jsonError('Post not found.', 404)

    // Same refusal the generate route makes on a deleted target. A soft-deleted post is one
    // the author has already thrown away; spending a model call to write a prompt into it is
    // paying for a field nothing will ever render.
    if (post.status === 'deleted')
      return jsonError(
        'That post is deleted. Restore it before rewriting its image prompts.',
        409
      )

    if (!post.bodyMarkdown.trim())
      // The editor hides both surfaces on an empty body, so this is only reachable from a
      // stale tab or a direct call. Named rather than generic: a prompt written from an empty
      // post is a prompt about nothing, and returning one would look like success.
      return jsonError(
        'Write the post first. An image prompt is written from the body.',
        409
      )

    /*
      The placeholder has to still be in the body.

      Not pedantry - it is the difference between rewriting a prompt and creating an orphan.
      `imagePrompts` is a lookup beside the markdown, and the editor only renders cards for
      keys it finds in the text, so a prompt written for a key the author has since deleted
      would be saved, invisible, and never reachable again.
    */
    if (
      !wantsCover &&
      !findImagePlaceholders(post.bodyMarkdown).some(item => item.key === key)
    )
      return jsonError(`"${key}" is no longer in the post body.`, 409)

    /*
      The cap is checked BEFORE the model call, not discovered at `save()` after it.

      `imagePrompts` is capped at `MAX_IMAGE_PROMPTS` by the schema, which rejects the whole
      document past it. Reaching that with a push below means the author has already paid for
      a completion, and the ValidationError surfaces as a generic 500 - "could not write a
      prompt right now" for a condition that is permanent and fixable. Checking here turns it
      into a sentence naming the limit, for free.
    */
    if (
      !wantsCover &&
      post.imagePrompts.length >= MAX_IMAGE_PROMPTS &&
      !post.imagePrompts.some(entry => entry.key === key)
    )
      return jsonError(
        `This post already carries ${MAX_IMAGE_PROMPTS} image prompts, which is the limit. Remove a placeholder from the body before adding another.`,
        409
      )

    const target: ImagePromptTarget = wantsCover
      ? { kind: 'cover' }
      : { kind: 'body', key, context: contextAround(post.bodyMarkdown, key) }

    const { system, user } = buildImagePromptRequest({
      target,
      title: post.title,
      excerpt: post.excerpt,
      bodyMarkdown: post.bodyMarkdown,
    })

    const completion = await chatCompletion({
      model: DEFAULT_MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      // Higher than a post's default. A prompt is one sentence describing a picture, and the
      // failure mode of a cold one is not a wrong answer but a boring one - the same desk,
      // the same laptop, every time the button is pressed.
      temperature: 0.85,
      // A prompt is capped at 60 words by the rules it is written under. This is the ceiling
      // that keeps a runaway generation from costing a post's worth of tokens.
      maxTokens: 600,
      timeoutMs: 60_000,
    })

    const prompt = normaliseImagePrompt(
      extractJsonObject(completion.text).prompt
    )
    if (!prompt)
      return jsonError('The model returned an empty prompt. Try again.', 422)

    if (wantsCover) post.coverImagePrompt = prompt
    else {
      const existing = post.imagePrompts.findIndex(entry => entry.key === key)
      if (existing === -1) post.imagePrompts.push({ key, prompt })
      else post.imagePrompts[existing].prompt = prompt

      // A subdocument mutated in place is not seen by mongoose's change tracking on every
      // path shape, so the array is marked explicitly. Without it the push saves and the
      // in-place edit silently does not - which reads as "regenerate works the first time".
      post.markModified('imagePrompts')
    }

    await post.save()

    // No `revalidatePublishedPost`. Neither field renders anywhere public, so there is no
    // cached page that could be showing a stale version of it.
    return NextResponse.json({ prompt, key: wantsCover ? null : key })
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
