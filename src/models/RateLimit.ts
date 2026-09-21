import mongoose, { Schema } from 'mongoose'

/**
 * One counter per (bucket, window).
 *
 * Lives in Mongo rather than in memory because every route handler here runs in an
 * isolated serverless invocation: a module-scope `Map` is a fresh empty map on most
 * requests, so it would enforce nothing while looking, in code review, like it did.
 *
 * Mongo rather than Redis because Mongo is already in the stack. A dedicated rate-limit
 * store is the right answer at traffic this product does not have, and it would add a
 * second datastore, a second set of credentials, and a second thing that can be down.
 */

export type RateLimitDocument = {
  /** `<route>:<ip>:<window-start-epoch>` - the window is baked into the key, so no updates race. */
  _id: string
  count: number
  expireAt: Date
}

const rateLimitSchema = new Schema(
  {
    _id: { type: String, required: true },
    count: { type: Number, required: true, default: 0 },
    expireAt: { type: Date, required: true },
  },
  {
    collection: 'mbtiRateLimits',
    versionKey: false,
  }
)

// Mongo's TTL monitor runs about once a minute, so documents can outlive `expireAt`
// briefly. That is harmless here: the window is part of the `_id`, so a stale document
// belongs to a window nothing will look up again.
rateLimitSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 })

// Same reasoning as Attempt: a silent index failure here means counter documents pile up
// forever instead of expiring. Less severe than the retention promise, same blind spot.
rateLimitSchema.on('index', (error: unknown) => {
  if (error)
    console.error(
      '[RateLimit] TTL index build failed - counters will not expire',
      error
    )
})

export const RateLimitModel: mongoose.Model<RateLimitDocument> =
  (mongoose.models.RateLimit as mongoose.Model<RateLimitDocument>) ??
  mongoose.model<RateLimitDocument>('RateLimit', rateLimitSchema)
