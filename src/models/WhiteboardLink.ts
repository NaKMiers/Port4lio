import mongoose, { Schema, type Types } from 'mongoose'

import { compileModel } from '@/lib/mongoose-model'

/**
 * A labelled arrow between two whiteboard items ("because", "blocks", "learned from").
 *
 * `{ from, to, label }` is unique: a duplicate is rejected, not merged. The check in
 * `data.ts` only looks at links with a DIFFERENT `_id`, so a retried create of the same
 * client id is a harmless replay rather than a permanent 400 (R3-4). The index is the
 * backstop for two concurrent creates of different ids.
 *
 * Either end can be missing after an interrupted delete (the sequence is not a transaction).
 * Every read joins against visible items, so a dangling link is simply never rendered.
 */

export type WhiteboardLinkDocument = {
  _id: Types.ObjectId
  from: Types.ObjectId
  to: Types.ObjectId
  label: string
  fromHandle: string | null
  toHandle: string | null
  createdAt: Date
  updatedAt: Date
}

const whiteboardLinkSchema = new Schema<WhiteboardLinkDocument>(
  {
    _id: { type: Schema.Types.ObjectId, required: true },
    from: { type: Schema.Types.ObjectId, required: true },
    to: { type: Schema.Types.ObjectId, required: true },
    label: { type: String, default: '' },
    fromHandle: { type: String, default: null },
    toHandle: { type: String, default: null },
  },
  { collection: 'whiteboard_links', timestamps: true, versionKey: false }
)

whiteboardLinkSchema.index({ from: 1, to: 1, label: 1 }, { unique: true })
whiteboardLinkSchema.index({ from: 1 })
whiteboardLinkSchema.index({ to: 1 })

export const WhiteboardLinkModel: mongoose.Model<WhiteboardLinkDocument> =
  compileModel('WhiteboardLink', whiteboardLinkSchema)
