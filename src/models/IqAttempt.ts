import mongoose, { Schema } from 'mongoose'

import { ATTEMPT_TTL_DAYS } from '@/models/Attempt'

/**
 * One IQ attempt, across its two phases.
 *
 * ```
 *   POST /api/iq/start          POST /api/iq/submit
 *        │                            │
 *        ▼                            ▼
 *   { _id, seed, startedAt }  ──▶  { ...,  answers, raw, score, submittedAt }
 *        │                            │
 *        └──────────────▶ /[lang]/iq/result/<token>
 * ```
 *
 * ## Why two phases, unlike `Attempt`
 *
 * MBTI creates its row at submit, which is simpler and right for an untimed test. IQ has a
 * 24-minute clock, and a clock the client owns is not a clock - anyone can pause it. So the
 * server records `startedAt` when the test is issued and checks it at submit. That requires
 * a row to exist before any answer does, which is why `answers` and the score fields are
 * optional here and required on `Attempt`.
 *
 * ## Why the seed is stored and the items are not
 *
 * The 26 items are a pure function of the seed AND the generator version (`lib/iq/items`).
 * Storing both means the exact test somebody sat can be re-rendered months later without
 * persisting any geometry - and it makes the answer key recomputable rather than stored, so
 * there is no key in the database to leak.
 *
 * The version is not metadata. A seed names a test only in combination with the generator
 * that built it; the moment a second generator exists, the same seed names two different
 * tests, and scoring an old attempt with a new generator grades a taker against a test they
 * never saw - returning a number that looks entirely plausible and means nothing.
 *
 * ## Retention
 *
 * Same TTL as `Attempt`, and for the same reason: one retention window means the privacy
 * notice states one number. Buying a certificate does not extend it - the certificate is a
 * separate, deliberately public document that outlives the attempt.
 */

export type IqAttemptDocument = {
  /** The capability token. Holding the URL is the whole claim - see `lib/tokens.ts`. */
  _id: string
  /** Regenerates the 26 items and the answer key. Never exposed to the client. */
  seed: number
  /**
   * Which generator built this attempt's items. Written at start, read at submit, never changed.
   *
   * Read as `attempt.generatorVersion ?? 1` at the call site rather than relying on the
   * schema default: `findOneAndUpdate({ lean: true })` skips hydration, so a row written
   * before this field existed comes back with it genuinely absent. Every such row is
   * version 1 by definition, so no backfill is needed.
   */
  generatorVersion: number
  locale: string
  startedAt: Date
  submittedAt: Date | null
  /** One option index per item, -1 for skipped. Null until submitted. */
  answers: number[] | null
  raw: number | null
  score: number | null
  percentile: number | null
  band: string | null
  /**
   * Whether the full result has been paid for.
   *
   * Exactly `Attempt.paid`'s role, and always `false` in free mode because nothing creates
   * an `IqPayment` then - so flipping `IQ_RESULT_PRICE` to 0 releases every existing
   * attempt rather than leaving old ones stranded behind a paywall that no longer exists.
   */
  paid: boolean
  /**
   * Whether the result was released free because the attempt measures nothing.
   *
   * Decided once, at submit, and stored rather than recomputed: the result page, the
   * checkout route and any later audit must agree, and a threshold that moves must not
   * retroactively start charging someone who was already told their result was free.
   *
   * Distinct from `paid` on purpose. Conflating them would report a free unlock as revenue.
   * See `lib/test-kit/effort.ts` for the rule.
   */
  waived: boolean
  /**
   * The buyer's address, written at checkout.
   *
   * Lives on `IqPayment` until payment settles, then copied here - so an attempt that never
   * enters checkout holds nothing that identifies a person, the same rule `Attempt` follows.
   */
  email: string | null
  /**
   * Public certificate id, minted at purchase. NEVER the attempt token.
   *
   * The certificate is designed to be posted, unfurled and verified by strangers; the
   * attempt token is a credential. Reusing one as the other would mean every buyer
   * broadcasts access to their own private result, and it could not be walked back because
   * a certificate nobody can fetch is a certificate nobody can verify.
   */
  certificateId: string | null
  certificateName: string | null
  certificateIssuedAt: Date | null
  createdAt: Date
  expireAt: Date
}

export function iqAttemptExpiryFrom(now: Date): Date {
  return new Date(now.getTime() + ATTEMPT_TTL_DAYS * 24 * 60 * 60 * 1000)
}

const iqAttemptSchema = new Schema(
  {
    _id: { type: String, required: true },
    seed: { type: Number, required: true },
    generatorVersion: { type: Number, required: true, default: 1 },
    locale: { type: String, required: true },
    startedAt: { type: Date, required: true },
    submittedAt: { type: Date, default: null },
    paid: { type: Boolean, required: true, default: false },
    waived: { type: Boolean, required: true, default: false },
    email: { type: String, default: null },
    answers: { type: [Number], default: null },
    raw: { type: Number, default: null },
    score: { type: Number, default: null },
    percentile: { type: Number, default: null },
    band: { type: String, default: null },
    certificateId: { type: String, default: null },
    certificateName: { type: String, default: null },
    certificateIssuedAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
    expireAt: { type: Date, required: true },
  },
  {
    collection: 'iqAttempts',
    versionKey: false,
  }
)

/**
 * Unique across issued certificates only.
 *
 * A **partial** index, not a sparse one, and the difference is load-bearing. `sparse` skips
 * documents where the field is *missing*; this schema declares `default: null`, so the
 * field is present-and-null on every unsold attempt. A sparse unique index therefore does
 * NOT skip them - it sees a second `null` as a duplicate key and rejects the second attempt
 * ever created, which is a 500 on `/api/iq/start` for everyone but the first visitor.
 *
 * Caught by starting two tests instead of one. The first call succeeded, so the bug was
 * invisible to any check that only exercised the happy path once.
 *
 * `$type: 'string'` is what restricts the constraint to rows that actually hold a
 * certificate id, leaving every null out of the index entirely.
 */
iqAttemptSchema.index(
  { certificateId: 1 },
  { unique: true, partialFilterExpression: { certificateId: { $type: 'string' } } }
)

iqAttemptSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 })

iqAttemptSchema.on('index', (error: unknown) => {
  if (error) {
    console.error('[IqAttempt] index build FAILED - retention or certificate uniqueness is not enforced', error)
  }
})

export const IqAttemptModel: mongoose.Model<IqAttemptDocument> =
  (mongoose.models.IqAttempt as mongoose.Model<IqAttemptDocument>) ??
  mongoose.model<IqAttemptDocument>('IqAttempt', iqAttemptSchema)
