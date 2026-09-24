import 'server-only'

import mongoose from 'mongoose'

import { COVER_KEY } from '@/lib/blog/auto-illustrate'
import { MAX_IMAGE_PROMPTS } from '@/lib/blog/constants'
import { DEFAULT_MODEL } from '@/lib/blog/generation-fields'
import { drawImageAsset, type DrawnImage } from '@/lib/blog/image-asset'
import {
  findImagePlaceholders,
  replacePlaceholder,
} from '@/lib/blog/image-placeholders'
import {
  buildImagePromptRequest,
  contextAround,
  normaliseImagePrompt,
  type ImagePromptTarget,
} from '@/lib/blog/image-prompt'
import { chatCompletion, extractJsonObject } from '@/lib/blog/llm'
import { BLOG_PIPELINE_VERSION, renderMarkdown } from '@/lib/blog/markdown'
import { publishingRunHolds, type ServiceResult } from '@/lib/blog/post-service'
import { revalidatePublishedPost } from '@/lib/blog/revalidate'
import { connectDatabase } from '@/lib/mongodb'
import { PostModel } from '@/models/Post'

/**
 * Post images: draw one, write a prompt for one, and patch one into a post.
 *
 * ```
 *   generateImageUrl  post exists, not deleted ──▶ Gemini ──▶ Cloudinary ──▶ { url }   never saved
 *   writeImagePrompt  post + surrounding prose ──▶ router ──▶ { prompt }   saved unless save: false
 *   patchImageIntoPost(post, key, url)                          (R3, used by attach AND illustrate)
 *      loop: read the CURRENT body
 *            key's placeholder gone?          ──▶ skipped (the owner removed it; nothing broken)
 *            replace it, re-render
 *            updateOne({ _id, bodyMarkdown: what we read }) ──▶ matched? saved : someone edited, loop
 *            post live? ──▶ revalidatePublishedPost(slug)                                       (C8)
 *      allowLive: false (no publish scope) ──▶ a post that went live meanwhile is 'live', not written
 *      refusePublishingRun (agent attach)  ──▶ a cron run holding the lease is 'publishing', not written
 * ```
 *
 * ## Why the patch is conditional on the body it read
 *
 * The illustration run takes minutes. The version it replaced loaded the post once and saved
 * the whole in-memory document after every image, so an edit the owner (or an agent's
 * `update_post`) made during the run was silently put back by the next image save (R2-7).
 * Re-reading and matching on the exact body means an image lands in whatever the post says
 * NOW, and a concurrent edit makes the update miss and retry rather than be overwritten.
 *
 * ## Why `generateImageUrl` never writes the post
 *
 * It is the admin route's "return, don't save" behaviour moved unchanged: the editor patches
 * its local state with the URL and Save commits it. The agent's attach mode is a separate,
 * explicit call to `patchImageIntoPost`.
 */

function isObjectId(id: string) {
  return mongoose.Types.ObjectId.isValid(id)
}

/** `POST /api/admin/blog/<id>/generate-image` after its input checks; and `generate_image`. */
export async function generateImageUrl({
  postId,
  prompt,
  model,
  name,
}: {
  postId: string
  prompt: string
  model: string
  /** The Cloudinary filename suffix: `cover` or a placeholder key. */
  name: string
}): Promise<ServiceResult<DrawnImage & { slug: string }>> {
  await connectDatabase()
  if (!isObjectId(postId))
    return { ok: false, status: 404, error: 'Post not found.' }

  const post = await PostModel.findById(postId).select('slug status')
  if (!post) return { ok: false, status: 404, error: 'Post not found.' }

  // Same refusal `writeImagePrompt` makes on a deleted target - a soft-deleted post is one
  // the author has already thrown away, so spending a model call on it buys a field nothing
  // will ever render.
  if (post.status === 'deleted')
    return {
      ok: false,
      status: 409,
      error: 'That post is deleted. Restore it before generating a cover.',
    }

  const drawn = await drawImageAsset({
    prompt,
    model,
    name: `${post.slug}-${name}`,
  })
  return { ok: true, value: { ...drawn, slug: post.slug } }
}

/**
 * `POST /api/admin/blog/<id>/image-prompt` after its input checks: write one image prompt
 * from the prose around it. `LlmError` and a schema rejection propagate - the route maps
 * them, and so does the tool. The notes below are the route's, moved with the code.
 */
