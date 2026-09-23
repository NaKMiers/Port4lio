import mongoose, { Schema, type Types } from 'mongoose'

import { compileModel } from '@/lib/mongoose-model'

/**
 * One whiteboard (D32). A board is a title, a privacy switch, and the scope every item and
 * link belongs to.
 *
 * ```
 *   board ──┬── items  (boardId)     a card only ever exists on one board
 *           └── links  (boardId)     both ends are items of the same board
 *
 *   includeInAi  false ──▶ nothing on this board reaches an agent, whatever each card says
 * ```
 *
 * ## Why the switch is here and not only on items
 *
 * It is the frame rule (rule 8) one level up, for the same reason: a whole board is often
 * one context - a scratch board, a client's work, something half-thought - and saying so
 * once is honest, whereas asking the owner to remember to hide fifty cards one at a time is
 * a privacy control that fails quietly the first time they forget. `loadAgentVisible` reads
 * the visible board ids first and every agent query is filtered by them, so a hidden board
 * cannot leak through a path that forgot to ask.
 *
 * ## Why there is always at least one
 *
 * The canvas is the product; a board picker with nothing in it is a dead end. `ensureBoards`
 * creates "Whiteboard" on the first read that finds none, and the same call adopts the items
 * written before boards existed - the migration is that one line, and it only ever runs
 * while no board exists. Two first reads at once can both get there; `ensureBoards` keeps
 * the oldest board and drops the other, so the adoption still has exactly one target.
 */

export type WhiteboardBoardDocument = {
  _id: Types.ObjectId
  title: string
  includeInAi: boolean
  createdAt: Date
  updatedAt: Date
}

const whiteboardBoardSchema = new Schema<WhiteboardBoardDocument>(
  {
    title: { type: String, default: '' },
    includeInAi: { type: Boolean, default: true },
  },
  { collection: 'whiteboard_boards', timestamps: true, versionKey: false }
)

whiteboardBoardSchema.index({ createdAt: 1 })

export const WhiteboardBoardModel: mongoose.Model<WhiteboardBoardDocument> =
  compileModel('WhiteboardBoard', whiteboardBoardSchema)
