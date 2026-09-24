import 'server-only'

import { planIllustration, publishBlockers } from '@/lib/blog/auto-illustrate'
import { drawImageAsset } from '@/lib/blog/image-asset'
import { ImageGenError } from '@/lib/blog/image-gen'
import { patchImageIntoPost } from '@/lib/blog/image-service'
import { revalidatePublishedPost } from '@/lib/blog/revalidate'
import type { PostRecord } from '@/lib/blog/generate-run'
import { connectDatabase } from '@/lib/mongodb'
import { PostModel } from '@/models/Post'

/**
 * Draw a saved post's images - under a lease, one patch per image - and, for the cron only,
 * publish it when it is whole.
 *
 * ```
 *   claimIllustration(post)        findOneAndUpdate(illustration.state != running
 *        │                                           OR leaseUntil < now)      (R3)
 *        ├─ no match ──▶ "already running" { remaining }
 *        └─ claimed: state = running, leaseUntil = now + 300 s, startedAt = now (the fence)
 *                    bookkeeping writes use timestamps: false - they never move updatedAt (R9)
 *        ▼
 *   runIllustration                (inline for the cron; inside after() for illustrate_post, R2)
 *     planIllustration ──▶ [ cover, image1, image2, ... ]   (a task only where there is a prompt)
 *        │ for each:
 *        ├─ budget left?  no ──▶ stop, warn, leave the rest as placeholders
 *        ├─ spendImage()  out ──▶ lastError "rate limit", stop           (per-token bucket, R5)
 *        ├─ drawImageAsset ──▶ url
 *        │        └─ failed ──▶ warn, lastError, KEEP GOING, prompt stays on the post
 *        ├─ patchImageIntoPost: replace THIS placeholder in the CURRENT body   (R3)
 *        │        placeholder gone ──▶ skip        live post ──▶ revalidate (C8)
 *        │        went live, allowLive false ──▶ stop (no publish scope), the drawn URL in lastError
 *        │        kept conflicting ──▶ lastError carries the drawn URL, KEEP GOING
 *        └─ remaining counter, IF startedAt is still ours ──▶ else taken over: stop, touch nothing
 *        ▼
 *     publish: true (cron)  ──▶ publishBlockers ──▶ [] ──▶ status = 'published' IF updatedAt is
 *                               still what the blockers read (else re-read, x3) · revalidate
 *     publish: false (MCP)  ──▶ never publishes; an agent calls publish_post separately
 *        ▼
 *     finally: IF startedAt is still ours: state = idle | failed, leaseUntil = null, remaining,
 *              lastError = every failure of the run, not only the last  (never only a log)
 * ```
 *
 * The revalidations a background run queues inside `after()` are flushed by Next once the
 * `after()` queue is idle, not per image - so a live post's page updates when the run ends.
 *
 * ## Why a publishing run locks agents out
 *
 * The cron's post is `archived` while it draws, so the live-post rule does not cover it, and
 * the patch saves above deliberately keep any edit made meanwhile. Without a lock, a `write`
 * token could edit the post during those minutes and the final `published` would put its
 * text on the live site - a publish without the publish scope. So a run claimed with
 * `publishing: true` refuses `update_post` and `generate_image` attach until it lets go
 * (`publishingRunHolds`). The owner's editor is not an agent and is not refused. An
 * `illustrate_post` run never publishes, so it never locks, and an agent may keep editing
 * during its own run (R3).
 *
 * ## Why the lease (R3)
 *
 * `illustrate_post` answers at once and draws in the background, so an agent that polls
 * impatiently - or a client retrying after a timeout - can start a second run while the first
 * is still drawing. Two runs pay for every image twice and fight over the same placeholders.
 * The lease makes the start one atomic claim. It lasts the function's own 300 s budget, so a
 * run the platform killed mid-image simply expires and the next start takes over.
 *
 * ## Why every image is a patch, not a save of the whole post (R3)
 *
 * The version before this loaded the post once and saved the whole in-memory document after
 * every image - the right trade when nobody could edit during a cron run, and the wrong one
 * now that an agent or the owner can edit while a background run draws. `patchImageIntoPost`
 * re-reads the body, fills only its own placeholder, and writes only if the body is still
 * what it read, so a concurrent edit survives. A placeholder the owner deleted meanwhile is
 * skipped rather than resurrected.
 *
 * ## A failed image is not a failed run
 *
 * It skips and keeps going, and the post keeps its image prompt - so what lands on the board is
 * a post with one card left to press, which is a task. The alternative, aborting the run,
 * turns one refused image into a post with none. The failure still lands in `lastError`, and
 * the run ends `failed`, because an agent polling `get_post` has no other way to learn why an
 * image is missing (R2).
 *
 * The post then fails `publishBlockers` and stays unpublished, which is the point: nothing goes
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

/** The lease: the platform budget (maxDuration 300) of the function holding it. */
export const ILLUSTRATION_LEASE_MS = 300_000

