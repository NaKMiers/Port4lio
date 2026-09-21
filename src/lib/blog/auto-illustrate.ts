/**
 * "Make every image and publish" - the plan behind the switch on `GenerateBlogDialog`.
 *
 * ```
 *   generate ──▶ post saved as archived
 *                  ├─ coverImagePrompt: "Isometric render of ..."   coverImage: null
 *                  └─ body: ... ![image](image1) ... ![image](image2) ...
 *                        │
 *   planIllustration ────┤  cover first, then image1, image2, ... in body order
 *                        │  a task only exists where there is a PROMPT to draw from
 *                        ▼
 *   one POST /generate-image per task, in order  ──▶ a res.cloudinary.com URL each
 *                        │
 *   applyIllustration ───┤  cover ──▶ coverImage
 *                        │  imageN ──▶ replacePlaceholder in the body
 *                        ▼
 *   publishBlockers ──▶ []        ──▶ PATCH { status: 'published' }
 *                   ──▶ [reason]  ──▶ leave it archived, and say which reason
 * ```
 *
 * ## Why this is a plan and not a loop
 *
 * The orchestration is client-side (see `GenerateBlogDialog`), and a browser mid-loop is a
 * browser one closed tab away from a half-illustrated post. Keeping the decisions - what to
 * draw, in what order, and whether the result is fit to publish - in pure functions here
 * means they are unit-testable against a post shape rather than against a fetch sequence, and
 * that the same three questions get the same answer if a server-side runner ever wants them.
 *
 * ## `publishBlockers` is deliberately the same bar the board already enforces
 *
 * `BlogBoard` raises a confirm before publishing a post with unresolved placeholders, because
 * a placeholder publishes as a sourceless `<img>` - a broken-image icon on a live page. A
 * switch that auto-published past that would be the confirm's own warning, automated. So the
 * automatic path refuses where the manual path asks, and leaves the post archived with the
 * reason attached. The owner can still publish it by hand from the board, which is the same
 * choice they had before, made the same way.
 *
 * ## Why no imports
 *
 * Same rule as `image-placeholders.ts`, whose functions this leans on: the dialog is a client
 * component and reaches all of these, so nothing here may drag mongoose into the browser
 * bundle.
 */

import {
  findImagePlaceholders,
  replacePlaceholder,
} from '@/lib/blog/image-placeholders'

/** The key the cover uses, kept out of the `imageN` namespace so the two can never collide. */
export const COVER_KEY = 'cover'

export type IllustrationTask = {
  /** `'cover'`, or a placeholder key like `image1`. */
  key: string
  /** The prompt to send. Never empty - a task with no prompt is not a task, see below. */
  prompt: string
  /** What to show while this one is in flight, e.g. "the cover" or "image 2". */
  label: string
}

/** What a post looks like to this module. A subset of the editor's own `post` shape. */
export type IllustrationSource = {
  coverImage: string | null
  coverImagePrompt: string
  bodyMarkdown: string
  imagePrompts: { key: string; prompt: string }[]
}

export type IllustrationPlan = {
  tasks: IllustrationTask[]
  /**
   * Things that would have been drawn and cannot be, each already phrased for the owner.
   *
   * Reported rather than thrown. A post with three placeholders and two prompts should get
   * its two pictures and be told about the third, not refuse to start.
   */
  skipped: string[]
}

/**
 * What to draw, in the order to draw it.
 *
 * Cover first, because it is the one image that shows up before a reader has decided to read -
 * so if the run dies halfway (a rate limit, a closed tab) the picture that survived is the one
 * that carries the most weight.
 *
 * A prompt is REQUIRED for every task. `generate-image` refuses an empty prompt anyway, but
 * the useful half is what happens here instead: the key lands in `skipped` with a sentence
 * saying so, rather than becoming a failed request the owner has to interpret.
 *
 * An existing `coverImage` is left alone. The switch means "make the images this post is
 * missing", and a post that already has a cover - a regeneration, or one the owner uploaded to
 * before pressing Generate - has not asked for it to be redrawn and paid for twice.
 */
