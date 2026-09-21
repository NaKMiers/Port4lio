import mongoose, { Schema } from 'mongoose'

/**
 * Acknowledgement state for outbound publish targets.
 *
 * A separate collection from the profile on purpose: acking LinkedIn must not touch the
 * profile's `updatedAt` or invalidate the `public-profile` cache tag.
 */
export const PUBLISH_STATE_DOCUMENT_ID = 'publish-state'

const publishTargetStateSchema = new Schema(
  {
    targetId: { type: String, default: '' },
    /** The artifact hash the owner (or the workflow) last confirmed as published. */
    ackedVersion: { type: String, default: '' },
    ackedAt: { type: Date, default: null },
    /** Workflow outcome for auto targets: applied | unchanged | failed. */
    lastResult: { type: String, default: '' },
    lastRunAt: { type: Date, default: null },
    /** Commit sha, error message, or similar breadcrumb. */
    detail: { type: String, default: '' },
  },
  { _id: false }
)

const publishStateSchema = new Schema(
  {
    _id: { type: String, default: PUBLISH_STATE_DOCUMENT_ID },
    targets: { type: [publishTargetStateSchema], default: [] },
    updatedAt: { type: Date },
  },
  {
    collection: 'publishState',
    versionKey: false,
  }
)

export const PublishStateModel =
  mongoose.models.PublishState ??
  mongoose.model('PublishState', publishStateSchema)
