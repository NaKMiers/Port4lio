import mongoose, { Schema, type Types } from 'mongoose'

import { compileModel } from '@/lib/mongoose-model'
import {
  DEFAULT_SHARE_UNLOCK_TTL,
  SHARE_MODES,
  SHARE_UNLOCK_TTLS,
  type ShareMode,
  type ShareUnlockTtl,
} from '@/lib/whiteboard/limits'

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
 * ## An optional password on the link
 *
 * ```
 *   no sharePasswordHash ──▶ the link is the whole credential, as above
 *   sharePasswordHash    ──▶ the link shows a password form first; the right password sets
 *                            an httpOnly cookie signed over { board, shareAccessVersion, iat }
 *   next request ──▶ cookie's version == board's? ── no ──▶ the form again (password changed)
 *                    iat + shareUnlockTtl > now?  ── no ──▶ the form again (time is up)
 * ```
 *
 * `shareAccessVersion` is what makes "change the password" also mean "sign everyone out":
 * it is a fresh random value on every password set, change or removal, and a cookie is only
 * good for the version it was signed with - however much of its time is left. The TTL is
 * read from the board at check time rather than baked into the cookie, so the owner
 * shortening it cuts sessions already open too. The hash is scrypt with its own salt
 * (share-password.ts) and never leaves the server. The board list tells the owner's client
 * only that a password is set; the password itself comes from an owner-only route, out of an
 * encrypted copy kept beside the hash for that alone (`sharePasswordCipher`).
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
  /** `scrypt$<salt>$<hash>` (share-password.ts). Absent: the link needs no password. */
  sharePasswordHash?: string
  /** The password again, encrypted, for the owner's eye button only (share-password.ts). */
  sharePasswordCipher?: string
  /** New on every password change; an unlock cookie is only good for its own version. */
  shareAccessVersion?: string
  shareUnlockTtl: ShareUnlockTtl
  createdAt: Date
  updatedAt: Date
}

const whiteboardBoardSchema = new Schema<WhiteboardBoardDocument>(
  {
    title: { type: String, default: '' },
    includeInAi: { type: Boolean, default: true },
    share: { type: String, enum: SHARE_MODES, default: 'off' },
    slug: { type: String },
    sharePasswordHash: { type: String },
    sharePasswordCipher: { type: String },
    shareAccessVersion: { type: String },
    shareUnlockTtl: {
      type: String,
      enum: SHARE_UNLOCK_TTLS,
      default: DEFAULT_SHARE_UNLOCK_TTL,
    },
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
