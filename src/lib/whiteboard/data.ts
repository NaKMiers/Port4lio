import 'server-only'

import mongoose, { Types, type QueryFilter } from 'mongoose'

import { connectDatabase } from '@/lib/mongodb'
import {
  dayRangeBounds,
  type ContextBoard,
  type ContextInput,
  type ContextItem,
  type ContextLink,
  type DateFilter,
  type OverviewInput,
} from '@/lib/whiteboard/context'
import {
  BACKUP_VERSION,
  type BoardFields,
  type BoardPatch,
  checkMergedItem,
  deriveInkBBox,
  isObjectIdString,
  type ShareMode,
  validateItem,
  validateLink,
  type BulkPositionUpdate,
  type ItemFields,
  type InkPoint,
  type ItemPatch,
  type LinkFields,
  type Meaning,
  type Status,
} from '@/lib/whiteboard/limits'
import type {
  BoardLine,
  ClientItem,
  ClientLink,
  ExportScope,
  RestoreBatchResult,
} from '@/lib/whiteboard/types'
import {
  PRIORITY_STATUS,
  checkVocab,
  normalizeStatus,
} from '@/lib/whiteboard/vocab'
import { getVocab } from '@/lib/whiteboard/vocab-service'
import type { ExportLoad } from '@/lib/whiteboard/visible'
import {
  WhiteboardBoardModel,
  type WhiteboardBoardDocument,
} from '@/models/WhiteboardBoard'
import {
  WhiteboardItemModel,
  type WhiteboardItemDocument,
} from '@/models/WhiteboardItem'
import {
  WhiteboardLinkModel,
  type WhiteboardLinkDocument,
} from '@/models/WhiteboardLink'

/**
 * Every whiteboard read and write that touches Mongo, and the privacy rules.
 *
 * ```
 *                       ┌────────────────────── loadAgentVisible(scope) ──────────────────────┐
 *   Export sheet ──┐    │ 0 visible boards = includeInAi:true, and every query below is        │
 *                  │    │                    filtered by them (D32)                           │
 *                  │    │ 1 visible frames = form:frame AND includeInAi:true                  │
 *   context.md ────┼──▶ │ 2 visible items  = includeInAi:true AND                             │
 *   MCP tools ─────┘    │                    (parentId:null OR parentId IN visible frames)    │
 *                       │     - a hidden frame hides its children whatever their own flag     │
 *                       │     - a parentId pointing at a MISSING frame reads hidden (rule 7)  │
 *                       │ 3 visible links  = both ends visible                                │
 *                       │ 9 $text / filters go INSIDE the same query, never after it          │
 *                       │10 ink.points projected out; counts via countDocuments / aggregate   │
 *                       └──────────────────────────────▶ context.ts (pure) ──▶ markdown       │
 *
 *   owner writes:  create (idempotent upsert) · PATCH (only changed fields) · bulk move
 *                  delete: links ─▶ un-parent children ─▶ item      (no transaction)
 *
 *   agent writes:  createAgentItem ─▶ only on a VISIBLE board, at top level or inside a
 *                  VISIBLE frame; the card gets includeInAi: true and the tag `agent`
 *                  createAgentLink ─▶ only between two items loadAgentVisible can see
 * ```
 *
 * ## Boards scope every query (D32)
 *
 * Owner reads and writes name one board, and a write that names an id from another board is
 * a 404 - the id is not proof of anything, the pair (board, id) is. Agent reads have no
 * board of their own: they see every board whose `includeInAi` is true, which is rule 1 one
 * level up and is applied in `visibleFilter` beside the frame rule, so a path that forgot to
 * ask about boards does not exist.
 *
 * ## Why one function is the only agent read path
 *
 * The export sheet, `context.md` and three MCP tools all answer "what can an agent see".
 * Five call sites each composing their own filter is five chances to forget rule 1 on one of
 * them, and the failure is invisible: a leaked private card looks exactly like a public one
 * in the output. So every agent-facing read goes through `loadAgentVisible`, and the filter
 * is built in exactly one place (`visibleFilter`). `search_context` in particular never
 * queries the collection itself - it passes its `$text` INTO this function (rule 9), so the
 * text index is used and there is still one privacy path.
 *
 * ## Why visibility is "parent IN visible frames" and not "parent NOT IN hidden frames"
 *
 * The delete sequence below is not a transaction (the repo does not use them, and the test
 * mongod is standalone), so a function dying between "un-parent the children" and "delete
 * the frame" is a real state, and so is the reverse order in a future edit. The positive
 * form fails closed on both: a child whose frame is missing, or half-deleted, is not in the
 * visible set and so is hidden. The negative form would quietly make it visible.
 *
 * ## Rule 8: exclusion is written down when it would otherwise be lost
 *
 * Hiding a frame does not touch its children's flags. But when a child LEAVES a hidden frame
 * - dragged out, bulk-moved out, or un-parented because the frame was deleted - the write
 * that moves it also sets `includeInAi: false`. A card must never become agent-readable just
 * by moving. The resulting document is returned so the client can merge the flag (R3-1).
 *
 * ## PATCH sends only what changed (R3-1)
 *
 * An absent key means "unchanged". `includeInAi` is sent only by the explicit toggle (and as
 * `false` by a move out of a hidden frame), so a later title edit cannot carry a stale `true`
 * back over a rule-8 `false`.
 */

// MARK: Types and conversion

type ItemLean = WhiteboardItemDocument
type LinkLean = WhiteboardLinkDocument

export type DataResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; error: string; id?: string; index?: number }

const failure = (
  status: number,
  error: string,
  extra: { id?: string; index?: number } = {}
) => ({ ok: false, status, error, ...extra }) as const

const oid = (value: string) => new Types.ObjectId(value)

/** D27: no agent-facing read loads ink points. */
const AGENT_PROJECTION = { 'ink.points': 0 } as const

function dayString(date: Date | null | undefined): string | null {
  return date ? date.toISOString().slice(0, 10) : null
}

export function toClientItem(doc: ItemLean): ClientItem {
  return {
    _id: String(doc._id),
    form: doc.form,
    meaning: doc.meaning ?? null,
    status: doc.status ?? null,
    title: doc.title ?? '',
    body: doc.body ?? '',
    todos: (doc.todos ?? []).map(({ id, text, done }) => ({ id, text, done })),
    shape: doc.shape ?? null,
    ink: doc.ink
      ? {
          points: (doc.ink.points ?? []) as InkPoint[],
          bbox: doc.ink.bbox,
        }
      : null,
    parentId: doc.parentId ? String(doc.parentId) : null,
    x: doc.x,
    y: doc.y,
    width: doc.width,
    height: doc.height,
    z: doc.z ?? 0,
    tags: doc.tags ?? [],
    when: dayString(doc.when),
    targetBy: dayString(doc.targetBy),
    includeInAi: doc.includeInAi,
    createdAt: new Date(doc.createdAt).toISOString(),
    updatedAt: new Date(doc.updatedAt).toISOString(),
  }
}

export function toClientLink(doc: LinkLean): ClientLink {
  return {
    _id: String(doc._id),
    from: String(doc.from),
    to: String(doc.to),
    label: doc.label ?? '',
    fromHandle: doc.fromHandle ?? null,
    toHandle: doc.toHandle ?? null,
  }
}

