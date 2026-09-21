import 'server-only'

import {
  applyIllustration,
  planIllustration,
  publishBlockers,
} from '@/lib/blog/auto-illustrate'
import { drawImageAsset } from '@/lib/blog/image-asset'
import { ImageGenError } from '@/lib/blog/image-gen'
import { BLOG_PIPELINE_VERSION, renderMarkdown } from '@/lib/blog/markdown'
import { revalidatePublishedPost } from '@/lib/blog/revalidate'
import type { PostRecord } from '@/lib/blog/generate-run'

/**
 * Draw a saved post's images and publish it, with nobody watching.
 *
 * ```
 *   post (archived, prompts written, no pictures)
 *          │
 *   planIllustration ──▶ [ cover, image1, image2, ... ]
 *          │
 *          ├─ budget left?  no ──▶ stop, warn, leave the rest as placeholders
 *          │
 *          ├─ drawImageAsset ──▶ url ──▶ apply ──▶ render ──▶ SAVE      one save per image
 *          │        └─ failed ──▶ warn, KEEP GOING, prompt stays on the post
 *          ▼
 *   publishBlockers ──▶ []       ──▶ status = 'published' · revalidate
 *                   ──▶ [why]    ──▶ stays archived, reason reported
 * ```
 *
 * ## This is the dialog's loop, moved to the server, and one decision is different
 *
 * `GenerateBlogDialog` runs the same plan from the browser and batches every URL into a single
 * PATCH at the end, because each save re-renders the body through Shiki and a person is
 * watching the spinner. This saves after EVERY image instead.
 *
 * The reason is what kills each of them. A browser run dies when the author closes the tab,
 * which they do deliberately and rarely. A cron run dies when the platform hits `maxDuration`,
 * which is a wall it cannot see coming and which lands mid-loop by construction - image
 * generation is minutes of work inside a request measured in minutes. Batching there means the
 * common failure throws away every image it had already paid for. Four extra Shiki passes on a
 * job nobody is waiting for is the cheaper side of that trade by a wide margin.
 *
 * ## A failed image is not a failed run
 *
 * It skips and keeps going, and the post keeps its image prompt - so what lands on the board is
 * a post with one card left to press, which is a task. The alternative, aborting the run,
 * turns one refused image into a post with none.
 *
 * The post then fails `publishBlockers` and stays `archived`, which is the point: nothing goes
 * public with a placeholder in it, because a placeholder renders as a sourceless `<img>` - a
 * broken-image icon on a live page.
 *
 * ## The budget, and why it is a deadline rather than a count
 *
 * An image takes anywhere from twenty seconds to two minutes, so "how many fit" has no answer
 * before the fact. The loop asks the clock instead: if there is not room for another image
 * plus the save that follows it, stop now and report it. Being killed by the platform instead
 * would lose the current image and the `published` decision with it - and the whole point of
 * stopping early is to reach that decision.
 */

/** Below this much remaining budget there is no point starting another image. */
const MIN_IMAGE_BUDGET_MS = 45_000

/** Held back from every per-image timeout for the upload, the Shiki pass and the save. */
const SAVE_RESERVE_MS = 20_000

export type IllustrationOutcome = {
  /** Images drawn, uploaded and saved onto the post. */
  imagesMade: number
  /** Images the plan wanted that this run did not produce - failed, or out of budget. */
  imagesSkipped: number
  warnings: string[]
  /** Whether the post ended this run public. */
  published: boolean
  /** Why it did not, already phrased for a log line or a result card. Empty when it did. */
  blockers: string[]
}

export async function illustratePost(
  post: PostRecord,
  {
    model,
    deadlineAt,
  }: {
    model: string
    /** `Date.now()` value after which no new image may be started. */
    deadlineAt: number
  }
): Promise<IllustrationOutcome> {
  const warnings: string[] = []

  const { tasks, skipped } = planIllustration({
    coverImage: post.coverImage,
    coverImagePrompt: post.coverImagePrompt,
    bodyMarkdown: post.bodyMarkdown,
    imagePrompts: post.imagePrompts,
  })
  warnings.push(...skipped)

  let imagesMade = 0
  let imagesSkipped = skipped.length

  for (let index = 0; index < tasks.length; index += 1) {
    const task = tasks[index]
    const remaining = deadlineAt - Date.now()

    if (remaining < MIN_IMAGE_BUDGET_MS) {
      const left = tasks.length - index
      warnings.push(
        `Ran out of time with ${left} image${left === 1 ? '' : 's'} left to draw. ${left === 1 ? 'Its prompt is' : 'Their prompts are'} on the post - make ${left === 1 ? 'it' : 'them'} in the editor.`
      )
      imagesSkipped += left
      break
    }

    let url: string
    try {
      url = (
        await drawImageAsset({
          prompt: task.prompt,
          model,
          name: `${post.slug}-${task.key}`,
          // Never longer than the budget allows. An image call that outlives the request is
          // one the platform kills mid-flight, which loses the save AND the publish decision.
          timeoutMs: Math.max(
            MIN_IMAGE_BUDGET_MS - SAVE_RESERVE_MS,
            remaining - SAVE_RESERVE_MS
          ),
        })
      ).url
    } catch (error) {
      imagesSkipped += 1
      const message =
        error instanceof ImageGenError
          ? error.message
          : 'the image model call failed'
      console.error(`[blog/illustrate-run] ${post.slug} ${task.key}`, error)
      warnings.push(
        `Could not draw ${task.label}: ${message} Its prompt is still on the post.`
      )
      continue
    }

    const next = applyIllustration(
      { coverImage: post.coverImage, bodyMarkdown: post.bodyMarkdown },
      task.key,
      url
    )
    post.coverImage = next.coverImage

    if (next.bodyMarkdown !== post.bodyMarkdown) {
      post.bodyMarkdown = next.bodyMarkdown
      // Re-rendered because the markdown changed, for the reason every other write path gives:
      // `bodyHtml` is what `/blog/<slug>` serves, and a body whose HTML still holds the
      // placeholder publishes the broken image this whole function exists to avoid.
      post.bodyHtml = await renderMarkdown(post.bodyMarkdown, post.slug)
      post.renderedWith = BLOG_PIPELINE_VERSION
      post.contentUpdatedAt = new Date()
    }

    await post.save()
    imagesMade += 1
  }

  const blockers = publishBlockers({
    title: post.title,
    bodyMarkdown: post.bodyMarkdown,
    coverImage: post.coverImage,
  })

  if (blockers.length > 0)
    return {
      imagesMade,
      imagesSkipped,
      warnings,
      published: false,
      blockers,
    }

  post.status = 'published'
  // Stamped once and never reset - the same rule `PATCH /api/admin/blog/[id]` states. Moving
  // it would rewrite `datePublished` in JSON-LD and `pubDate` in RSS on a re-publish, telling
  // every feed reader a months-old post is new.
  if (post.publishedAt === null) post.publishedAt = new Date()
  await post.save()

  /*
    Isolated from the save it follows, and the post IS public at this point whatever happens
    here. A `revalidatePath` throw reaching a caller's catch would have it report the run as
    failed - and the cron would then be looking at a published post it believes it did not
    publish. The honest failure is "it is live, the cache may be stale".
  */
  try {
    revalidatePublishedPost(post.slug)
  } catch (error) {
    console.error(
      '[blog/illustrate-run] published but could not revalidate',
      error
    )
    warnings.push(
      'The post was published, but its page may serve from cache until ISR expires.'
    )
  }

  return { imagesMade, imagesSkipped, warnings, published: true, blockers: [] }
}
