import mongoose, { Schema } from 'mongoose'

/**
 * The owner's progress through the CCA-F study plan. One document, forever.
 *
 * ```
 *   GET  /api/ccaf ──▶ findById('ccaf-progress') ──▶ { state } | defaults when absent
 *                                  ▲
 *   PUT  /api/ccaf ──▶ owner gate ─┘  $set whole state + updatedAt, $setOnInsert createdAt
 * ```
 *
 * ## Why one document and not one per task
 *
 * A row per ticked task is the shape you would reach for if many people tracked many
 * plans. Nobody does: this is one person against one fixed plan, every read wants the
 * whole thing at once, and every write is "here is the new state" from a single tab. A
 * collection would buy queryability nothing queries, and cost an N-document read on every
 * page load plus the ability to observe a half-applied save.
 *
 * The cap that makes this safe is `sanitizeState` in `lib/ccaf/progress.ts`: task ids must
 * exist in the roadmap, mocks are capped at 50, and confidence is a fixed five entries. So
 * the document has a bounded maximum size - roughly 68 short ids plus 50 small mock
 * objects - and cannot be grown without bound by a client that keeps writing.
 *
 * ## Why the stored shape differs from the old tracker's
 *
 * The predecessor kept `{ tasks: { 'w1-0-0': true } }` because `localStorage` holds a blob.
 * Dynamic keys are a poor fit for Mongo - unindexable, and a dot in a key is rejected - so
 * ticks are an array of ids here. A parser for the old shape used to live alongside this
 * one for the page's paste-a-snapshot panel; both are gone, the migration having happened
 * exactly once. This collection is the only store now.
 *
 * ## Why there is no TTL
 *
 * Every other model here expires, because every other model holds a stranger's data and
 * the privacy notice promises a retention window. This holds the site owner's own study
 * notes, entered by the owner, about a plan with a fixed end date. There is nobody to
 * forget, and a TTL would quietly delete the record of a certification the portfolio
 * points at. `expireAt` is deliberately absent rather than nullable, so no future reader
 * has to work out which rows are exempt.
 */

/** Singleton `_id`. Same idiom as `Profile`. */
export const CCAF_PROGRESS_DOCUMENT_ID = 'ccaf-progress'

export type CcafMockRecord = {
  /** Client-minted id, used only as a React key and to delete the right row. */
  id: string
  /** ISO `YYYY-MM-DD` the mock was sat. */
  date: string
  /** Short label, e.g. `Đề 1`. */
  label: string
  /** Correct answers out of 60. */
  correct: number
  /**
   * Percent correct per domain, index 0 = domain 1, `null` where the mock did not report
   * one. Fixed length five - see `lib/ccaf/progress.ts` for why a hole is not a zero.
   */
  domainPercents: (number | null)[]
}

export type CcafProgressDocument = {
  _id: string
  /** Ids of completed tasks, validated against the roadmap before every write. */
  doneTaskIds: string[]
  /** Self-rated 0-5 per domain, index 0 = domain 1. Always five entries. */
  confidence: number[]
  mocks: CcafMockRecord[]
  /** Ids of ticked exam-day checklist rows (`ck1`..`ck8`). */
  doneCheckIds: string[]
  /** ISO `YYYY-MM-DD` of the booked exam. */
  examDate: string
  createdAt: Date
  /** `$set` by the writer on every save - there is no `timestamps: true` in this repo. */
  updatedAt: Date
}

const ccafMockSchema = new Schema(
  {
    id: { type: String, required: true },
    date: { type: String, required: true },
    label: { type: String, required: true },
    correct: { type: Number, required: true, min: 0, max: 60 },
    domainPercents: { type: [Schema.Types.Number], default: [] },
  },
  { _id: false }
)

const ccafProgressSchema = new Schema(
  {
    _id: { type: String, default: CCAF_PROGRESS_DOCUMENT_ID },
    doneTaskIds: { type: [String], default: [] },
    confidence: { type: [Number], default: () => [0, 0, 0, 0, 0] },
    mocks: { type: [ccafMockSchema], default: [] },
    doneCheckIds: { type: [String], default: [] },
    examDate: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  {
    collection: 'ccafProgress',
    versionKey: false,
  }
)

export const CcafProgressModel: mongoose.Model<CcafProgressDocument> =
  (mongoose.models.CcafProgress as mongoose.Model<CcafProgressDocument>) ??
  mongoose.model<CcafProgressDocument>('CcafProgress', ccafProgressSchema)