export function toContextItem(doc: ItemLean): ContextItem {
  return {
    id: String(doc._id),
    boardId: doc.boardId ? String(doc.boardId) : undefined,
    form: doc.form,
    meaning: doc.meaning ?? null,
    status: doc.status ?? null,
    title: doc.title ?? '',
    body: doc.body ?? '',
    todos: (doc.todos ?? []).map(({ id, text, done }) => ({ id, text, done })),
    shape: doc.shape ?? null,
    inkBBox: doc.ink?.bbox ?? null,
    parentId: doc.parentId ? String(doc.parentId) : null,
    x: doc.x,
    y: doc.y,
    width: doc.width,
    height: doc.height,
    tags: doc.tags ?? [],
    when: doc.when ?? null,
    targetBy: doc.targetBy ?? null,
    createdAt: new Date(doc.createdAt),
    updatedAt: new Date(doc.updatedAt),
  }
}

function toContextLink(doc: LinkLean): ContextLink {
  return {
    id: String(doc._id),
    from: String(doc.from),
    to: String(doc.to),
    label: doc.label ?? '',
  }
}

// MARK: Boards (D32)

export interface ClientBoard {
  _id: string
  title: string
  includeInAi: boolean
  /** Who the link lets in (see WhiteboardBoard.ts). */
  share: ShareMode
  /** The readable part of the share link, or null when the link uses the id. */
  slug: string | null
  /** Items on it, for the index page. */
  items: number
  createdAt: string
  updatedAt: string
}

function toClientBoard(doc: WhiteboardBoardDocument, items = 0): ClientBoard {
  return {
    _id: String(doc._id),
    title: doc.title ?? '',
    includeInAi: doc.includeInAi,
    share: doc.share ?? 'off',
    slug: doc.slug ?? null,
    items,
    createdAt: new Date(doc.createdAt).toISOString(),
    updatedAt: new Date(doc.updatedAt).toISOString(),
  }
}

/**
 * The board list, and the only migration this feature needs. If no board exists yet, one is
 * created and every item and link written before boards existed is adopted into it - which
 * happens once, because from then on a board exists.
 *
 * Read-then-create is not atomic, and a board has no natural key to make unique, so two
 * first loads at once (two tabs, or React's dev double-effect) can both find nothing and
 * both create. Each racer then re-reads and keeps only the OLDEST board, dropping its own -
 * `_id` is a total order every racer agrees on, where `createdAt` can tie at the
 * millisecond and leave them disagreeing about who won. The window is narrowed rather than
 * closed: a create landing after that re-read would still leave two. The remaining cost is
 * a spare empty board on a page that lists them, not a lost item - the adoption below runs
 * against the winner, so nothing is ever adopted into a board that is about to go.
 */
export async function ensureBoards(): Promise<WhiteboardBoardDocument[]> {
  await connectDatabase()
  const boards = await WhiteboardBoardModel.find().sort({ createdAt: 1 }).lean()
  if (boards.length) return boards

  const created = await WhiteboardBoardModel.create({
    title: 'Whiteboard',
    includeInAi: true,
  })
  const all = await WhiteboardBoardModel.find().sort({ _id: 1 }).lean()
  const winner = all[0] ?? created.toObject()
  if (String(winner._id) !== String(created._id))
    await WhiteboardBoardModel.deleteOne({ _id: created._id })

  // `boardId: null` matches both a missing field and an explicit null, which is what the
  // pre-board documents look like. Items first: a link with no board is unreachable anyway.
  await Promise.all([
    WhiteboardItemModel.updateMany(
      { boardId: null },
      { $set: { boardId: winner._id } },
      { timestamps: false }
    ),
    WhiteboardLinkModel.updateMany(
      { boardId: null },
      { $set: { boardId: winner._id } },
      { timestamps: false }
    ),
  ])
  return [winner]
}

export async function listBoards(): Promise<ClientBoard[]> {
  const boards = await ensureBoards()
  const counts = await WhiteboardItemModel.aggregate<{
    _id: Types.ObjectId
    n: number
  }>([
    { $match: { boardId: { $in: boards.map(board => board._id) } } },
    { $group: { _id: '$boardId', n: { $sum: 1 } } },
  ])
  const byId = new Map(counts.map(count => [String(count._id), count.n]))
  return boards.map(board =>
    toClientBoard(board, byId.get(String(board._id)) ?? 0)
  )
}

export async function createBoard(
  fields: BoardFields
): Promise<DataResult<ClientBoard>> {
  await connectDatabase()
  const doc = await WhiteboardBoardModel.create(fields)
  return { ok: true, value: toClientBoard(doc.toObject()) }
}

export async function patchBoard(
  id: string,
  patch: BoardPatch
): Promise<DataResult<ClientBoard>> {
  await connectDatabase()
  if (!isObjectIdString(id)) return failure(404, 'Board not found.')
  // A cleared slug is removed, not stored as null: the unique index only covers boards that
  // HAVE a slug (WhiteboardBoard.ts), and a field that is simply absent keeps it that way.
  const { slug, ...fields } = patch
  const update: Record<string, unknown> = { $set: { ...fields } }
  if (slug === null) update.$unset = { slug: 1 }
  else if (slug !== undefined)
    (update.$set as Record<string, unknown>).slug = slug
  let doc: WhiteboardBoardDocument | null
  try {
    doc = await WhiteboardBoardModel.findByIdAndUpdate(id, update, {
      returnDocument: 'after',
      lean: true,
    })
  } catch (error) {
    if (isDuplicateKey(error))
      return failure(409, 'Another board already uses that link name.')
    throw error
  }
  if (!doc) return failure(404, 'Board not found.')
  // The count comes back with the board because the client replaces its whole list entry
  // with this answer. Leaving it at the default 0 made a rename say "0 items", and the
  // delete confirm - which reads that count and is the only guard in front of a permanent,
  // undo-proof board delete - say "It is empty." about a board that was not.
  const items = await WhiteboardItemModel.countDocuments({ boardId: doc._id })
  return { ok: true, value: toClientBoard(doc, items) }
}

/** A board as the share link sees it: enough to render it, nothing about the others. */
export interface SharedBoard {
  id: string
  title: string
  share: Exclude<ShareMode, 'off'>
  /** The link's own path, slug first: what "Copy link" hands out. */
  path: string
}

/**
 * The board behind `/whiteboard/<key>`, where the key is a slug or a board id - or null,
 * for a key that names nothing AND for a board that is not shared. The two are one answer
 * on purpose: a share link that has been turned off must not confirm the board still
 * exists, let alone its title.
 *
 * ```
 *   key ──▶ 24 hex? ── yes ──▶ findById
 *                    └─ no ──▶ findOne({ slug: key.toLowerCase() })
 *        ──▶ missing, or share 'off' ──▶ null (404)
 * ```
 *
 * A slug can never be 24 hex (`validateSlug`), so the branch cannot pick the wrong board.
 */
export async function resolveSharedBoard(
  key: string
): Promise<SharedBoard | null> {
  if (!key || key.length > 64) return null
  await connectDatabase()
  // A plain test, not `isObjectIdString`: that guard narrows the other branch to `never`.
  const doc = /^[0-9a-f]{24}$/i.test(key)
    ? await WhiteboardBoardModel.findById(key).lean()
    : await WhiteboardBoardModel.findOne({ slug: key.toLowerCase() }).lean()
  if (!doc || !doc.share || doc.share === 'off') return null
  const id = String(doc._id)
  return {
    id,
    title: doc.title ?? '',
    share: doc.share,
    path: `/whiteboard/${doc.slug ?? id}`,
  }
}

/**
 * Hard delete, board included: its links, then its items, then the board. Same order and
 * the same lack of a transaction as a single item delete, and safe for the same reason - a
 * run that dies part way leaves dangling links and orphaned children, both of which every
 * read already treats as invisible.
 *
 * The last board is never deleted. An owner who empties their only board still has a canvas
 * to draw on, and `ensureBoards` would silently make a new one anyway, which reads as the
 * delete having failed.
 */
