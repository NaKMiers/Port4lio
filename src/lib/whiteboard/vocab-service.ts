import 'server-only'

import { connectDatabase } from '@/lib/mongodb'
import {
  DEFAULT_VOCAB,
  applyVocabEdit,
  findMeaning,
  type Vocab,
  type VocabEdit,
  type VocabKind,
} from '@/lib/whiteboard/vocab'
import { WhiteboardItemModel } from '@/models/WhiteboardItem'
import { VOCAB_DOC_ID, WhiteboardVocabModel } from '@/models/WhiteboardVocab'

/**
 * Read and change the whiteboard vocabulary. The one write path for it: the owner routes
 * (`/api/admin/whiteboard/vocab/**`) are a gate and a response around these.
 *
 * ```
 *   getVocab    one document; the first read seeds DEFAULT_VOCAB ($setOnInsert, race-safe)
 *   editVocab   read ──▶ applyVocabEdit (pure) ──▶ usage guards (below)
 *                    ──▶ updateOne({ _id, updatedAt: read }) ── lost the race? read again, x3
 *
 *   guards that need the items (every board):
 *     delete a meaning / status a card still carries   ──▶ 409 + the count
 *     tracksStatus off while cards of it carry a status ──▶ 409 + the count
 * ```
 *
 * ## Why a conditional write and not `$push` / `$pull`
 *
 * A reorder, a rename and an add from two tabs are three edits to one small array. Array
 * operators would each be atomic on their own, but "move goal to position 0" is a rewrite of
 * the order that no operator expresses, and a rewrite on a stale read would drop whatever the
 * other tab just added. Writing only if `updatedAt` is still what was read, and re-applying
 * the edit on a fresh read when it is not, makes every edit land on top of the others.
 *
 * ## The in-use check is a read, then a write
 *
 * An item created with "draft" between the count and the delete would keep a key the list no
 * longer has. Item writes check the list (`checkVocab` in data.ts), so that needs a create
 * racing the delete to the millisecond, and its only effect is one card showing its raw key
 * until it is reassigned. Not worth a transaction on a single-owner board.
 */

const EDIT_ATTEMPTS = 3

type Failure = { ok: false; status: number; error: string }
export type VocabResult = { ok: true; vocab: Vocab } | Failure

export interface VocabUsage {
  /** Items (every board) carrying each meaning key. */
  meanings: Record<string, number>
  /** Items (every board) carrying each status key. */
  statuses: Record<string, number>
}

function toVocab(doc: {
  meanings: Vocab['meanings']
  statuses: Vocab['statuses']
}): Vocab {
  return {
    meanings: doc.meanings.map(({ key, label, tone, icon, tracksStatus }) => ({
      key,
      label,
      tone,
      icon: icon ?? null,
      tracksStatus: Boolean(tracksStatus),
    })),
    statuses: doc.statuses.map(({ key, label }) => ({ key, label })),
  }
}

/**
 * Read, seeding on the first call. `timestamps: false` with the dates set by hand on insert:
 * Mongoose would otherwise add `$set: { updatedAt }` to this upsert, so every READ would move
 * `updatedAt` and every conditional write racing any item write would miss.
 */
async function readDoc() {
  await connectDatabase()
  const now = new Date()
  return WhiteboardVocabModel.findOneAndUpdate(
    { _id: VOCAB_DOC_ID },
    {
      $setOnInsert: {
        meanings: DEFAULT_VOCAB.meanings,
        statuses: DEFAULT_VOCAB.statuses,
        createdAt: now,
        updatedAt: now,
      },
    },
    { upsert: true, returnDocument: 'after', lean: true, timestamps: false }
  )
}

export async function getVocab(): Promise<Vocab> {
  const doc = await readDoc()
  return doc ? toVocab(doc) : DEFAULT_VOCAB
}

/**
 * Read WITHOUT seeding, for anonymous callers (a share link's vocab route). `getVocab`
 * upserts the singleton on its first call, which is harmless for the owner but would let a
 * visitor who never signed in cause a database write. An unseeded list reads as the default,
 * which is exactly what the seed would have written.
 */
export async function peekVocab(): Promise<Vocab> {
  await connectDatabase()
  const doc = await WhiteboardVocabModel.findById(VOCAB_DOC_ID).lean()
  return doc ? toVocab(doc) : DEFAULT_VOCAB
}

export async function getVocabUsage(): Promise<VocabUsage> {
  await connectDatabase()
  const [meanings, statuses] = await Promise.all([
    WhiteboardItemModel.aggregate<{ _id: string; n: number }>([
      { $match: { meaning: { $ne: null } } },
      { $group: { _id: '$meaning', n: { $sum: 1 } } },
    ]),
    WhiteboardItemModel.aggregate<{ _id: string; n: number }>([
      { $match: { status: { $ne: null } } },
      { $group: { _id: '$status', n: { $sum: 1 } } },
    ]),
  ])
  return {
    meanings: Object.fromEntries(meanings.map(row => [row._id, row.n])),
    statuses: Object.fromEntries(statuses.map(row => [row._id, row.n])),
  }
}

const cards = (n: number) => `${n} card${n === 1 ? '' : 's'}`

async function usageGuard(
  before: Vocab,
  edit: VocabEdit
): Promise<Failure | null> {
  if (edit.type === 'delete') {
    const field = edit.kind === 'meaning' ? 'meaning' : 'status'
    const n = await WhiteboardItemModel.countDocuments({ [field]: edit.key })
    if (n)
      return {
        ok: false,
        status: 409,
        error: `${cards(n)} still ${n === 1 ? 'uses' : 'use'} "${edit.key}". Give ${n === 1 ? 'it' : 'them'} another ${field} first, then delete it.`,
      }
  }
  if (
    edit.type === 'update' &&
    edit.kind === 'meaning' &&
    edit.changes.tracksStatus === false &&
    findMeaning(before, edit.key)?.tracksStatus
  ) {
    const n = await WhiteboardItemModel.countDocuments({
      meaning: edit.key,
      status: { $ne: null },
    })
    if (n)
      return {
        ok: false,
        status: 409,
        error: `${cards(n)} of this meaning still ${n === 1 ? 'has' : 'have'} a status. Clear ${n === 1 ? 'it' : 'them'} first, then turn status off.`,
      }
  }
  return null
}

export async function editVocab(edit: VocabEdit): Promise<VocabResult> {
  for (let attempt = 0; attempt < EDIT_ATTEMPTS; attempt++) {
    const doc = await readDoc()
    if (!doc)
      return { ok: false, status: 500, error: 'The list could not be read.' }
    const before = toVocab(doc)
    const applied = applyVocabEdit(before, edit)
    if (!applied.ok) return applied
    const refused = await usageGuard(before, edit)
    if (refused) return refused

    const { matchedCount } = await WhiteboardVocabModel.updateOne(
      { _id: VOCAB_DOC_ID, updatedAt: doc.updatedAt },
      {
        $set: {
          meanings: applied.vocab.meanings,
          statuses: applied.vocab.statuses,
        },
      }
    )
    if (matchedCount) return { ok: true, vocab: applied.vocab }
  }
  return {
    ok: false,
    status: 409,
    error: 'The list changed while saving. Reload it and try again.',
  }
}

export const isVocabKind = (value: string): value is VocabKind =>
  value === 'meaning' || value === 'status'