export function planIllustration(post: IllustrationSource): IllustrationPlan {
  const tasks: IllustrationTask[] = []
  const skipped: string[] = []

  const coverPrompt = post.coverImagePrompt.trim()
  if (!post.coverImage)
    if (coverPrompt)
      tasks.push({ key: COVER_KEY, prompt: coverPrompt, label: 'the cover' })
    else
      skipped.push(
        'There is no cover image prompt, so no cover was drawn. Write one in the editor and press Generate image there.'
      )

  const promptFor = new Map(
    post.imagePrompts.map(entry => [entry.key, entry.prompt.trim()])
  )

  // Body order, not `imagePrompts` order. The prompts array is whatever the model returned;
  // the body is what the reader scrolls past, and it is also the only one of the two that is
  // guaranteed to contain exactly the keys that still need pictures.
  const placeholders = findImagePlaceholders(post.bodyMarkdown)
  placeholders.forEach((placeholder, index) => {
    const prompt = promptFor.get(placeholder.key) ?? ''
    if (!prompt) {
      skipped.push(
        `"${placeholder.key}" has no image prompt, so it was left as a placeholder.`
      )
      return
    }
    tasks.push({
      key: placeholder.key,
      prompt,
      label: `image ${index + 1} of ${placeholders.length}`,
    })
  })

  return { tasks, skipped }
}

/**
 * Fold one finished image back into the post.
 *
 * Returns a new `{ coverImage, bodyMarkdown }` rather than mutating, so the caller can hold
 * one accumulating value across the loop and PATCH it once at the end. One save rather than
 * one per image is the point: each PATCH re-renders the markdown through Shiki, and paying
 * that five times to write five URLs is five Shiki passes for one document.
 */
export function applyIllustration(
  post: { coverImage: string | null; bodyMarkdown: string },
  key: string,
  url: string
): { coverImage: string | null; bodyMarkdown: string } {
  if (key === COVER_KEY) return { ...post, coverImage: url }
  return {
    ...post,
    bodyMarkdown: replacePlaceholder(post.bodyMarkdown, key, url),
  }
}

/**
 * Why this post is not fit to publish, or `[]` when it is.
 *
 * "Full of content" made concrete, and deliberately short. Four things, each of which is
 * visible damage on a live page rather than a matter of taste:
 *
 * - an unresolved placeholder renders as a broken-image icon (`image-placeholders.ts`)
 * - no cover means no `og:image`, so every share of it is a bare link
 * - an empty title is a blank `<h1>` and a blank tab
 * - an empty body is a published page with nothing on it
 *
 * Excerpt is NOT on this list, on purpose. It is optional for a note by the editor's own
 * label, and a missing one costs a meta description - which is a worse search result, not a
 * broken page. Gating an automatic publish on it would hold back posts that are fine.
 */
export function publishBlockers(post: {
  title: string
  bodyMarkdown: string
  coverImage: string | null
}): string[] {
  const blockers: string[] = []

  if (!post.title.trim()) blockers.push('it has no title')
  if (!post.bodyMarkdown.trim()) blockers.push('it has no body')
  if (!post.coverImage) blockers.push('it has no cover image')

  const unresolved = findImagePlaceholders(post.bodyMarkdown)
  if (unresolved.length > 0)
    blockers.push(
      unresolved.length === 1
        ? `"${unresolved[0].key}" is still a placeholder`
        : `${unresolved.length} images are still placeholders`
    )

  return blockers
}

/**
 * The blocker list as one sentence, for the result card.
 *
 * A list joined with commas and a final "and" reads as a sentence a person wrote; an array
 * rendered as bullets under a heading reads as a form rejecting you, which is the wrong tone
 * for "your post is fine, it is just not finished".
 */
export function describeBlockers(blockers: string[]): string {
  if (blockers.length === 0) return ''
  if (blockers.length === 1) return blockers[0]
  return `${blockers.slice(0, -1).join(', ')} and ${blockers[blockers.length - 1]}`
}