export async function deleteBoard(
  id: string
): Promise<DataResult<{ items: number; links: number }>> {
  await connectDatabase()
  if (!isObjectIdString(id)) return failure(404, 'Board not found.')
  const board = await WhiteboardBoardModel.findById(id).lean()
  if (!board) return failure(404, 'Board not found.')
  if ((await WhiteboardBoardModel.countDocuments({})) <= 1)
    return failure(400, 'This is your only board.')

  const { deletedCount: links } = await WhiteboardLinkModel.deleteMany({
    boardId: board._id,
  })
  const { deletedCount: items } = await WhiteboardItemModel.deleteMany({
    boardId: board._id,
  })
  await WhiteboardBoardModel.deleteOne({ _id: board._id })
  return { ok: true, value: { items, links } }
}

/** Board ids an agent may read: rule 1, one level up. */
async function visibleBoardIds(): Promise<Types.ObjectId[]> {
  const boards = await WhiteboardBoardModel.find(
    { includeInAi: true },
    { _id: 1 }
  ).lean()
  return boards.map(board => board._id)
}

async function boardExists(id: string): Promise<boolean> {
  return (
    isObjectIdString(id) &&
    Boolean(await WhiteboardBoardModel.exists({ _id: oid(id) }))
  )
}

// MARK: The privacy filter (rules 0, 1, 2, 7)

/**
 * What an agent read is allowed to touch: the visible boards, and the visible frames inside
 * them. Carried as one value so no call site can pass the frames and forget the boards.
 */
interface VisibleScope {
  boardIds: Types.ObjectId[]
  frameIds: Types.ObjectId[]
}

/** The visible boards as the export renderer names them (D32). */
async function visibleBoardSections(
  boardIds: Types.ObjectId[]
): Promise<ContextBoard[]> {
  if (boardIds.length < 2) return []
  const boards = await WhiteboardBoardModel.find(
    { _id: { $in: boardIds } },
    { title: 1 }
  )
    .sort({ createdAt: 1 })
    .lean()
  return boards.map(board => ({
    id: String(board._id),
    title: board.title ?? '',
  }))
}

async function visibleScope(boardIds: Types.ObjectId[]): Promise<VisibleScope> {
  const frames = await WhiteboardItemModel.find(
    { boardId: { $in: boardIds }, form: 'frame', includeInAi: true },
    { _id: 1 }
  ).lean()
  return { boardIds, frameIds: frames.map(frame => frame._id) }
}

function visibleFilter(scope: VisibleScope): QueryFilter<ItemLean> {
  return {
    boardId: { $in: scope.boardIds },
    includeInAi: true,
    $or: [{ parentId: null }, { parentId: { $in: scope.frameIds } }],
  }
}

/** `visible AND extra`, with `$and` so neither side's `$or` can overwrite the other's. */
function visibleAnd(
  scope: VisibleScope,
  ...extra: QueryFilter<ItemLean>[]
): QueryFilter<ItemLean> {
  return { $and: [visibleFilter(scope), ...extra] }
}

/** The shared date rule (D22) as query clauses. */
function dateClauses(filter: DateFilter): QueryFilter<ItemLean>[] {
  const clauses: QueryFilter<ItemLean>[] = []
  if (filter.from || filter.to) {
    const b = dayRangeBounds({ from: filter.from, to: filter.to })
    const whenRange: Record<string, Date> = {}
    const createdRange: Record<string, Date> = {}
    if (b.dayFrom) whenRange.$gte = b.dayFrom
    if (b.dayToExclusive) whenRange.$lt = b.dayToExclusive
    if (b.instantFrom) createdRange.$gte = b.instantFrom
    if (b.instantToExclusive) createdRange.$lt = b.instantToExclusive
    clauses.push({
      $or: [{ when: whenRange }, { when: null, createdAt: createdRange }],
    })
  }
  if (filter.targetFrom || filter.targetTo) {
    const b = dayRangeBounds({ from: filter.targetFrom, to: filter.targetTo })
    const range: Record<string, Date> = {}
    if (b.dayFrom) range.$gte = b.dayFrom
    if (b.dayToExclusive) range.$lt = b.dayToExclusive
    clauses.push({ targetBy: range })
  }
  return clauses
}

interface FieldFilter extends DateFilter {
  meanings?: Meaning[]
  status?: Status[]
}

function fieldClauses(filter: FieldFilter): QueryFilter<ItemLean>[] {
  const clauses = dateClauses(filter)
  if (filter.meanings?.length)
    clauses.push({ meaning: { $in: filter.meanings } })
  if (filter.status?.length) clauses.push({ status: { $in: filter.status } })
  return clauses
}

/**
 * Neighbours and links for a set of in-scope items: every link touching the set whose OTHER
 * end is visible (rule 3), and those other ends, loaded bbox-only.
 */
async function linksAndNeighbours(
  inScope: ContextItem[],
  visible: VisibleScope
): Promise<{ links: ContextLink[]; neighbours: ContextItem[] }> {
  if (inScope.length === 0) return { links: [], neighbours: [] }
  const scopeIds = new Set(inScope.map(item => item.id))
  const ids = inScope.map(item => oid(item.id))

  const touching = await WhiteboardLinkModel.find({
    boardId: { $in: visible.boardIds },
    $or: [{ from: { $in: ids } }, { to: { $in: ids } }],
  }).lean()

  const otherIds = new Set<string>()
  for (const link of touching)
    for (const end of [String(link.from), String(link.to)])
      if (!scopeIds.has(end)) otherIds.add(end)

  const neighbours = otherIds.size
    ? (
        await WhiteboardItemModel.find(
          visibleAnd(visible, { _id: { $in: [...otherIds].map(oid) } }),
          AGENT_PROJECTION
        ).lean()
      ).map(toContextItem)
    : []

  const shown = new Set([...scopeIds, ...neighbours.map(n => n.id)])
  const links = touching
    .filter(link => shown.has(String(link.from)) && shown.has(String(link.to)))
    .map(toContextLink)
  return { links, neighbours }
}

async function loadVisibleFrames(
  visible: VisibleScope
): Promise<ContextItem[]> {
  if (visible.frameIds.length === 0) return []
  return (
    await WhiteboardItemModel.find(
      { _id: { $in: visible.frameIds } },
      AGENT_PROJECTION
    ).lean()
  ).map(toContextItem)
}

// MARK: loadAgentVisible

export type SearchScope = {
  kind: 'search'
  /** At most 200 chars. May be empty when a filter is given. */
  query: string
  frameId?: string
  limit: number
} & FieldFilter

export type AgentScope =
  | ExportScope
  | SearchScope
  | { kind: 'item'; id: string }
  | { kind: 'overview' }

export type { ExportLoad }

export interface SearchLoad {
  results: ContextItem[]
  input: Omit<ContextInput, 'items'>
}

export interface ItemLoad {
  item: ContextItem | null
  input: Omit<ContextInput, 'items'>
}

/**
 * The only agent-facing read. Export scopes, search, one item, or the overview - all built
 * on `visibleFilter`, all without ink points.
 */
/**
 * `board` narrows the read to one board, the shape of the owner's Export sheet. The sheet
 * itself filters in the browser now (`visible.ts`); this option is what lets
 * `tests/api/whiteboard-export-parity.test.ts` hold the two to the same answer. An agent read
 * passes nothing and gets every board it is allowed to see (D32).
 */
export interface AgentReadOptions {
  board?: string
}

