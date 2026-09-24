import mongoose, { Schema, type Types } from 'mongoose'

import { compileModel } from '@/lib/mongoose-model'
import { SHARE_MODES, type ShareMode } from '@/lib/whiteboard/limits'

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
 *
 * ## Sharing: a link, and nothing else
 *
 * ```
 *   share  'off'  ──▶ /whiteboard/<slug|id> is a 404, the same as a board that never existed
 *          'view' ──▶ anyone with the link sees the canvas; every write is a 403
 *          'edit' ──▶ anyone with the link edits it, through the same save queue as the owner
 * ```
 *
 * There is no invite list and no account: the URL is the whole credential, which is what
 * "share via link" means. `slug` is an optional readable name for that URL, renamed from the
 * owner's canvas; the board id keeps working too, so a link handed out before a rename still
 * opens. Off is the default and a new board starts off - sharing is always something the
 * owner turned on for one board, never something a board inherits.
 *
 * The id form is an accepted trade-off (D34): it cannot be rotated - turning sharing off is
 * the only revoke - and ids made close together by one server run are guessable from each
 * other. A random, resettable share key is the upgrade if that stops being acceptable.
 *
 * The slug index is unique only over documents that HAVE one (partial filter), so any number
 * of boards can sit without a slug. A plain `sparse` index would do the same for a missing
 * field, but not for an explicit `null`, and clearing a slug is an `$unset` precisely so
 * neither shape ever has to be reasoned about.
 */

export type WhiteboardBoardDocument = {
  _id: Types.ObjectId
  title: string
  includeInAi: boolean
  share: ShareMode
  slug?: string
  createdAt: Date
  updatedAt: Date
}

const whiteboardBoardSchema = new Schema<WhiteboardBoardDocument>(
  {
    title: { type: String, default: '' },
    includeInAi: { type: Boolean, default: true },
    share: { type: String, enum: SHARE_MODES, default: 'off' },
    slug: { type: String },
  },
  { collection: 'whiteboard_boards', timestamps: true, versionKey: false }
)

whiteboardBoardSchema.index({ createdAt: 1 })
whiteboardBoardSchema.index(
  { slug: 1 },
  { unique: true, partialFilterExpression: { slug: { $type: 'string' } } }
)

export const WhiteboardBoardModel: mongoose.Model<WhiteboardBoardDocument> =
  compileModel('WhiteboardBoard', whiteboardBoardSchema)
