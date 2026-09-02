import mongoose, { Schema } from 'mongoose'

import type { Axis } from '@/lib/mbti/types'

/**
 * One completed MBTI test.
 *
 * ```
 *   POST /api/mbti/submit
 *        │
 *        ▼
 *   score(answers) ──▶ Attempt { _id: <token>, type, scores, expireAt: +21d }
 *        │                          │
 *        │                          ▼
 *        └────────────▶ /[lang]/mbti/result/<token>
 * ```
 *
 * `_id` IS the capability token. That follows the string-id convention already used by
 * `Profile` and `PublishState`, and it means the unique index and the lookup
 * (`findById(token)`) come free, with no second field that can drift out of sync.
 *
 * There is no user reference because there are no users. Holding the URL is the whole
 * claim to this document - see `lib/tokens.ts` for why that is deliberate.
 */

export type AttemptDocument = {
  _id: string
  type: string
  scores: Record<Axis, { a: number; b: number }>
  /** Positional, aligned to `QUESTIONS`. Kept so a future scoring change can be replayed. */
  answers: string[]
  locale: string
  /**
   * Whether the full result has been paid for.
   *
   * Always `false` in free mode - nothing ever sets it, because no `Payment` is created.
   * That means flipping `MBTI_RESULT_PRICE` to 0 releases every existing attempt rather
   * than leaving old ones locked behind a paywall that no longer exists.
   *
   * The buyer's email lives on `Payment`, not here: an attempt that never enters checkout
   * must hold nothing that identifies a person.
   */
  paid: boolean
  /**
   * Whether the result was released free because the answers are a pattern, not an opinion.
   *
   * Decided at submit and stored, so the result page and the checkout route cannot disagree
   * and a later threshold change cannot start charging someone already told it was free.
   * Never conflated with `paid` - that counter is revenue. See `lib/test-kit/effort.ts`.
   */
  waived: boolean
  createdAt: Date
  /**
   * TTL anchor. Mongo deletes the document once this timestamp passes.
   *
   * Two jobs in one field: it bounds how long stranger data is retained (what the privacy
   * notice promises) and it is why a result link stops working after `ATTEMPT_TTL_DAYS`.
   *
   * Paying does NOT extend it. That is a deliberate reversal of an earlier design where a
   * purchase cleared this field: the result email now carries the full result - type, axis
   * breakdown and overview - so a buyer keeps a permanent copy of what they bought without
   * the site holding their answers indefinitely. One retention rule for everyone is also
   * one sentence in the privacy notice instead of two.
   */
  expireAt: Date | null
}

/**
 * How long any result stays readable, paid or free.
 *
 * The single source of truth. The privacy notice, the result page's keep-this-link warning
 * and the result email all interpolate this constant rather than writing the number, so
 * there is no second copy to fall out of sync when it changes.
 */
export const ATTEMPT_TTL_DAYS = 21

export function attemptExpiryFrom(now: Date): Date {
  return new Date(now.getTime() + ATTEMPT_TTL_DAYS * 24 * 60 * 60 * 1000)
}

const axisScoreSchema = new Schema(
  {
    a: { type: Number, required: true, min: 0 },
    b: { type: Number, required: true, min: 0 },
  },
  { _id: false }
)

const attemptSchema = new Schema(
  {
    _id: { type: String, required: true },
    type: { type: String, required: true },
    scores: {
      EI: { type: axisScoreSchema, required: true },
      SN: { type: axisScoreSchema, required: true },
      TF: { type: axisScoreSchema, required: true },
      JP: { type: axisScoreSchema, required: true },
    },
    answers: { type: [String], required: true },
    locale: { type: String, required: true },
    paid: { type: Boolean, required: true, default: false },
    waived: { type: Boolean, required: true, default: false },
    createdAt: { type: Date, default: Date.now },
    expireAt: { type: Date, default: null },
  },
  {
    collection: 'mbtiAttempts',
    versionKey: false,
  }
)

/**
 * `expireAfterSeconds: 0` means "delete when `expireAt` is in the past" rather than
 * "delete N seconds after `expireAt`". Documents with `expireAt: null` are skipped by the
 * TTL monitor entirely, which is exactly how paid attempts are exempted.
 */
attemptSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 })

/**
 * Index builds happen in the background and report failures through an event, not a
 * rejected promise. Without this listener a failed TTL build is completely silent - and
 * the failure mode is that attempt data is retained forever while `/[lang]/mbti/privacy`
 * tells visitors it is deleted after 90 days. A broken promise about someone else's data
 * is worth a loud log.
 */
attemptSchema.on('index', (error: unknown) => {
  if (error) {
    console.error('[Attempt] TTL index build FAILED - retention is not being enforced', error)
  }
})

export const AttemptModel: mongoose.Model<AttemptDocument> =
  (mongoose.models.Attempt as mongoose.Model<AttemptDocument>) ??
  mongoose.model<AttemptDocument>('Attempt', attemptSchema)