export async function loadAgentVisible(
  scope: ExportScope,
  options?: AgentReadOptions
): Promise<ExportLoad>
export async function loadAgentVisible(scope: SearchScope): Promise<SearchLoad>
export async function loadAgentVisible(scope: {
  kind: 'item'
  id: string
}): Promise<ItemLoad>
export async function loadAgentVisible(scope: {
  kind: 'overview'
}): Promise<OverviewInput>
export async function loadAgentVisible(
  scope: AgentScope,
  options: AgentReadOptions = {}
): Promise<ExportLoad | SearchLoad | ItemLoad | OverviewInput> {
  await connectDatabase()
  const allowed = await visibleBoardIds()
  // One board asked for: it is in scope only if it is one an agent could read anyway.
  const boardIds = options.board
    ? allowed.filter(id => String(id) === options.board!.toLowerCase())
    : allowed
  const visible = await visibleScope(boardIds)

  switch (scope.kind) {
    case 'search':
      return loadSearch(scope, visible)
    case 'item':
      return loadItem(scope.id, visible)
    case 'overview':
      return loadOverview(visible)
    default: {
      // The export groups and orders by the owner's list, so it rides along with the input.
      const [load, vocab] = await Promise.all([
        loadExport(scope, visible, options.board),
        getVocab(),
      ])
      return { ...load, input: { ...load.input, vocab } }
    }
  }
}

async function loadExport(
  scope: ExportScope,
  visible: VisibleScope,
  board?: string
): Promise<ExportLoad> {
  const frames = await loadVisibleFrames(visible)
  const empty: ExportLoad = {
    input: { items: [], frames, neighbours: [], links: [] },
    excludedCount: 0,
    scopeHidden: false,
  }

  // The board itself is hidden from agents (D32): the same answer as a hidden frame, with
  // the count of what it is holding back, so the export sheet can say so.
  if (board && visible.boardIds.length === 0) {
    const hidden = await WhiteboardItemModel.countDocuments(
      isObjectIdString(board) ? { boardId: oid(board) } : { _id: null }
    )
    return { ...empty, excludedCount: hidden, scopeHidden: true }
  }
  const inBoard: QueryFilter<ItemLean> = {
    boardId: { $in: visible.boardIds },
  }

  // The candidate set BEFORE visibility, so the sheet can say what the filter dropped (D25).
  let candidates: QueryFilter<ItemLean>
  switch (scope.kind) {
    case 'all':
      candidates = {}
      break
    case 'frame': {
      if (!isObjectIdString(scope.id)) return empty
      const frame = await WhiteboardItemModel.findOne(
        { ...inBoard, _id: oid(scope.id), form: 'frame' },
        { includeInAi: 1 }
      ).lean()
      if (!frame) return empty
      if (!frame.includeInAi) {
        const hiddenCount = await WhiteboardItemModel.countDocuments({
          ...inBoard,
          $or: [{ _id: frame._id }, { parentId: frame._id }],
        })
        return { ...empty, excludedCount: hiddenCount, scopeHidden: true }
      }
      candidates = { $or: [{ _id: frame._id }, { parentId: frame._id }] }
      break
    }
    case 'selection': {
      const ids = scope.ids.filter(isObjectIdString).map(oid)
      if (ids.length === 0) return empty
      candidates = { _id: { $in: ids } }
      break
    }
    case 'filter':
      candidates = fieldClauses(scope).length
        ? { $and: fieldClauses(scope) }
        : {}
      break
  }

  const [boards, [docs, candidateCount]] = await Promise.all([
    visibleBoardSections(visible.boardIds),
    Promise.all([
      WhiteboardItemModel.find(
        visibleAnd(visible, candidates),
        AGENT_PROJECTION
      ).lean(),
      // "What the filter dropped" is counted inside the same boards, never across all.
      WhiteboardItemModel.countDocuments({ $and: [inBoard, candidates] }),
    ]),
  ])
  const items = docs.map(toContextItem)
  const { links, neighbours } = await linksAndNeighbours(items, visible)

  return {
    input: { items, boards, frames, neighbours, links },
    excludedCount: Math.max(0, candidateCount - items.length),
    scopeHidden: false,
  }
}

async function loadSearch(
  scope: SearchScope,
  visible: VisibleScope
): Promise<SearchLoad> {
  const frames = await loadVisibleFrames(visible)
  const clauses = fieldClauses(scope)

  const { frameId } = scope
  if (frameId !== undefined) {
    // R3-14: a malformed, unknown or hidden frame all give the same empty result.
    const frame =
      isObjectIdString(frameId) &&
      frames.find(f => f.id === frameId.toLowerCase())
    if (!frame)
      return { results: [], input: { frames, neighbours: [], links: [] } }
    clauses.push({ $or: [{ _id: oid(frame.id) }, { parentId: oid(frame.id) }] })
  }

  const query = scope.query.trim()
  const filter: QueryFilter<ItemLean> = query
    ? { $text: { $search: query }, ...visibleAnd(visible, ...clauses) }
    : visibleAnd(visible, ...clauses)

  const docs = query
    ? await WhiteboardItemModel.find(filter, {
        ...AGENT_PROJECTION,
        score: { $meta: 'textScore' },
      })
        .sort({ score: { $meta: 'textScore' }, updatedAt: -1 })
        .limit(scope.limit)
        .lean()
    : await WhiteboardItemModel.find(filter, AGENT_PROJECTION)
        .sort({ updatedAt: -1 })
        .limit(scope.limit)
        .lean()

  const results = docs.map(toContextItem)
  const { links, neighbours } = await linksAndNeighbours(results, visible)

  // D27: ink labels for search are computed over every visible item, bbox-only. Only
  // loaded when a result is actually a sketch.
  const inkPeers = results.some(r => r.form === 'ink')
    ? (
        await WhiteboardItemModel.find(visibleFilter(visible), {
          ...AGENT_PROJECTION,
          body: 0,
          todos: 0,
        }).lean()
      ).map(doc => toContextItem({ ...doc, body: '', todos: [] }))
    : []

  return { results, input: { frames, neighbours, links, inkPeers } }
}

async function loadItem(id: string, visible: VisibleScope): Promise<ItemLoad> {
  const frames = await loadVisibleFrames(visible)
  const none: ItemLoad = {
    item: null,
    input: { frames, neighbours: [], links: [] },
  }
  // R3-14 + rule 6: malformed, unknown and hidden ids are the same not-found.
  if (!isObjectIdString(id)) return none

  const doc = await WhiteboardItemModel.findOne(
    visibleAnd(visible, { _id: oid(id) }),
    AGENT_PROJECTION
  ).lean()
  if (!doc) return none

  const item = toContextItem(doc)
  const { links, neighbours } = await linksAndNeighbours([item], visible)
  const inkPeers =
    item.form === 'ink'
      ? (
          await WhiteboardItemModel.find(visibleFilter(visible), {
            ...AGENT_PROJECTION,
            body: 0,
            todos: 0,
          }).lean()
        ).map(d => toContextItem({ ...d, body: '', todos: [] }))
      : undefined
  return { item, input: { frames, neighbours, links, inkPeers } }
}