export async function writeImagePrompt(
  postId: string,
  target: { cover: true } | { cover: false; key: string },
  { save = true }: { save?: boolean } = {}
): Promise<
  ServiceResult<{
    prompt: string
    key: string | null
    /**
     * Set only when the save was conditional on the `updatedAt` read before the model call and
     * landed: `before` is that read, `updatedAt` this write's own. The editor adopts
     * `updatedAt` as its stale-save base (R9) only if `before` is its current base - otherwise
     * someone else wrote in between, and its next Save must see that.
     */
    updatedAt?: Date
    before?: Date
  }>
> {
  await connectDatabase()
  if (!isObjectId(postId))
    return { ok: false, status: 404, error: 'Post not found.' }

  const post = await PostModel.findById(postId).select('+bodyMarkdown')
  if (!post) return { ok: false, status: 404, error: 'Post not found.' }

  // Same refusal the generate route makes on a deleted target. A soft-deleted post is one
  // the author has already thrown away; spending a model call to write a prompt into it is
  // paying for a field nothing will ever render.
  if (post.status === 'deleted')
    return {
      ok: false,
      status: 409,
      error:
        'That post is deleted. Restore it before rewriting its image prompts.',
    }

  if (!post.bodyMarkdown.trim())
    // The editor hides both surfaces on an empty body, so this is only reachable from a
    // stale tab or a direct call. Named rather than generic: a prompt written from an empty
    // post is a prompt about nothing, and returning one would look like success.
    return {
      ok: false,
      status: 409,
      error: 'Write the post first. An image prompt is written from the body.',
    }

  const key = target.cover ? '' : target.key

  /*
    The placeholder has to still be in the body.

    Not pedantry - it is the difference between rewriting a prompt and creating an orphan.
    `imagePrompts` is a lookup beside the markdown, and the editor only renders cards for
    keys it finds in the text, so a prompt written for a key the author has since deleted
    would be saved, invisible, and never reachable again.
  */
  if (
    !target.cover &&
    !findImagePlaceholders(post.bodyMarkdown).some(item => item.key === key)
  )
    return {
      ok: false,
      status: 409,
      error: `"${key}" is no longer in the post body.`,
    }

  /*
    The cap is checked BEFORE the model call, not discovered at `save()` after it.

    `imagePrompts` is capped at `MAX_IMAGE_PROMPTS` by the schema, which rejects the whole
    document past it. Reaching that with a push below means the author has already paid for
    a completion, and the ValidationError surfaces as a generic 500 - "could not write a
    prompt right now" for a condition that is permanent and fixable. Checking here turns it
    into a sentence naming the limit, for free.
  */
  if (
    !target.cover &&
    post.imagePrompts.length >= MAX_IMAGE_PROMPTS &&
    !post.imagePrompts.some(entry => entry.key === key)
  )
    return {
      ok: false,
      status: 409,
      error: `This post already carries ${MAX_IMAGE_PROMPTS} image prompts, which is the limit. Remove a placeholder from the body before adding another.`,
    }

  const promptTarget: ImagePromptTarget = target.cover
    ? { kind: 'cover' }
    : { kind: 'body', key, context: contextAround(post.bodyMarkdown, key) }

  const { system, user } = buildImagePromptRequest({
    target: promptTarget,
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

  const prompt = normaliseImagePrompt(extractJsonObject(completion.text).prompt)
  if (!prompt)
    return {
      ok: false,
      status: 422,
      error: 'The model returned an empty prompt. Try again.',
    }

  if (save) {
    if (target.cover) post.coverImagePrompt = prompt
    else {
      const existing = post.imagePrompts.findIndex(entry => entry.key === key)
      if (existing === -1) post.imagePrompts.push({ key, prompt })
      else post.imagePrompts[existing].prompt = prompt

      // A subdocument mutated in place is not seen by mongoose's change tracking on every
      // path shape, so the array is marked explicitly. Without it the push saves and the
      // in-place edit silently does not - which reads as "regenerate works the first time".
      post.markModified('imagePrompts')
    }

    // Conditional on the updatedAt read before the (seconds-long) model call, so nothing
    // written meanwhile is absorbed silently into the editor's base; a miss falls back to
    // the plain save it always was - the prompt is what the owner asked for either way.
    const before = post.updatedAt
    await post.validate()
    const changes = post.getChanges() as Record<string, unknown> & {
      $set?: Record<string, unknown>
    }
    const now = new Date()
    const written = await PostModel.updateOne(
      { _id: post._id, updatedAt: before },
      { ...changes, $set: { ...(changes.$set ?? {}), updatedAt: now } },
      { runValidators: true, timestamps: false }
    )
    if (written.matchedCount === 1)
      return {
        ok: true,
        value: {
          prompt,
          key: target.cover ? null : key,
          updatedAt: now,
          before,
        },
      }
    await post.save()
  }

  // No `revalidatePublishedPost`. Neither field renders anywhere public, so there is no
  // cached page that could be showing a stale version of it.
  return { ok: true, value: { prompt, key: target.cover ? null : key } }
}

export type PatchOutcome =
  | 'saved'
  | 'skipped'
  | 'missing'
  | 'conflict'
  /** `refusePublishingRun` and a publishing run (the cron) holds the lease. */
  | 'publishing'
  /** `allowLive: false` and the post is published (it may have gone live since the caller looked). */
  | 'live'

const PATCH_ATTEMPTS = 5

/**
 * Put one image into a post: the cover, or one `imageN` placeholder in the CURRENT body.
 * See the header for why every write is conditional on what was just read.
 */
export async function patchImageIntoPost(
  postId: string,
  key: string,
  url: string,
  {
    replaceCover = true,
    refusePublishingRun = false,
    allowLive = true,
  }: {
    /** false: leave a cover someone set meanwhile alone (the illustration run). */
    replaceCover?: boolean
    /**
     * true for an agent's attach: never write while a run that will publish the post holds
     * its lease (illustrate-run.ts, "Why a publishing run locks agents out"). Checked on the
     * read AND in the write's filter, so a run claimed in between is caught too.
     */
    refusePublishingRun?: boolean
    /**
     * false for a token without the publish scope: never write into a published post. The
     * caller checked the status once, but an image takes minutes to draw and the owner may
     * publish meanwhile, so it is checked again on every read AND in the write's filter.
     */
    allowLive?: boolean
  } = {}
): Promise<{ outcome: PatchOutcome; slug: string | null; live: boolean }> {
  await connectDatabase()

  for (let attempt = 0; attempt < PATCH_ATTEMPTS; attempt += 1) {
    const current = await PostModel.findById(postId)
      .select('+bodyMarkdown slug status coverImage illustration')
      .lean()
    if (!current || current.status === 'deleted')
      return { outcome: 'missing', slug: null, live: false }
    const live = current.status === 'published'
    if (live && !allowLive) return { outcome: 'live', slug: current.slug, live }
    const now = new Date()
    if (refusePublishingRun && publishingRunHolds(current.illustration, now))
      return { outcome: 'publishing', slug: current.slug, live }
    const noPublishingRun = refusePublishingRun
      ? {
          $or: [
            { 'illustration.state': { $ne: 'running' as const } },
            { 'illustration.publishing': { $ne: true } },
            { 'illustration.leaseUntil': { $lt: now } },
          ],
        }
      : {}
    const notLive = allowLive ? {} : { status: { $ne: 'published' as const } }

    let saved
    if (key === COVER_KEY) {
      if (!replaceCover && current.coverImage)
        return { outcome: 'skipped', slug: current.slug, live }
      saved = await PostModel.updateOne(
        {
          _id: current._id,
          coverImage: current.coverImage,
          ...noPublishingRun,
          ...notLive,
        },
        { $set: { coverImage: url, contentUpdatedAt: new Date() } }
      )
    } else {
      const body = current.bodyMarkdown ?? ''
      if (!findImagePlaceholders(body).some(item => item.key === key))
        return { outcome: 'skipped', slug: current.slug, live }

      const next = replacePlaceholder(body, key, url)
      const bodyHtml = await renderMarkdown(next, current.slug)
      saved = await PostModel.updateOne(
        {
          _id: current._id,
          bodyMarkdown: body,
          ...noPublishingRun,
          ...notLive,
        },
        {
          $set: {
            bodyMarkdown: next,
            bodyHtml,
            renderedWith: BLOG_PIPELINE_VERSION,
            contentUpdatedAt: new Date(),
          },
        }
      )
    }

    if (saved.matchedCount === 1) {
      if (live) revalidatePublishedPost(current.slug)
      return { outcome: 'saved', slug: current.slug, live }
    }
    // Someone saved the post between the read and the write: read it again.
  }

  return { outcome: 'conflict', slug: null, live: false }
}
