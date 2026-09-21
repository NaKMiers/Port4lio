import mongoose, { Schema } from 'mongoose'

import { ATTEMPT_TTL_DAYS } from '@/models/Attempt'

/**
 * One measurable thing that happened, for any test.
 *
 * ```
 *   share      result page ──▶ mint token ──▶ mbti:share:<shareToken>
 *                                  │
 *   attribute  /vi/mbti/enfj?s=<tok> ──▶ mbti:attribute:<shareToken>:<sessionId>
 *                                  │
 *   progress   test abandoned ──▶ mbti:progress:<sessionId>          ($max furthest)
 *                                  │
 *   funnel     server code ─────▶ mbti:funnel:paid:2026-09-02        ($inc count)
 * ```
 *
 * ## Why the `_id` carries the meaning
 *
 * Every write is an upsert against a key that *describes the thing being counted*, the
 * same trick `RateLimit` uses for its window. That is not a storage nicety - it is the
 * correctness property this whole collection exists for.
 *
 * Three separate things re-fire the same real-world event: React StrictMode double-invokes
 * effects in development, a visitor refreshing re-runs the attribution beacon, and
 * `visibilitychange` fires on every tab switch during a test. With append-only rows each
 * of those inflates the share rate - and an inflated share rate is the failure mode that
 * *looks like success*, so it would be believed, built on, and only discovered later.
 *
 * With the subject in the `_id`, a repeat write updates one document instead of adding a
 * second. Duplicates are arithmetically impossible rather than filtered out by a query
 * somebody has to remember to write.
 *
 * `count` is therefore NOT the metric. It is a diagnostic: how many times this one thing
 * re-fired. Rates are computed by counting *documents*, never by summing `count`.
 *
 * ## Trust
 *
 * `clientReported` records provenance. Anything a browser can POST is advisory - see
 * `api/event/route.ts`, which refuses server-authoritative kinds outright, so `funnel`
 * rows for `paid` cannot be forged by anyone who can reach the internet.
 *
 * ## Retention
 *
 * Same TTL as `Attempt`, deliberately. These rows are a behavioural trace of a stranger and
 * must not outlive the result they describe.
 *
 * Amended when the blog shipped: the site no longer has ONE retention window, so the old
 * phrasing here ("`/[lang]/mbti/privacy` promises one retention window; this collection is
 * inside that promise") is no longer the whole story. `ContactMessage` has **no** TTL at all,
 * deliberately - correspondence is not a behavioural trace and expiring it would delete the
 * owner's own inbox on a timer. That collection is outside the MBTI notice entirely, which is
 * why `/blog/privacy` exists and states all of the regimes in one place, interpolating the
 * constants rather than repeating the numbers.
 *
 * What is unchanged is the claim that matters for THIS collection: it is a behavioural trace,
 * it shares `Attempt`'s window, and the MBTI notice covers it. `tests/api/retention.test.ts`
 * asserts the equality and `tests/unit/retention.test.ts` pins the number itself, so neither
 * half can drift without a test naming it.
 */

export type TestEventKind = 'share' | 'attribute' | 'progress' | 'funnel'

export type TestEventDocument = {
  /** `<product>:<kind>:<subject>`. The subject is what makes a repeat write idempotent. */
  _id: string
  product: string
  kind: TestEventKind
  /** Only for `funnel`: `result-viewed`, `paywall-seen`, `checkout-started`, `paid`. */
  event: string | null
  /** How many times this exact thing re-fired. Diagnostic only - never sum this for a rate. */
  count: number
  /** Whether a browser reported this, or server code did. See `api/event/route.ts`. */
  clientReported: boolean
  /** Kind-specific payload: `{type}` for share, `{furthest, total}` for progress. */
  data: Record<string, unknown>
  createdAt: Date
  expireAt: Date
}

export function testEventExpiryFrom(now: Date): Date {
  return new Date(now.getTime() + ATTEMPT_TTL_DAYS * 24 * 60 * 60 * 1000)
}

/** `2026-09-02`. Funnel counters bucket by day so a time series comes free from the key. */
export function dayBucket(now: Date): string {
  return now.toISOString().slice(0, 10)
}

export const testEventId = {
  share: (product: string, shareToken: string) =>
    `${product}:share:${shareToken}`,
  attribute: (product: string, shareToken: string, sessionId: string) =>
    `${product}:attribute:${shareToken}:${sessionId}`,
  progress: (product: string, sessionId: string) =>
    `${product}:progress:${sessionId}`,
  funnel: (product: string, event: string, day: string) =>
    `${product}:funnel:${event}:${day}`,
}

const testEventSchema = new Schema(
  {
    _id: { type: String, required: true },
    product: { type: String, required: true },
    kind: {
      type: String,
      required: true,
      enum: ['share', 'attribute', 'progress', 'funnel'],
    },
    event: { type: String, default: null },
    count: { type: Number, required: true, default: 0 },
    clientReported: { type: Boolean, required: true, default: false },
    data: { type: Schema.Types.Mixed, default: {} },
    createdAt: { type: Date, default: Date.now },
    expireAt: { type: Date, required: true },
  },
  {
    collection: 'testEvents',
    versionKey: false,
  }
)

/**
 * The `_id` gives uniqueness for free but says nothing about *reading*. The admin page
 * groups by kind over a date range, which without this index is a collection scan the
 * first time there is real data in here.
 */
testEventSchema.index({ product: 1, kind: 1, createdAt: -1 })

testEventSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 })

/**
 * Index builds report failure through an event, not a rejected promise. Without this a
 * failed TTL build is silent, and the failure mode is that a behavioural trace of every
 * visitor is retained forever while the privacy notice says it is deleted. Same blind spot
 * `Attempt` and `RateLimit` both guard - and note that this listener does NOT fire when an
 * index builds *successfully on the wrong collection*, which is why `tests/api` asserts
 * the index exists rather than trusting this alone.
 */
testEventSchema.on('index', (error: unknown) => {
  if (error)
    console.error(
      '[TestEvent] TTL index build FAILED - retention is not being enforced',
      error
    )
})

export const TestEventModel: mongoose.Model<TestEventDocument> =
  (mongoose.models.TestEvent as mongoose.Model<TestEventDocument>) ??
  mongoose.model<TestEventDocument>('TestEvent', testEventSchema)