async function loadOverview(visible: VisibleScope): Promise<OverviewInput> {
  const [frames, vocab] = await Promise.all([
    loadVisibleFrames(visible),
    getVocab(),
  ])
  const statusMeanings = vocab.meanings
    .filter(meaning => meaning.tracksStatus)
    .map(meaning => meaning.key)
  const members = visibleAnd(visible, { form: { $ne: 'frame' } })

  const [childCounts, meaningGroups, totalVisible, active, recent] =
    await Promise.all([
      WhiteboardItemModel.aggregate<{ _id: Types.ObjectId; n: number }>([
        {
          $match: visibleAnd(visible, { parentId: { $in: visible.frameIds } }),
        },
        { $group: { _id: '$parentId', n: { $sum: 1 } } },
      ]),
      WhiteboardItemModel.aggregate<{ _id: Meaning | null; n: number }>([
        { $match: members },
        { $group: { _id: '$meaning', n: { $sum: 1 } } },
      ]),
      WhiteboardItemModel.countDocuments(members),
      WhiteboardItemModel.find(
        visibleAnd(visible, {
          meaning: { $in: statusMeanings },
          status: PRIORITY_STATUS,
        }),
        { ...AGENT_PROJECTION, body: 0 }
      )
        .sort({ createdAt: -1 })
        .limit(20)
        .lean(),
      WhiteboardItemModel.find(members, { ...AGENT_PROJECTION, body: 0 })
        .sort({ updatedAt: -1 })
        .limit(10)
        .lean(),
    ])

  const counts = new Map(childCounts.map(c => [String(c._id), c.n]))
  const meaningCounts: OverviewInput['meaningCounts'] = Object.fromEntries(
    [...vocab.meanings.map(m => m.key), 'none'].map(m => [m, 0])
  )
  for (const group of meaningGroups) {
    const key = group._id ?? 'none'
    meaningCounts[key] = (meaningCounts[key] ?? 0) + group.n
  }

  return {
    frames: [...frames]
      .sort((a, b) => a.y - b.y || a.x - b.x)
      .map(item => ({ item, visibleCount: counts.get(item.id) ?? 0 })),
    meaningCounts,
    vocab,
    totalVisible,
    active: active.map(doc => toContextItem({ ...doc, body: '' })),
    recent: recent.map(doc => toContextItem({ ...doc, body: '' })),
    framesById: new Map(frames.map(f => [f.id, f])),
  }
}

// MARK: Owner reads (the canvas and the backup include hidden items)

/**
 * The canvas load, in the fixed order D28 requires: frames, then other items, then links.
 * React Flow needs a parent node before its children, and a link needs both ends.
 */
export async function* streamBoard(board: string): AsyncGenerator<BoardLine> {
  await connectDatabase()
  const boardId = oid(board)
  const [itemCount, linkCount] = await Promise.all([
    WhiteboardItemModel.countDocuments({ boardId }),
    WhiteboardLinkModel.countDocuments({ boardId }),
  ])
  yield { t: 'start', items: itemCount, links: linkCount }

  let items = 0
  for await (const doc of WhiteboardItemModel.find({ boardId, form: 'frame' })
    .sort({ _id: 1 })
    .lean()
    .cursor()) {
    items++
    yield { t: 'item', item: toClientItem(doc as ItemLean) }
  }
  for await (const doc of WhiteboardItemModel.find({
    boardId,
    form: { $ne: 'frame' },
  })
    .sort({ z: 1, _id: 1 })
    .lean()
    .cursor()) {
    items++
    yield { t: 'item', item: toClientItem(doc as ItemLean) }
  }
  let links = 0
  for await (const doc of WhiteboardLinkModel.find({ boardId })
    .sort({ _id: 1 })
    .lean()
    .cursor()) {
    links++
    yield { t: 'link', link: toClientLink(doc as LinkLean) }
  }
  yield { t: 'end', items, links }
}

/**
 * The versioned backup file `{ version: 1, exportedAt, items, links }`, streamed as text so
 * it has no size ceiling (D21). One entry per line inside each array, same order as the load.
 */
export async function* streamBackup(
  board: string,
  now = new Date()
): AsyncGenerator<string> {
  yield `{"version":${BACKUP_VERSION},"exportedAt":${JSON.stringify(now.toISOString())},"items":[`
  let first = true
  let links = false
  for await (const line of streamBoard(board)) {
    if (line.t === 'link' && !links) {
      yield '\n],"links":['
      links = true
      first = true
    }
    if (line.t === 'item' || line.t === 'link') {
      const value = line.t === 'item' ? line.item : line.link
      yield `${first ? '\n' : ',\n'}${JSON.stringify(value)}`
      first = false
    }
  }
  yield links ? '\n]}\n' : '\n],"links":[]}\n'
}

// MARK: Item writes

async function findFrame(board: string, id: string) {
  return WhiteboardItemModel.findOne(
    { boardId: oid(board), _id: oid(id), form: 'frame' },
    { includeInAi: 1, x: 1, y: 1 }
  ).lean()
}

function withBBox(fields: ItemFields) {
  const { _id, ink, parentId, ...rest } = fields
  return {
    _id: oid(_id),
    ...rest,
    parentId: parentId ? oid(parentId) : null,
    ink: ink ? { points: ink.points, bbox: deriveInkBBox(ink.points) } : null,
  }
}

/**
 * Idempotent create (`$setOnInsert`). A replay of the same `_id` returns the stored document
 * unchanged - the client can retry a create whose response was lost without harm.
 */
export async function createItem(
  board: string,
  fields: ItemFields,
  /** A share link's cap (SHARED_BOARD_MAX_ITEMS); the owner passes none. */
  { maxItems }: { maxItems?: number } = {}
): Promise<DataResult<ClientItem>> {
  await connectDatabase()

  if (!(await boardExists(board))) return failure(404, 'Board not found.')
  // A replay of an id already on the board is still a 200 (R3-4): only a NEW item counts
  // against the cap, so a retried create never flips to "full" after it landed.
  if (
    maxItems !== undefined &&
    !(await WhiteboardItemModel.exists({
      _id: oid(fields._id),
      boardId: oid(board),
    })) &&
    (await WhiteboardItemModel.countDocuments({ boardId: oid(board) })) >=
      maxItems
  )
    return failure(409, 'This board is full. Ask its owner to make room.')
  if (fields.parentId && !(await findFrame(board, fields.parentId)))
    return failure(400, 'parentId must be an existing frame.')
  const vocab = await getVocab()
  const unknown = checkVocab(vocab, fields.meaning, fields.status)
  if (unknown) return failure(400, unknown)
  fields = {
    ...fields,
    status: normalizeStatus(vocab, fields.meaning, fields.status),
  }

  await WhiteboardItemModel.updateOne(
    { _id: oid(fields._id) },
    { $setOnInsert: { ...withBBox(fields), boardId: oid(board) } },
    { upsert: true }
  )
  // By id alone, then checked: an id that belongs to another board answers like any other
  // id that is not this board's, rather than being quietly rewritten onto it.
  const doc = await WhiteboardItemModel.findById(fields._id).lean()
  if (!doc) return failure(500, 'The item could not be saved.')
  if (String(doc.boardId) !== board.toLowerCase())
    return failure(409, 'That id already belongs to another board.')
  if (doc.form !== fields.form)
    return failure(409, 'That id already belongs to an item of another form.')
  return { ok: true, value: toClientItem(doc) }
}

/** Is `parentId` a frame that agents cannot see (hidden, or missing - rule 7)? */
async function isHiddenParent(
  boardId: Types.ObjectId,
  parentId: Types.ObjectId | null
) {
  if (!parentId) return false
  const frame = await WhiteboardItemModel.findOne(
    { boardId, _id: parentId, form: 'frame' },
    { includeInAi: 1 }
  ).lean()
  return !frame || !frame.includeInAi
}

export interface PatchOptions {
  /** D24: un-hiding a frame, keep its children private (children written first). */
  keepChildrenPrivate?: boolean
}