export type IllustrationOutcome = {
  /** Images drawn, uploaded and saved onto the post. */
  imagesMade: number
  /** Images the plan wanted that this run did not produce - failed, out of budget, or skipped. */
  imagesSkipped: number
  warnings: string[]
  /** Whether the post ended this run public. */
  published: boolean
  /** Why it did not, already phrased for a log line or a result card. Empty when it did. */
  blockers: string[]
  /** The last failure inside the run, or null. Also written to `Post.illustration`. */
  lastError: string | null
}

export type ClaimResult =
  | {
      claimed: true
      planned: number
      /** The claim's `startedAt`: pass it to `runIllustration` as its `fence`. */
      startedAt: Date
    }
  | { claimed: false; remaining: number }

/** How many images a run would draw right now: the tasks `planIllustration` finds. */
export function plannedImages(post: {
  coverImage: string | null
  coverImagePrompt: string
  bodyMarkdown: string
  imagePrompts: { key: string; prompt: string }[]
}): number {
  return planIllustration(post).tasks.length
}

/**
 * The atomic start (R3). An expired lease belongs to a killed run, and is taken over.
 * `publishing` marks a run that will publish the post at the end (the cron), which is what
 * makes agent writes wait for it - see `publishingRunHolds`.
 */
export async function claimIllustration(
  postId: string,
  planned: number,
  now = new Date(),
  { publishing = false }: { publishing?: boolean } = {}
): Promise<ClaimResult> {
  await connectDatabase()
  const claimed = await PostModel.findOneAndUpdate(
    {
      _id: postId,
      status: { $ne: 'deleted' },
      $or: [
        // `$ne` also matches a post that has never had an `illustration` at all.
        { 'illustration.state': { $ne: 'running' } },
        { 'illustration.leaseUntil': { $lt: now } },
      ],
    },
    {
      $set: {
        illustration: {
          state: 'running',
          leaseUntil: new Date(now.getTime() + ILLUSTRATION_LEASE_MS),
          remaining: planned,
          lastError: null,
          publishing,
          startedAt: now,
          finishedAt: null,
        },
      },
    },
    // Bookkeeping, not content: leaving updatedAt alone keeps the editor's stale-save check
    // (R9) and update_post's conditional save from seeing a run's counters as edits.
    { projection: { _id: 1 }, timestamps: false }
  ).lean()
  if (claimed) return { claimed: true, planned, startedAt: now }

  const current = await PostModel.findById(postId, {
    'illustration.remaining': 1,
  }).lean()
  return { claimed: false, remaining: current?.illustration?.remaining ?? 0 }
}

export interface RunOptions {
  model: string
  /** `Date.now()` value after which no new image may be started. */
  deadlineAt: number
  /** true: the cron's "publish when whole". false: never publish (MCP, `publish: false`). */
  publish: boolean
  /** Spend one image from a per-token bucket (R5). Absent for the cron. */
  spendImage?: () => Promise<{
    ok: boolean
    retryAfterSeconds: number
    /** The token was revoked during the run. */
    revoked?: boolean
  }>
  /**
   * false for a token without the publish scope: an image is never written into a post that
   * went live during the run, and the run stops there (the live-post rule). Default true.
   */
  allowLive?: boolean
  /** The `startedAt` from this run's claim. Without it the run reads it from the post. */
  fence?: Date
}

/** `Post.illustration.lastError`'s schema cap. */
const LAST_ERROR_MAX = 1000

/**
 * The loop, for a post whose lease this caller holds. Never throws: every failure ends in
 * `lastError` and a released lease.
 */
