import mongoose, { Schema } from 'mongoose'

import { compileModel } from '@/lib/mongoose-model'
import type { VocabMeaning, VocabStatus } from '@/lib/whiteboard/vocab'

/**
 * The whiteboard's meanings and statuses (`lib/whiteboard/vocab.ts`), as ONE document with
 * `_id: 'vocab'`. Array order is display order.
 *
 * Seeded from `DEFAULT_VOCAB` by the first read that finds none (`$setOnInsert`), and never
 * again - so an owner who deletes "draft" does not get it back on the next request. Every
 * change is a conditional write on `updatedAt` (vocab-service.ts).
 *
 * The entries are plain subdocuments without `_id`: the `key` is their identity, and items
 * store it.
 */

export const VOCAB_DOC_ID = 'vocab'

export type WhiteboardVocabDocument = {
  _id: string
  meanings: VocabMeaning[]
  statuses: VocabStatus[]
  createdAt: Date
  updatedAt: Date
}

const meaningSchema = new Schema<VocabMeaning>(
  {
    key: { type: String, required: true },
    label: { type: String, required: true },
    tone: { type: String, required: true },
    icon: { type: String, default: null },
    tracksStatus: { type: Boolean, default: false },
  },
  { _id: false }
)

const statusSchema = new Schema<VocabStatus>(
  {
    key: { type: String, required: true },
    label: { type: String, required: true },
  },
  { _id: false }
)

const whiteboardVocabSchema = new Schema<WhiteboardVocabDocument>(
  {
    _id: { type: String, required: true },
    meanings: { type: [meaningSchema], default: [] },
    statuses: { type: [statusSchema], default: [] },
  },
  { collection: 'whiteboard_vocab', timestamps: true, versionKey: false }
)

export const WhiteboardVocabModel: mongoose.Model<WhiteboardVocabDocument> =
  compileModel('WhiteboardVocab', whiteboardVocabSchema)