export async function patchItem(
  board: string,
  id: string,
  patch: ItemPatch,
  { keepChildrenPrivate = false }: PatchOptions = {}
): Promise<DataResult<ClientItem>> {
  await connectDatabase()
  if (!isObjectIdString(id)) return failure(404, 'Item not found.')

  const boardId = oid(board)
  const current = await WhiteboardItemModel.findOne({
    boardId,
    _id: oid(id),
  }).lean()
  if (!current) return failure(404, 'Item not found.')

  const currentFields = toClientItem(current)
  const merged = {
    ...currentFields,
    ...patch,
    when: 'when' in patch ? patch.when : current.when,
    targetBy: 'targetBy' in patch ? patch.targetBy : current.targetBy,
    ink:
      'ink' in patch
        ? patch.ink
        : current.ink
          ? { points: currentFields.ink?.points ?? [] }
          : null,
  } as ItemFields
  const rule = checkMergedItem(merged)
  if (rule) return failure(400, rule)

  const $set: Record<string, unknown> = { ...patch }

  // Status survives only next to a meaning that tracks one, whichever side of the pair
  // changed. Only the keys this patch names are checked, so a card whose meaning was
  // written before a list change can still be moved or retitled.
  if ('meaning' in patch || 'status' in patch) {
    const vocab = await getVocab()
    const unknown = checkVocab(
      vocab,
      'meaning' in patch ? merged.meaning : null,
      'status' in patch ? merged.status : null
    )
    if (unknown) return failure(400, unknown)
    $set.status = normalizeStatus(vocab, merged.meaning, merged.status)
  }

  if ('ink' in patch)
    $set.ink = patch.ink
      ? { points: patch.ink.points, bbox: deriveInkBBox(patch.ink.points) }
      : null

  if ('parentId' in patch) {
    const next = patch.parentId ?? null
    if (next && !(await findFrame(board, next)))
      return failure(400, 'parentId must be an existing frame.')
    $set.parentId = next ? oid(next) : null

    const moved = String(current.parentId ?? '') !== String(next ?? '')
    // Rule 8: leaving a hidden (or missing) frame writes the exclusion down, in this write.
    if (moved && (await isHiddenParent(boardId, current.parentId)))
      $set.includeInAi = false
  }

  // D24: un-hiding a frame with "Keep items private" - children first, then the frame, so
  // there is no instant in which they are readable.
  if (
    current.form === 'frame' &&
    patch.includeInAi === true &&
    !current.includeInAi &&
    keepChildrenPrivate
  )
    await WhiteboardItemModel.updateMany(
      { boardId, parentId: current._id },
      { $set: { includeInAi: false } }
    )

  const doc = await WhiteboardItemModel.findOneAndUpdate(
    { boardId, _id: oid(id) },
    { $set },
    { returnDocument: 'after', lean: true }
  )
  if (!doc) return failure(404, 'Item not found.')
  return { ok: true, value: toClientItem(doc) }
}

/**
 * The multi-select drag. All-or-nothing: every entry is checked against the database first,
 * and one bad entry rejects the request naming it (R3-15 lets the client re-queue the rest).
 * Rule 8 is applied per entry inside the same `bulkWrite` (R3-2).
 */
export async function bulkMoveItems(
  board: string,
  updates: BulkPositionUpdate[]
): Promise<DataResult<ClientItem[]>> {
  await connectDatabase()

  const boardId = oid(board)
  const ids = updates.map(u => oid(u.id))
  const [docs, frames] = await Promise.all([
    WhiteboardItemModel.find(
      { boardId, _id: { $in: ids } },
      { form: 1, parentId: 1 }
    ).lean(),
    WhiteboardItemModel.find(
      { boardId, form: 'frame' },
      { includeInAi: 1 }
    ).lean(),
  ])
  const byId = new Map(docs.map(d => [String(d._id), d]))
  const frameById = new Map(frames.map(f => [String(f._id), f]))

  for (const [index, update] of updates.entries()) {
    const doc = byId.get(update.id)
    if (!doc)
      return failure(400, `Item ${update.id} not found.`, {
        id: update.id,
        index,
      })
    if (update.parentId) {
      if (doc.form === 'frame')
        return failure(400, 'A frame cannot be inside another frame.', {
          id: update.id,
          index,
        })
      if (update.parentId === update.id || !frameById.has(update.parentId))
        return failure(400, 'parentId must be an existing frame.', {
          id: update.id,
          index,
        })
    }
  }

  const hidden = (parentId: Types.ObjectId | null) =>
    Boolean(parentId) && !frameById.get(String(parentId))?.includeInAi

  await WhiteboardItemModel.bulkWrite(
    updates.map(update => {
      const doc = byId.get(update.id)!
      const moved = String(doc.parentId ?? '') !== String(update.parentId ?? '')
      const $set: Record<string, unknown> = {
        x: update.x,
        y: update.y,
        parentId: update.parentId ? oid(update.parentId) : null,
      }
      if (moved && hidden(doc.parentId)) $set.includeInAi = false
      return {
        updateOne: {
          filter: { boardId, _id: oid(update.id) },
          update: { $set },
        },
      }
    }),
    { ordered: true }
  )

  const after = await WhiteboardItemModel.find({
    boardId,
    _id: { $in: ids },
  }).lean()
  return { ok: true, value: after.map(toClientItem) }
}

/**
 * Hard delete, in the safe order: (1) links touching the item, (2) un-parent a frame's
 * children - x/y converted to absolute, and for a HIDDEN frame `includeInAi: false` in the
 * same update (rule 8), (3) the item. Interrupted anywhere, reads stay safe: dangling links
 * are ignored and an orphaned `parentId` reads as hidden.
 */
export async function deleteItem(
  board: string,
  id: string
): Promise<DataResult<{ links: number; children: number }>> {
  await connectDatabase()
  if (!isObjectIdString(id)) return failure(404, 'Item not found.')

  const boardId = oid(board)
  const doc = await WhiteboardItemModel.findOne(
    { boardId, _id: oid(id) },
    { form: 1, x: 1, y: 1, includeInAi: 1 }
  ).lean()
  if (!doc) return failure(404, 'Item not found.')

  const { deletedCount: links } = await WhiteboardLinkModel.deleteMany({
    boardId,
    $or: [{ from: doc._id }, { to: doc._id }],
  })

  let children = 0
  if (doc.form === 'frame') {
    const result = await WhiteboardItemModel.updateMany(
      { boardId, parentId: doc._id },
      [
        {
          $set: {
            x: { $add: ['$x', doc.x] },
            y: { $add: ['$y', doc.y] },
            parentId: null,
            includeInAi: doc.includeInAi ? '$includeInAi' : false,
          },
        },
      ],
      { updatePipeline: true }
    )
    children = result.modifiedCount
  }

  await WhiteboardItemModel.deleteOne({ boardId, _id: doc._id })
  return { ok: true, value: { links, children } }
}

/** Counts for the delete confirm ("Delete 3 items and 5 links?", "its N items stay private"). */
export async function countDeleteImpact(board: string, ids: string[]) {
  await connectDatabase()
  const boardId = oid(board)
  const oids = ids.filter(isObjectIdString).map(oid)
  const [links, children] = await Promise.all([
    WhiteboardLinkModel.countDocuments({
      boardId,
      $or: [{ from: { $in: oids } }, { to: { $in: oids } }],
    }),
    WhiteboardItemModel.countDocuments({ boardId, parentId: { $in: oids } }),
  ])
  return { links, children }
}

// MARK: Link writes

function isDuplicateKey(error: unknown) {
  return (
    error instanceof mongoose.mongo.MongoServerError && error.code === 11000
  )
}

/**
 * Idempotent create by `_id` (R3-4). The duplicate `{from,to,label}` check only looks at
 * OTHER ids, so a replay of the same id is a 200 and not a permanent 400.
 */