export async function runIllustration(
  postId: string,
  {
    model,
    deadlineAt,
    publish,
    spendImage,
    allowLive = true,
    fence: claimedFence,
  }: RunOptions
): Promise<IllustrationOutcome> {
  const warnings: string[] = []
  let imagesMade = 0
  let imagesSkipped = 0
  let published = false
  let blockers: string[] = []
  // Every failure, not just the last one: an agent polling get_post has only lastError (R2).
  const errors: string[] = []
  const fail = (message: string) => {
    errors.push(message)
    warnings.push(message)
  }
  const lastErrorText = () =>
    errors.length === 0
      ? null
      : (errors.length === 1
          ? errors[0]
          : `${errors.length} problems in this run: ${errors.join(' | ')}`
        ).slice(0, LAST_ERROR_MAX)
  /*
    The fence: the `startedAt` this run's claim wrote. A run that outlives its lease (possible
    off Vercel, where nothing kills it at 300 s) must not reset a newer run's lease or counter,
    so both writes are conditional on it, and a miss means "taken over - stop".
  */
  let fence: Date | null = claimedFence ?? null
  let ownsLease = true

  try {
    await connectDatabase()
    const post = await PostModel.findById(postId).select('+bodyMarkdown')
    if (!post) throw new Error('The post no longer exists.')
    fence ??= post.illustration?.startedAt ?? null

    const { tasks, skipped } = planIllustration({
      coverImage: post.coverImage,
      coverImagePrompt: post.coverImagePrompt,
      bodyMarkdown: post.bodyMarkdown,
      imagePrompts: post.imagePrompts,
    })
    warnings.push(...skipped)
    imagesSkipped = skipped.length

    for (let index = 0; index < tasks.length; index += 1) {
      const task = tasks[index]
      const remaining = deadlineAt - Date.now()

      if (remaining < MIN_IMAGE_BUDGET_MS) {
        const left = tasks.length - index
        warnings.push(
          `Ran out of time with ${left} image${left === 1 ? '' : 's'} left to draw. ${left === 1 ? 'Its prompt is' : 'Their prompts are'} on the post - make ${left === 1 ? 'it' : 'them'} in the editor.`
        )
        errors.push(
          `Ran out of time with ${left} image${left === 1 ? '' : 's'} left. Call illustrate_post again to draw the rest.`
        )
        imagesSkipped += left
        break
      }

      if (spendImage) {
        const spent = await spendImage()
        if (!spent.ok) {
          const left = tasks.length - index
          fail(
            spent.revoked
              ? `The token was revoked during the run, so it stopped. ${left} image${left === 1 ? '' : 's'} left undrawn.`
              : `rate limit: this token has used its image budget. ${left} image${left === 1 ? '' : 's'} left; call illustrate_post again in ${spent.retryAfterSeconds} s.`
          )
          imagesSkipped += left
          break
        }
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
        errors.push(`Could not draw ${task.label}: ${message}`)
        continue
      }

      const saved = await patchImageIntoPost(postId, task.key, url, {
        replaceCover: false,
        allowLive,
      })
      if (saved.outcome === 'live') {
        const left = tasks.length - index
        imagesSkipped += left
        fail(
          `The post was published while this run was drawing, and this token cannot change a live post (it needs the publish scope). ${left} image${left === 1 ? '' : 's'} not placed; the one just drawn is ${url}.`
        )
        break
      }
      if (saved.outcome === 'saved') imagesMade += 1
      else if (saved.outcome === 'skipped') {
        imagesSkipped += 1
        warnings.push(
          `Skipped ${task.label}: it was removed from the post while the run was drawing.`
        )
      } else {
        imagesSkipped += 1
        // The URL is kept: the image is paid for, and the agent can insert it itself.
        fail(
          `Could not save ${task.label}: the post kept changing underneath the run. It was drawn as ${url} - insert it with update_post.`
        )
      }

      const counted = await PostModel.updateOne(
        { _id: postId, 'illustration.startedAt': fence },
        { $set: { 'illustration.remaining': tasks.length - index - 1 } },
        { timestamps: false }
      )
      if (counted.matchedCount === 0) {
        ownsLease = false
        fail(
          'This run outlived its lease and another run took the post over, so it stopped.'
        )
        break
      }
    }

    // Publish only what the blockers were checked on: the write is conditional on the
    // updatedAt read with it, so an edit landing in between (the owner's - agents are locked
    // out by D8) is re-read and re-checked instead of going live unchecked.
    for (let attempt = 0; publish && ownsLease && attempt < 3; attempt += 1) {
      const fresh = await PostModel.findById(postId).select('+bodyMarkdown')
      if (!fresh) break
      blockers = publishBlockers({
        title: fresh.title,
        bodyMarkdown: fresh.bodyMarkdown,
        coverImage: fresh.coverImage,
      })
      if (blockers.length > 0) break
      const written = await PostModel.updateOne(
        { _id: postId, updatedAt: fresh.updatedAt },
        {
          $set: {
            status: 'published',
            // Stamped once and never reset - the same rule `patchPost` states. Moving it
            // would rewrite `datePublished` in JSON-LD and `pubDate` in RSS on a
            // re-publish, telling every feed reader a months-old post is new.
            publishedAt: fresh.publishedAt ?? new Date(),
          },
        }
      )
      if (written.matchedCount === 0) continue
      published = true

      /*
        Isolated from the save it follows, and the post IS public at this point whatever
        happens here. A `revalidatePath` throw reaching a caller's catch would have it
        report the run as failed - and the cron would then be looking at a published post
        it believes it did not publish. The honest failure is "it is live, the cache may be
        stale".
      */
      try {
        revalidatePublishedPost(fresh.slug)
      } catch (error) {
        console.error(
          '[blog/illustrate-run] published but could not revalidate',
          error
        )
        warnings.push(
          'The post was published, but its page may serve from cache until ISR expires.'
        )
      }
      break
    }
  } catch (error) {
    console.error('[blog/illustrate-run] run failed', error)
    fail(
      error instanceof Error
        ? `The image run failed: ${error.message}`
        : 'The image run failed.'
    )
  } finally {
    // Release the lease - only our own (the fence) - and leave the answer where get_post
    // reads it (R2).
    try {
      if (ownsLease) {
        const fresh = await PostModel.findById(postId).select('+bodyMarkdown')
        await PostModel.updateOne(
          // No fence only when the first read failed and the caller passed none: release
          // whatever run is marked, as before the fence existed.
          fence
            ? { _id: postId, 'illustration.startedAt': fence }
            : { _id: postId, 'illustration.state': 'running' as const },
          {
            $set: {
              'illustration.state': errors.length ? 'failed' : 'idle',
              'illustration.leaseUntil': null,
              'illustration.remaining': fresh ? plannedImages(fresh) : 0,
              'illustration.lastError': lastErrorText(),
              'illustration.finishedAt': new Date(),
            },
          },
          { timestamps: false }
        )
      }
    } catch (error) {
      // The lease then expires on its own after 300 s; get_post reports that as a cut-off run.
      console.error('[blog/illustrate-run] could not release the lease', error)
    }
  }

  return {
    imagesMade,
    imagesSkipped,
    warnings,
    published,
    blockers,
    lastError: lastErrorText(),
  }
}

