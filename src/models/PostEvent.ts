import mongoose, { Schema } from 'mongoose'

import { compileModel } from '@/lib/mongoose-model'

/**
 * What readers did on the blog. A second event collection, deliberately separate from
 * `TestEvent`.
 *
 * ```
 *   _id = blog:<kind>:<subject>
 *
 *   blog:view:<slug>:<session>       one reader, one post   ← idempotent by construction
 *   blog:share:<token>               one minted share link
 *   blog:attribute:<token>:<session> one arrival from one
 * ```
 *
 * ## Why this is not `TestEvent` with a `product: 'blog'`
 *
 * That was the obvious consolidation and it is wrong on three independent axes, any one of
 * which would be enough:
 *
 * **Different retention.** `testEventExpiryFrom` hardcodes `ATTEMPT_TTL_DAYS = 21`, and
 * `tests/api/retention.test.ts` asserts that window under the name *"TestEvent retention
 * matches Attempt, so one sentence covers both"*. Blog events keep 180 days, because the
 * question they answer - did writing anything change anything - is asked over months, not
 * over the three weeks a test result lives. Putting both in one collection means either
 * breaking that test's promise or giving the blog a window too short to measure with.
 *
 * **Different id grammar.** `TestEvent._id` is `<product>:<kind>:<subject>` where subject is
 * an attempt token. Here the subject is a slug plus a client-chosen session id. Sharing a
 * collection means one `_id` parser that has to know about both, which is how a share row
 * for one product silently collides with a view row for another.
 *
 * **Different privacy promise.** `TestEvent` is covered by `/[lang]/mbti/privacy`, which
 * promises one retention window for everything the tests store. Blog events are not inside
 * that promise; they are described by `/blog/privacy`, which states all three regimes.
 *
 * Same idempotent-upsert SHAPE as `lib/test-events.ts` `recordEvent`, deliberately
 * duplicated rather than extracted. Two call sites with different shapes is not enough to
 * justify a shared helper, and extracting it would strand the doc comments at
 * `test-events.ts:34-40` and `:111-117` on an empty wrapper. Revisit at three collections.
 *
 * ## The counting rule, inherited and non-negotiable
 *
 * The subject is in the `_id`, so a repeat write UPDATES one document instead of adding a
 * second. Duplicates are arithmetically impossible rather than filtered out by a query
 * somebody has to remember to write. `count` is therefore **not** the metric - it is a
 * diagnostic recording how many times this one thing re-fired.
 *
 * **Rates are computed by counting documents. A `$sum: '$count'` anywhere in an aggregation
 * over this collection is a bug.**
 *
 * ## What this collection cannot tell you, stated plainly
 *
 * `sessionId` is chosen by the client. Accidental double-counting is impossible; deliberate
 * inflation is not, and is bounded only by the rate limit. So "unique readers" here is
 * **advisory, not evidence**. It is honest as a trend and worthless as a number to quote.
 * The kill criterion deliberately does not read it - that is `ContactMessage.sourceSlug`,
 * which requires a human to have written a sentence.
 */

/** Six months. Long enough to answer a question asked in months. */
export const BLOG_EVENT_TTL_DAYS = 180

export function postEventExpiryFrom(now: Date): Date {
  return new Date(now.getTime() + BLOG_EVENT_TTL_DAYS * 24 * 60 * 60 * 1000)
}

export type PostEventKind = 'view' | 'share' | 'attribute'

export type PostEventDocument = {
  /** `blog:<kind>:<subject>`. The subject is what makes a repeat write idempotent. */
  _id: string
  kind: PostEventKind
  /** Denormalised so the aggregation never has to parse `_id`. */
  slug: string
  /** How many times this exact thing re-fired. Diagnostic only - never sum this for a rate. */
  count: number
  /** Whether a browser reported this. Everything here is browser-reported today. */
  clientReported: boolean
  createdAt: Date
  expireAt: Date
}

const postEventSchema = new Schema<PostEventDocument>(
  {
    _id: { type: String, required: true },
    kind: { type: String, enum: ['view', 'share', 'attribute'], required: true },
    slug: { type: String, required: true },
    count: { type: Number, required: true, default: 1 },
    clientReported: { type: Boolean, required: true, default: true },
    createdAt: { type: Date, required: true },
    expireAt: { type: Date, required: true },
  },
  {
    collection: 'postEvents',
    versionKey: false,
    _id: false,
  }
)

/** The admin aggregation: every event for one slug, newest first. */
postEventSchema.index({ slug: 1, kind: 1, createdAt: -1 })

postEventSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 })

/**
 * Index builds report failure through an event, not a rejected promise. Without this a failed
 * TTL build is silent, and the failure mode is that a browsing trace of every reader is kept
 * forever while `/blog/privacy` says it is deleted after 180 days. Same blind spot `TestEvent`,
 * `Attempt` and `RateLimit` all guard - and note this does NOT fire when an index builds
 * successfully on the wrong collection, which is why `tests/api` asserts the index exists
 * rather than trusting this alone.
 */
postEventSchema.on('index', (error: unknown) => {
  if (error) {
    console.error('[PostEvent] TTL index build FAILED - retention is not being enforced', error)
  }
})

export const PostEventModel: mongoose.Model<PostEventDocument> = compileModel(
  'PostEvent',
  postEventSchema
)