export async function createLink(
  board: string,
  fields: LinkFields
): Promise<DataResult<ClientLink>> {
  await connectDatabase()

  const boardId = oid(board)
  const existing = await WhiteboardLinkModel.findById(fields._id).lean()
  if (existing)
    return String(existing.boardId) === board.toLowerCase()
      ? { ok: true, value: toClientLink(existing) }
      : failure(409, 'That id already belongs to another board.')

  // Both ends on THIS board, which is also what proves the board exists.
  const ends = await WhiteboardItemModel.countDocuments({
    boardId,
    _id: { $in: [oid(fields.from), oid(fields.to)] },
  })
  if (ends !== 2) return failure(400, 'Both ends of a link must exist.')

  const duplicate = await WhiteboardLinkModel.exists({
    _id: { $ne: oid(fields._id) },
    from: oid(fields.from),
    to: oid(fields.to),
    label: fields.label,
  })
  if (duplicate) return failure(400, 'That link already exists.')

  try {
    await WhiteboardLinkModel.updateOne(
      { _id: oid(fields._id) },
      {
        $setOnInsert: {
          boardId,
          from: oid(fields.from),
          to: oid(fields.to),
          label: fields.label,
          fromHandle: fields.fromHandle,
          toHandle: fields.toHandle,
        },
      },
      { upsert: true }
    )
  } catch (error) {
    if (isDuplicateKey(error)) return failure(400, 'That link already exists.')
    throw error
  }
  const doc = await WhiteboardLinkModel.findById(fields._id).lean()
  if (!doc) return failure(500, 'The link could not be saved.')
  return { ok: true, value: toClientLink(doc) }
}

/** D19: relabel an existing link; a duplicate on another id is a 400, a missing link a 404. */
export async function patchLink(
  board: string,
  id: string,
  { label }: { label: string }
): Promise<DataResult<ClientLink>> {
  await connectDatabase()
  if (!isObjectIdString(id)) return failure(404, 'Link not found.')

  const boardId = oid(board)
  const current = await WhiteboardLinkModel.findOne({
    boardId,
    _id: oid(id),
  }).lean()
  if (!current) return failure(404, 'Link not found.')

  const duplicate = await WhiteboardLinkModel.exists({
    _id: { $ne: current._id },
    from: current.from,
    to: current.to,
    label,
  })
  if (duplicate) return failure(400, 'That link already exists.')

  try {
    const doc = await WhiteboardLinkModel.findOneAndUpdate(
      { boardId, _id: oid(id) },
      { $set: { label } },
      { returnDocument: 'after', lean: true }
    )
    if (!doc) return failure(404, 'Link not found.')
    return { ok: true, value: toClientLink(doc) }
  } catch (error) {
    if (isDuplicateKey(error)) return failure(400, 'That link already exists.')
    throw error
  }
}

export async function deleteLink(
  board: string,
  id: string
): Promise<DataResult<null>> {
  await connectDatabase()
  if (!isObjectIdString(id)) return failure(404, 'Link not found.')
  const { deletedCount } = await WhiteboardLinkModel.deleteOne({
    boardId: oid(board),
    _id: oid(id),
  })
  if (!deletedCount) return failure(404, 'Link not found.')
  return { ok: true, value: null }
}

// MARK: Agent writes (site MCP: whiteboard_add_item, whiteboard_link)

/**
 * The boards an agent may write to are exactly the boards it may read (rule 1). Listed with
 * their titles so a refusal can tell the agent which ids it could have used.
 */
async function visibleBoards() {
  return WhiteboardBoardModel.find({ includeInAi: true }, { title: 1 })
    .sort({ createdAt: 1 })
    .lean()
}

/** Is this item visible to an agent: on a visible board, its own switch on, parent visible? */
async function agentVisibleItem(id: string) {
  if (!isObjectIdString(id)) return null
  const boardIds = await visibleBoardIds()
  const scope = await visibleScope(boardIds)
  return WhiteboardItemModel.findOne(visibleAnd(scope, { _id: oid(id) }), {
    boardId: 1,
    form: 1,
    x: 1,
    y: 1,
    width: 1,
    height: 1,
  }).lean()
}

/** Right of everything already at that level, so an agent card never lands on top of one. */
async function freePosition(
  boardId: Types.ObjectId,
  parentId: Types.ObjectId | null
) {
  const siblings = await WhiteboardItemModel.find(
    { boardId, parentId },
    { x: 1, y: 1, width: 1, height: 1 }
  ).lean()
  if (parentId)
    // Inside a frame, coordinates are the frame's own: stack below the last card.
    return {
      x: 24,
      y:
        siblings.reduce(
          (low, item) => Math.max(low, item.y + item.height),
          24
        ) + 24,
    }
  if (siblings.length === 0) return { x: 0, y: 0 }
  return {
    x: Math.max(...siblings.map(item => item.x + item.width)) + 80,
    y: Math.min(...siblings.map(item => item.y)),
  }
}

export interface AgentItemInput {
  /** A board id; optional when frameId is given or exactly one board is visible. */
  boardId?: string
  /** A visible frame to put the card in. */
  frameId?: string
  form: 'text' | 'todo'
  title: string
  body?: string
  meaning?: Meaning | null
  status?: Status | null
  todos?: { text: string; done?: boolean }[]
  tags?: string[]
  when?: string | null
  targetBy?: string | null
}

/**
 * Create a text or to-do card for an agent, only where an agent can already see (mcp.md
 * "Whiteboard writes"). The card is agent-visible itself - `includeInAi: true` - so the agent
 * can read it back and link it, and it carries the existing `agent` tag, which needs no new
 * schema field and so no change to the backup format, `visible.ts` or the parity test.
 */
export async function createAgentItem(
  input: AgentItemInput
): Promise<DataResult<ClientItem>> {
  await connectDatabase()
  const boards = await visibleBoards()
  const listBoards = () =>
    boards.length
      ? `Visible boards: ${boards.map(board => `${board.title || 'Untitled'} (${String(board._id)})`).join(', ')}.`
      : 'No board is shared with agents.'

  let boardId: Types.ObjectId | null = null
  let parentId: Types.ObjectId | null = null
  if (input.frameId) {
    const frame = await agentVisibleItem(input.frameId)
    if (!frame || frame.form !== 'frame')
      return failure(404, 'No visible frame with that id.')
    boardId = frame.boardId
    parentId = frame._id
    if (input.boardId && String(boardId) !== input.boardId.toLowerCase())
      return failure(400, 'That frame is on another board.')
  } else if (input.boardId) {
    const board = boards.find(
      entry => String(entry._id) === input.boardId!.toLowerCase()
    )
    if (!board)
      return failure(404, `No visible board with that id. ${listBoards()}`)
    boardId = board._id
  } else if (boards.length === 1) boardId = boards[0]._id
  else
    return failure(
      400,
      `Say which board: pass boardId, or frameId to put the card in a frame. ${listBoards()}`
    )

  const position = await freePosition(boardId, parentId)
  const tags = Array.from(new Set(['agent', ...(input.tags ?? [])]))
  const checked = validateItem({
    _id: new Types.ObjectId().toHexString(),
    form: input.form,
    title: input.title,
    body: input.body ?? '',
    meaning: input.meaning ?? null,
    status: input.status ?? null,
    todos: (input.todos ?? []).map((row, index) => ({
      id: `row-${index + 1}`,
      text: row.text,
      done: row.done ?? false,
    })),
    tags,
    when: input.when ?? null,
    targetBy: input.targetBy ?? null,
    parentId: parentId ? String(parentId) : null,
    includeInAi: true,
    ...position,
  })
  if (!checked.ok) return failure(checked.status ?? 400, checked.error)

  return createItem(String(boardId), checked.value)
}

