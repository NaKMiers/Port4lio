import 'server-only'

import mongoose, { Types, type QueryFilter } from 'mongoose'

import { connectDatabase } from '@/lib/mongodb'
import {
  dayRangeBounds,
  type ContextInput,
  type ContextItem,
  type ContextLink,
  type DateFilter,
  type OverviewInput,
} from '@/lib/whiteboard/context'
import {
  BACKUP_VERSION,
  MEANINGS,
  checkMergedItem,
  deriveInkBBox,
  isObjectIdString,
  normalizeStatus,
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
 *   Export sheet ──┐    │ 1 visible frames = form:frame AND includeInAi:true                  │
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
 * ```
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
 * An absent key means "unchanged". `includeInAi` is sent only by the explicit toggle, so a
 * later title edit cannot carry a stale `true` back over a rule-8 `false`.
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

// MARK: The privacy filter (rules 1, 2, 7)

async function visibleFrameIds(): Promise<Types.ObjectId[]> {
  const frames = await WhiteboardItemModel.find(
    { form: 'frame', includeInAi: true },
    { _id: 1 }
  ).lean()
  return frames.map(frame => frame._id)
}

function visibleFilter(frameIds: Types.ObjectId[]): QueryFilter<ItemLean> {
  return {
    includeInAi: true,
    $or: [{ parentId: null }, { parentId: { $in: frameIds } }],
  }
}

/** `visible AND extra`, with `$and` so neither side's `$or` can overwrite the other's. */
function visibleAnd(
  frameIds: Types.ObjectId[],
  ...extra: QueryFilter<ItemLean>[]
): QueryFilter<ItemLean> {
  return { $and: [visibleFilter(frameIds), ...extra] }
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
  frameIds: Types.ObjectId[]
): Promise<{ links: ContextLink[]; neighbours: ContextItem[] }> {
  if (inScope.length === 0) return { links: [], neighbours: [] }
  const scopeIds = new Set(inScope.map(item => item.id))
  const ids = inScope.map(item => oid(item.id))

  const touching = await WhiteboardLinkModel.find({
    $or: [{ from: { $in: ids } }, { to: { $in: ids } }],
  }).lean()

  const otherIds = new Set<string>()
  for (const link of touching)
    for (const end of [String(link.from), String(link.to)])
      if (!scopeIds.has(end)) otherIds.add(end)

  const neighbours = otherIds.size
    ? (
        await WhiteboardItemModel.find(
          visibleAnd(frameIds, { _id: { $in: [...otherIds].map(oid) } }),
          AGENT_PROJECTION
        ).lean()
      ).map(toContextItem)
    : []

  const visible = new Set([...scopeIds, ...neighbours.map(n => n.id)])
  const links = touching
    .filter(
      link => visible.has(String(link.from)) && visible.has(String(link.to))
    )
    .map(toContextLink)
  return { links, neighbours }
}

async function loadVisibleFrames(
  frameIds: Types.ObjectId[]
): Promise<ContextItem[]> {
  if (frameIds.length === 0) return []
  return (
    await WhiteboardItemModel.find(
      { _id: { $in: frameIds } },
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

export interface ExportLoad {
  input: ContextInput
  excludedCount: number
  scopeHidden: boolean
}

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
export async function loadAgentVisible(scope: ExportScope): Promise<ExportLoad>
export async function loadAgentVisible(scope: SearchScope): Promise<SearchLoad>
export async function loadAgentVisible(scope: {
  kind: 'item'
  id: string
}): Promise<ItemLoad>
export async function loadAgentVisible(scope: {
  kind: 'overview'
}): Promise<OverviewInput>
export async function loadAgentVisible(
  scope: AgentScope
): Promise<ExportLoad | SearchLoad | ItemLoad | OverviewInput> {
  await connectDatabase()
  const frameIds = await visibleFrameIds()

  switch (scope.kind) {
    case 'search':
      return loadSearch(scope, frameIds)
    case 'item':
      return loadItem(scope.id, frameIds)
    case 'overview':
      return loadOverview(frameIds)
    default:
      return loadExport(scope, frameIds)
  }
}

async function loadExport(
  scope: ExportScope,
  frameIds: Types.ObjectId[]
): Promise<ExportLoad> {
  const frames = await loadVisibleFrames(frameIds)
  const empty: ExportLoad = {
    input: { items: [], frames, neighbours: [], links: [] },
    excludedCount: 0,
    scopeHidden: false,
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
        { _id: oid(scope.id), form: 'frame' },
        { includeInAi: 1 }
      ).lean()
      if (!frame) return empty
      if (!frame.includeInAi) {
        const hiddenCount = await WhiteboardItemModel.countDocuments({
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

  const [docs, candidateCount] = await Promise.all([
    WhiteboardItemModel.find(
      visibleAnd(frameIds, candidates),
      AGENT_PROJECTION
    ).lean(),
    WhiteboardItemModel.countDocuments(candidates),
  ])
  const items = docs.map(toContextItem)
  const { links, neighbours } = await linksAndNeighbours(items, frameIds)

  return {
    input: { items, frames, neighbours, links },
    excludedCount: Math.max(0, candidateCount - items.length),
    scopeHidden: false,
  }
}

async function loadSearch(
  scope: SearchScope,
  frameIds: Types.ObjectId[]
): Promise<SearchLoad> {
  const frames = await loadVisibleFrames(frameIds)
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
    ? { $text: { $search: query }, ...visibleAnd(frameIds, ...clauses) }
    : visibleAnd(frameIds, ...clauses)

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
  const { links, neighbours } = await linksAndNeighbours(results, frameIds)

  // D27: ink labels for search are computed over every visible item, bbox-only. Only
  // loaded when a result is actually a sketch.
  const inkPeers = results.some(r => r.form === 'ink')
    ? (
        await WhiteboardItemModel.find(visibleFilter(frameIds), {
          ...AGENT_PROJECTION,
          body: 0,
          todos: 0,
        }).lean()
      ).map(doc => toContextItem({ ...doc, body: '', todos: [] }))
    : []

  return { results, input: { frames, neighbours, links, inkPeers } }
}

async function loadItem(
  id: string,
  frameIds: Types.ObjectId[]
): Promise<ItemLoad> {
  const frames = await loadVisibleFrames(frameIds)
  const none: ItemLoad = {
    item: null,
    input: { frames, neighbours: [], links: [] },
  }
  // R3-14 + rule 6: malformed, unknown and hidden ids are the same not-found.
  if (!isObjectIdString(id)) return none

  const doc = await WhiteboardItemModel.findOne(
    visibleAnd(frameIds, { _id: oid(id) }),
    AGENT_PROJECTION
  ).lean()
  if (!doc) return none

  const item = toContextItem(doc)
  const { links, neighbours } = await linksAndNeighbours([item], frameIds)
  const inkPeers =
    item.form === 'ink'
      ? (
          await WhiteboardItemModel.find(visibleFilter(frameIds), {
            ...AGENT_PROJECTION,
            body: 0,
            todos: 0,
          }).lean()
        ).map(d => toContextItem({ ...d, body: '', todos: [] }))
      : undefined
  return { item, input: { frames, neighbours, links, inkPeers } }
}

async function loadOverview(
  frameIds: Types.ObjectId[]
): Promise<OverviewInput> {
  const frames = await loadVisibleFrames(frameIds)
  const members = visibleAnd(frameIds, { form: { $ne: 'frame' } })

  const [childCounts, meaningGroups, totalVisible, active, recent] =
    await Promise.all([
      WhiteboardItemModel.aggregate<{ _id: Types.ObjectId; n: number }>([
        { $match: visibleAnd(frameIds, { parentId: { $in: frameIds } }) },
        { $group: { _id: '$parentId', n: { $sum: 1 } } },
      ]),
      WhiteboardItemModel.aggregate<{ _id: Meaning | null; n: number }>([
        { $match: members },
        { $group: { _id: '$meaning', n: { $sum: 1 } } },
      ]),
      WhiteboardItemModel.countDocuments(members),
      WhiteboardItemModel.find(
        visibleAnd(frameIds, {
          meaning: { $in: ['dream', 'goal'] },
          status: 'active',
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
  const meaningCounts = Object.fromEntries(
    [...MEANINGS, 'none'].map(m => [m, 0])
  ) as OverviewInput['meaningCounts']
  for (const group of meaningGroups)
    meaningCounts[group._id ?? 'none'] += group.n

  return {
    frames: [...frames]
      .sort((a, b) => a.y - b.y || a.x - b.x)
      .map(item => ({ item, visibleCount: counts.get(item.id) ?? 0 })),
    meaningCounts,
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
export async function* streamBoard(): AsyncGenerator<BoardLine> {
  await connectDatabase()
  const [itemCount, linkCount] = await Promise.all([
    WhiteboardItemModel.countDocuments({}),
    WhiteboardLinkModel.countDocuments({}),
  ])
  yield { t: 'start', items: itemCount, links: linkCount }

  let items = 0
  for await (const doc of WhiteboardItemModel.find({ form: 'frame' })
    .sort({ _id: 1 })
    .lean()
    .cursor()) {
    items++
    yield { t: 'item', item: toClientItem(doc as ItemLean) }
  }
  for await (const doc of WhiteboardItemModel.find({ form: { $ne: 'frame' } })
    .sort({ z: 1, _id: 1 })
    .lean()
    .cursor()) {
    items++
    yield { t: 'item', item: toClientItem(doc as ItemLean) }
  }
  let links = 0
  for await (const doc of WhiteboardLinkModel.find({})
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
export async function* streamBackup(now = new Date()): AsyncGenerator<string> {
  yield `{"version":${BACKUP_VERSION},"exportedAt":${JSON.stringify(now.toISOString())},"items":[`
  let first = true
  let links = false
  for await (const line of streamBoard()) {
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

async function findFrame(id: string) {
  return WhiteboardItemModel.findOne(
    { _id: oid(id), form: 'frame' },
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
  fields: ItemFields
): Promise<DataResult<ClientItem>> {
  await connectDatabase()

  if (fields.parentId && !(await findFrame(fields.parentId)))
    return failure(400, 'parentId must be an existing frame.')

  await WhiteboardItemModel.updateOne(
    { _id: oid(fields._id) },
    { $setOnInsert: withBBox(fields) },
    { upsert: true }
  )
  const doc = await WhiteboardItemModel.findById(fields._id).lean()
  if (!doc) return failure(500, 'The item could not be saved.')
  if (doc.form !== fields.form)
    return failure(409, 'That id already belongs to an item of another form.')
  return { ok: true, value: toClientItem(doc) }
}

/** Is `parentId` a frame that agents cannot see (hidden, or missing - rule 7)? */
async function isHiddenParent(parentId: Types.ObjectId | null) {
  if (!parentId) return false
  const frame = await WhiteboardItemModel.findOne(
    { _id: parentId, form: 'frame' },
    { includeInAi: 1 }
  ).lean()
  return !frame || !frame.includeInAi
}

export interface PatchOptions {
  /** D24: un-hiding a frame, keep its children private (children written first). */
  keepChildrenPrivate?: boolean
}

export async function patchItem(
  id: string,
  patch: ItemPatch,
  { keepChildrenPrivate = false }: PatchOptions = {}
): Promise<DataResult<ClientItem>> {
  await connectDatabase()
  if (!isObjectIdString(id)) return failure(404, 'Item not found.')

  const current = await WhiteboardItemModel.findById(id).lean()
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

  // Status survives only next to a dream or a goal, whichever side of the pair changed.
  if ('meaning' in patch || 'status' in patch)
    $set.status = normalizeStatus(merged.meaning, merged.status)

  if ('ink' in patch)
    $set.ink = patch.ink
      ? { points: patch.ink.points, bbox: deriveInkBBox(patch.ink.points) }
      : null

  if ('parentId' in patch) {
    const next = patch.parentId ?? null
    if (next && !(await findFrame(next)))
      return failure(400, 'parentId must be an existing frame.')
    $set.parentId = next ? oid(next) : null

    const moved = String(current.parentId ?? '') !== String(next ?? '')
    // Rule 8: leaving a hidden (or missing) frame writes the exclusion down, in this write.
    if (moved && (await isHiddenParent(current.parentId)))
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
      { parentId: current._id },
      { $set: { includeInAi: false } }
    )

  const doc = await WhiteboardItemModel.findByIdAndUpdate(
    id,
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
  updates: BulkPositionUpdate[]
): Promise<DataResult<ClientItem[]>> {
  await connectDatabase()

  const ids = updates.map(u => oid(u.id))
  const [docs, frames] = await Promise.all([
    WhiteboardItemModel.find(
      { _id: { $in: ids } },
      { form: 1, parentId: 1 }
    ).lean(),
    WhiteboardItemModel.find({ form: 'frame' }, { includeInAi: 1 }).lean(),
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
        updateOne: { filter: { _id: oid(update.id) }, update: { $set } },
      }
    }),
    { ordered: true }
  )

  const after = await WhiteboardItemModel.find({ _id: { $in: ids } }).lean()
  return { ok: true, value: after.map(toClientItem) }
}

/**
 * Hard delete, in the safe order: (1) links touching the item, (2) un-parent a frame's
 * children - x/y converted to absolute, and for a HIDDEN frame `includeInAi: false` in the
 * same update (rule 8), (3) the item. Interrupted anywhere, reads stay safe: dangling links
 * are ignored and an orphaned `parentId` reads as hidden.
 */
export async function deleteItem(
  id: string
): Promise<DataResult<{ links: number; children: number }>> {
  await connectDatabase()
  if (!isObjectIdString(id)) return failure(404, 'Item not found.')

  const doc = await WhiteboardItemModel.findById(id, {
    form: 1,
    x: 1,
    y: 1,
    includeInAi: 1,
  }).lean()
  if (!doc) return failure(404, 'Item not found.')

  const { deletedCount: links } = await WhiteboardLinkModel.deleteMany({
    $or: [{ from: doc._id }, { to: doc._id }],
  })

  let children = 0
  if (doc.form === 'frame') {
    const result = await WhiteboardItemModel.updateMany(
      { parentId: doc._id },
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

  await WhiteboardItemModel.deleteOne({ _id: doc._id })
  return { ok: true, value: { links, children } }
}

/** Counts for the delete confirm ("Delete 3 items and 5 links?", "its N items stay private"). */
export async function countDeleteImpact(ids: string[]) {
  await connectDatabase()
  const oids = ids.filter(isObjectIdString).map(oid)
  const [links, children] = await Promise.all([
    WhiteboardLinkModel.countDocuments({
      $or: [{ from: { $in: oids } }, { to: { $in: oids } }],
    }),
    WhiteboardItemModel.countDocuments({ parentId: { $in: oids } }),
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
  fields: LinkFields
): Promise<DataResult<ClientLink>> {
  await connectDatabase()

  const existing = await WhiteboardLinkModel.findById(fields._id).lean()
  if (existing) return { ok: true, value: toClientLink(existing) }

  const ends = await WhiteboardItemModel.countDocuments({
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
  id: string,
  { label }: { label: string }
): Promise<DataResult<ClientLink>> {
  await connectDatabase()
  if (!isObjectIdString(id)) return failure(404, 'Link not found.')

  const current = await WhiteboardLinkModel.findById(id).lean()
  if (!current) return failure(404, 'Link not found.')

  const duplicate = await WhiteboardLinkModel.exists({
    _id: { $ne: current._id },
    from: current.from,
    to: current.to,
    label,
  })
  if (duplicate) return failure(400, 'That link already exists.')

  try {
    const doc = await WhiteboardLinkModel.findByIdAndUpdate(
      id,
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

export async function deleteLink(id: string): Promise<DataResult<null>> {
  await connectDatabase()
  if (!isObjectIdString(id)) return failure(404, 'Link not found.')
  const { deletedCount } = await WhiteboardLinkModel.deleteOne({ _id: oid(id) })
  if (!deletedCount) return failure(404, 'Link not found.')
  return { ok: true, value: null }
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
 */
export async function restoreBatch(
  batch: RestoreBatch
): Promise<DataResult<RestoreBatchResult>> {
  await connectDatabase()

  const items: (ItemFields & { createdAt?: Date; updatedAt?: Date })[] = []
  for (const [index, entry] of batch.items.entries()) {
    const checked = validateItem(entry)
    if (!checked.ok)
      return failure(400, `items[${index}]: ${checked.error}`, { index })
    const raw = entry as { createdAt?: unknown; updatedAt?: unknown }
    items.push({
      ...checked.value,
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
      { form: 1 }
    ).lean(),
    WhiteboardLinkModel.find(
      { _id: { $in: links.map(l => oid(l._id)) } },
      { _id: 1 }
    ).lean(),
  ])
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
          { _id: { $in: parentIds.map(oid) }, form: 'frame' },
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
            { _id: { $in: endIds.map(oid) } },
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