/**
 * The cron's call: claim, run inline, then bring the caller's in-memory document up to date
 * with what the run wrote, since every image was patched straight into the database.
 */
export async function illustratePost(
  post: PostRecord,
  {
    model,
    deadlineAt,
    publish = true,
    spendImage,
  }: Omit<RunOptions, 'publish'> & { publish?: boolean }
): Promise<IllustrationOutcome> {
  const postId = String(post._id)
  const claim = await claimIllustration(
    postId,
    plannedImages(post),
    new Date(),
    {
      publishing: publish,
    }
  )
  if (!claim.claimed)
    return {
      imagesMade: 0,
      imagesSkipped: 0,
      warnings: ['An image run is already in progress for this post.'],
      published: false,
      blockers: ['an image run is already in progress'],
      lastError: null,
    }

  const outcome = await runIllustration(postId, {
    model,
    deadlineAt,
    publish,
    spendImage,
    fence: claim.startedAt,
  })

  const fresh = await PostModel.findById(postId)
    .select('+bodyMarkdown +bodyHtml')
    .lean()
  if (fresh) {
    post.status = fresh.status
    post.publishedAt = fresh.publishedAt
    post.coverImage = fresh.coverImage
    post.bodyMarkdown = fresh.bodyMarkdown
    post.bodyHtml = fresh.bodyHtml
  }
  return outcome
}