/** A labelled link between two items an agent can see, on the same board. */
export async function createAgentLink(input: {
  from: string
  to: string
  label: string
}): Promise<DataResult<ClientLink>> {
  await connectDatabase()
  const [from, to] = await Promise.all([
    agentVisibleItem(input.from),
    agentVisibleItem(input.to),
  ])
  // Hidden, unknown and malformed ids are the same answer (rule 6), for either end.
  if (!from || !to) return failure(404, 'No visible item with that id.')
  if (String(from.boardId) !== String(to.boardId))
    return failure(400, 'A link joins two items on the same board.')

  const checked = validateLink({
    _id: new Types.ObjectId().toHexString(),
    from: input.from.toLowerCase(),
    to: input.to.toLowerCase(),
    label: input.label,
  })
  if (!checked.ok) return failure(checked.status ?? 400, checked.error)
  return createLink(String(from.boardId), checked.value)
}

// MARK: Restore (D20, D21)

function parseInstant(value: unknown): Date | undefined {
  if (typeof value !== 'string') return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

export interface RestoreBatch {
  dryRun: boolean
  overwrite: boolean
  items: unknown[]
  links: unknown[]
}

/**
 * One restore batch. Re-validates every entry with the normal validators, then upserts by
 * `_id` - leaving existing ids untouched unless `overwrite`. Batches are idempotent, so a run
 * that stopped at batch 3 of 5 converges when run again.
 *
 * Cross-document checks (a parent frame, both link ends) run only on the real run: the
 * client sends frames, then items, then links, so by the time a child's batch arrives its
 * frame has been written. A dry run writes nothing, so it cannot see earlier batches, and it
 * relies on the client's whole-file pre-check for those.
 *
 * The file goes into the board it was sent to (D32). A backup is per board - the one the
 * owner was looking at when they downloaded it - so restoring is "put this back here", and
 * an id in the file that already exists on ANOTHER board is refused rather than moved: a
 * restore must not quietly empty a board the owner was not thinking about.
 */
export async function restoreBatch(
  board: string,
  batch: RestoreBatch
): Promise<DataResult<RestoreBatchResult>> {
  await connectDatabase()
  if (!(await boardExists(board))) return failure(404, 'Board not found.')
  const boardId = oid(board)

  const vocab = await getVocab()
  const items: (ItemFields & { createdAt?: Date; updatedAt?: Date })[] = []
  for (const [index, entry] of batch.items.entries()) {
    const checked = validateItem(entry)
    if (!checked.ok)
      return failure(400, `items[${index}]: ${checked.error}`, { index })
    // A backup names meanings by key; one the list no longer has is refused by name, so
    // the owner can re-create it (Manage meanings) rather than lose it without a word.
    const unknown = checkVocab(
      vocab,
      checked.value.meaning,
      checked.value.status
    )
    if (unknown) return failure(400, `items[${index}]: ${unknown}`, { index })
    const raw = entry as { createdAt?: unknown; updatedAt?: unknown }
    items.push({
      ...checked.value,
      status: normalizeStatus(
        vocab,
        checked.value.meaning,
        checked.value.status
      ),
      createdAt: parseInstant(raw.createdAt),
      updatedAt: parseInstant(raw.updatedAt),
    })
  }
  const links: LinkFields[] = []
  for (const [index, entry] of batch.links.entries()) {
    const checked = validateLink(entry)
    if (!checked.ok)
      return failure(400, `links[${index}]: ${checked.error}`, { index })
    links.push(checked.value)
  }

  const [existingItems, existingLinks] = await Promise.all([
    WhiteboardItemModel.find(
      { _id: { $in: items.map(i => oid(i._id)) } },
      { form: 1, boardId: 1 }
    ).lean(),
    WhiteboardLinkModel.find(
      { _id: { $in: links.map(l => oid(l._id)) } },
      { boardId: 1 }
    ).lean(),
  ])
  const elsewhere = [...existingItems, ...existingLinks].find(
    doc => String(doc.boardId) !== board.toLowerCase()
  )
  if (elsewhere)
    return failure(
      409,
      `${String(elsewhere._id)} already exists on another board.`
    )
  const existing = existingItems.length + existingLinks.length

  if (!batch.dryRun) {
    const batchFrames = new Set(
      items.filter(i => i.form === 'frame').map(i => i._id)
    )
    const parentIds = [
      ...new Set(items.map(i => i.parentId).filter(Boolean) as string[]),
    ].filter(id => !batchFrames.has(id))
    const storedFrames = new Set(
      (
        await WhiteboardItemModel.find(
          { boardId, _id: { $in: parentIds.map(oid) }, form: 'frame' },
          { _id: 1 }
        ).lean()
      ).map(f => String(f._id))
    )
    for (const [index, item] of items.entries())
      if (
        item.parentId &&
        !batchFrames.has(item.parentId) &&
        !storedFrames.has(item.parentId)
      )
        return failure(400, `items[${index}]: parent is not a frame.`, {
          index,
        })

    const existingForm = new Map(
      existingItems.map(doc => [String(doc._id), doc.form])
    )
    for (const [index, item] of items.entries()) {
      const form = existingForm.get(item._id)
      if (form && form !== item.form)
        return failure(400, `items[${index}]: id belongs to another form.`, {
          index,
        })
    }

    if (links.length) {
      // Ends may be items of this same batch, written below before the links.
      const endIds = [...new Set(links.flatMap(l => [l.from, l.to]))]
      const ends = new Set([
        ...items.map(i => i._id),
        ...(
          await WhiteboardItemModel.find(
            { boardId, _id: { $in: endIds.map(oid) } },
            { _id: 1 }
          ).lean()
        ).map(d => String(d._id)),
      ])
      for (const [index, link] of links.entries()) {
        if (!ends.has(link.from) || !ends.has(link.to))
          return failure(400, `links[${index}]: an end does not exist.`, {
            index,
          })
        const clash = await WhiteboardLinkModel.exists({
          _id: { $ne: oid(link._id) },
          from: oid(link.from),
          to: oid(link.to),
          label: link.label,
        })
        if (clash)
          return failure(
            400,
            `links[${index}]: another link has the same ends and label.`,
            { index }
          )
      }
    }

    // The raw driver, not Model.bulkWrite: every value is already validated and typed, and
    // Mongoose strips an immutable `createdAt` from `$set` even with `overwriteImmutable`.
    // The file's `createdAt` is the one the date rule reads, so it has to survive.
    const now = new Date()
    if (items.length)
      await WhiteboardItemModel.collection.bulkWrite(
        items.map(({ createdAt, updatedAt, ...fields }) => {
          const { _id, ...rest } = withBBox(fields)
          const doc = {
            ...rest,
            boardId,
            createdAt: createdAt ?? now,
            updatedAt: updatedAt ?? now,
          }
          return {
            updateOne: {
              filter: { _id },
              update: batch.overwrite ? { $set: doc } : { $setOnInsert: doc },
              upsert: true,
            },
          }
        }),
        { ordered: true }
      )
    if (links.length)
      await WhiteboardLinkModel.collection.bulkWrite(
        links.map(link => {
          const doc = {
            boardId,
            from: oid(link.from),
            to: oid(link.to),
            label: link.label,
            fromHandle: link.fromHandle,
            toHandle: link.toHandle,
          }
          return {
            updateOne: {
              filter: { _id: oid(link._id) },
              update: batch.overwrite
                ? { $set: { ...doc, updatedAt: now } }
                : {
                    $setOnInsert: { ...doc, createdAt: now, updatedAt: now },
                  },
              upsert: true,
            },
          }
        }),
        { ordered: true }
      )
  }

  return {
    ok: true,
    value: {
      items: items.length,
      links: links.length,
      existing,
      written: batch.dryRun
        ? 0
        : batch.overwrite
          ? items.length + links.length
          : items.length + links.length - existing,
    },
  }
}
