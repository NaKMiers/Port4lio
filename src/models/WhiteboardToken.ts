import mongoose, { Schema, type Types } from 'mongoose'

import { compileModel } from '@/lib/mongoose-model'

/**
 * A revocable, read-only agent token for the whiteboard (Claude Code, Codex).
 *
 * Only the sha256 of the token is stored. The plaintext `wbt_...` is shown once, in the
 * response that created it, and never again - so a database dump does not hand anyone agent
 * access. `prefix` is the first 8 characters, enough for the owner to tell two tokens apart
 * in the list without it being a usable secret.
 *
 * Revoke sets `revokedAt` and keeps the record, so the list can still show it greyed out.
 * See `lib/whiteboard/token.ts` for verification and the throttled `lastUsedAt` touch.
 */

export type WhiteboardTokenDocument = {
  _id: Types.ObjectId
  name: string
  prefix: string
  hash: string
  lastUsedAt: Date | null
  revokedAt: Date | null
  createdAt: Date
}

const whiteboardTokenSchema = new Schema<WhiteboardTokenDocument>(
  {
    name: { type: String, required: true, maxlength: 80 },
    prefix: { type: String, required: true },
    hash: { type: String, required: true, unique: true },
    lastUsedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
  },
  {
    collection: 'whiteboard_tokens',
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false,
  }
)

export const WhiteboardTokenModel: mongoose.Model<WhiteboardTokenDocument> =
  compileModel('WhiteboardToken', whiteboardTokenSchema)
