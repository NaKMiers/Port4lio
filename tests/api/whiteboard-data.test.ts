import { MongoMemoryServer } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import { renderContext } from '@/lib/whiteboard/context'
import {
  bulkMoveItems,
  createItem,
  createLink,
  deleteItem,
  deleteLink,
  loadAgentVisible,
  patchItem,
  patchLink,
  restoreBatch,
  streamBackup,
  streamBoard,
} from '@/lib/whiteboard/data'
import {
  validateItem,
  validateLink,
  type ItemFields,
  type LinkFields,
} from '@/lib/whiteboard/limits'
import type { BoardLine } from '@/lib/whiteboard/types'
import { WhiteboardItemModel } from '@/models/WhiteboardItem'
import { WhiteboardLinkModel } from '@/models/WhiteboardLink'

/**
 * `data.ts` against a real mongod: the privacy rules, the write rules and the delete order.
 *
 * A mock would prove nothing here. The rules are Mongo queries (`$in` over visible frames,
 * `$text` inside the same filter, an update pipeline that converts coordinates), and whether
 * they are right is a question only a server can answer.
 */

let memory: MongoMemoryServer

beforeAll(async () => {
  memory = await MongoMemoryServer.create()
  process.env.MONGODB_URI = memory.getUri()
  await mongoose.connect(memory.getUri())
  await WhiteboardItemModel.syncIndexes()
  await WhiteboardLinkModel.syncIndexes()
}, 120_000)

afterAll(async () => {
  await mongoose.disconnect()
  await memory.stop()
})

afterEach(async () => {
  mongoose.set('debug', false)
  await WhiteboardItemModel.deleteMany({})
  await WhiteboardLinkModel.deleteMany({})
})

let seq = 0
const newId = () => new mongoose.Types.ObjectId().toHexString()

function fields(overrides: Record<string, unknown> = {}): ItemFields {
  const result = validateItem({
    _id: newId(),
    form: 'text',
    title: `Card ${++seq}`,
    ...overrides,
  })
  if (!result.ok) throw new Error(result.error)
  return result.value
}

async function make(overrides: Record<string, unknown> = {}) {
  const result = await createItem(fields(overrides))
  if (!result.ok) throw new Error(result.error)
  return result.value
}

async function link(from: string, to: string, label = 'because') {
  const checked = validateLink({ _id: newId(), from, to, label })
  if (!checked.ok) throw new Error(checked.error)
  const result = await createLink(checked.value)
  if (!result.ok) throw new Error(result.error)
  return result.value
}

async function visibleIds() {
  const { input } = await loadAgentVisible({ kind: 'all' })
  return new Set(input.items.map(i => i.id))
}

describe('indexes', () => {
  it('builds the text index with default_language none', async () => {
    const indexes = await WhiteboardItemModel.collection.indexes()
    const text = indexes.find(i => i.name === 'whiteboard_text')
    expect(text?.default_language).toBe('none')
    expect(Object.keys(text?.weights ?? {}).sort()).toEqual([
      'body',
      'tags',
      'title',
      'todos.text',
    ])
  })

  it('builds the unique { from, to, label } link index', async () => {
    const indexes = await WhiteboardLinkModel.collection.indexes()
    expect(
      indexes.find(i => i.key.from === 1 && i.key.to === 1 && i.key.label === 1)
        ?.unique
    ).toBe(true)
  })
})

describe('create', () => {
  it('is an idempotent upsert: a replay leaves one unchanged document', async () => {
    const item = fields({ title: 'First' })
    await createItem(item)
    const replay = await createItem({ ...item, title: 'Changed in flight' })
    expect(replay.ok && replay.value.title).toBe('First')
    expect(await WhiteboardItemModel.countDocuments()).toBe(1)
  })

  it('rejects a parentId that is missing or not a frame', async () => {
    const card = await make()
    expect(await createItem(fields({ parentId: card._id }))).toMatchObject({
      ok: false,
      status: 400,
    })
    expect(await createItem(fields({ parentId: newId() }))).toMatchObject({
      ok: false,
      status: 400,
    })
  })

  it('derives ink.bbox from the points (D27)', async () => {
    const ink = await make({
      form: 'ink',
      title: '',
      ink: {
        points: [
          [3, 4],
          [-5, 9],
        ],
        bbox: { minX: 999, minY: 999, maxX: 999, maxY: 999 },
      },
    })
    expect(ink.ink?.bbox).toEqual({ minX: -5, minY: 4, maxX: 3, maxY: 9 })
  })
})

describe('patch sends only what changed (R3-1)', () => {
  it('leaves untouched fields alone', async () => {
    const card = await make({ includeInAi: false, tags: ['keep'] })
    const result = await patchItem(card._id, { title: 'Renamed' })
    expect(result.ok && result.value).toMatchObject({
      title: 'Renamed',
      includeInAi: false,
      tags: ['keep'],
    })
  })

  it('returns 404 for a missing or malformed id', async () => {
    expect(await patchItem(newId(), { title: 'x' })).toMatchObject({
      status: 404,
    })
    expect(await patchItem('nope', { title: 'x' })).toMatchObject({
      status: 404,
    })
  })

  it('nulls status when meaning moves off dream/goal', async () => {
    const card = await make({ meaning: 'goal', status: 'active' })
    const result = await patchItem(card._id, { meaning: 'note' })
    expect(result.ok && result.value.status).toBeNull()
  })

  it('drag out of a hidden frame, then an unrelated edit: still hidden', async () => {
    const frame = await make({ form: 'frame', includeInAi: false })
    const child = await make({ parentId: frame._id })
    expect(child.includeInAi).toBe(true)

    const moved = await patchItem(child._id, { parentId: null, x: 500, y: 500 })
    expect(moved.ok && moved.value.includeInAi).toBe(false)

    const edited = await patchItem(child._id, { title: 'Edited later' })
    expect(edited.ok && edited.value.includeInAi).toBe(false)
    expect((await visibleIds()).has(child._id)).toBe(false)
  })

  it('moving out of a visible frame keeps the flag', async () => {
    const frame = await make({ form: 'frame' })
    const child = await make({ parentId: frame._id })
    const moved = await patchItem(child._id, { parentId: null })
    expect(moved.ok && moved.value.includeInAi).toBe(true)
  })

  it('a card created inside a hidden frame is hidden from its first save', async () => {
    const frame = await make({ form: 'frame', includeInAi: false })
    const child = await make({ parentId: frame._id })
    expect((await visibleIds()).has(child._id)).toBe(false)
  })

  it('turning includeInAi on for a hidden frame child leaves it hidden (rule 1)', async () => {
    const frame = await make({ form: 'frame', includeInAi: false })
    const child = await make({ parentId: frame._id, includeInAi: false })
    await patchItem(child._id, { includeInAi: true })
    expect((await visibleIds()).has(child._id)).toBe(false)
  })
})

describe('bulk move (R3-2, all-or-nothing)', () => {
  it('applies rule 8 to every entry leaving a hidden frame', async () => {
    const frame = await make({ form: 'frame', includeInAi: false })
    const a = await make({ parentId: frame._id })
    const b = await make({ parentId: frame._id })
    const free = await make()

    const result = await bulkMoveItems([
      { id: a._id, x: 10, y: 10, parentId: null },
      { id: b._id, x: 20, y: 20, parentId: null },
      { id: free._id, x: 30, y: 30, parentId: null },
    ])
    expect(result.ok).toBe(true)
    const byId = new Map(
      (result.ok ? result.value : []).map(item => [item._id, item])
    )
    expect(byId.get(a._id)?.includeInAi).toBe(false)
    expect(byId.get(b._id)?.includeInAi).toBe(false)
    expect(byId.get(free._id)?.includeInAi).toBe(true)
    expect(await visibleIds()).toEqual(new Set([free._id]))
  })

  it('rejects the whole request naming the bad entry, and writes nothing', async () => {
    const a = await make({ x: 1, y: 1 })
    const b = await make({ x: 2, y: 2 })
    const result = await bulkMoveItems([
      { id: a._id, x: 100, y: 100, parentId: null },
      { id: b._id, x: 200, y: 200, parentId: a._id }, // a is not a frame
    ])
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      id: b._id,
      index: 1,
    })
    const stored = await WhiteboardItemModel.findById(a._id).lean()
    expect(stored?.x).toBe(1)
  })
})

describe('delete', () => {
  it('deletes the links, un-parents children to absolute coords, then the item', async () => {
    const frame = await make({ form: 'frame', x: 100, y: 200 })
    const child = await make({ parentId: frame._id, x: 10, y: 20 })
    const other = await make()
    await link(frame._id, other._id)
    await link(child._id, other._id)

    const result = await deleteItem(frame._id)
    expect(result).toEqual({ ok: true, value: { links: 1, children: 1 } })

    const stored = await WhiteboardItemModel.findById(child._id).lean()
    expect(stored).toMatchObject({ x: 110, y: 220, parentId: null })
    expect(stored?.includeInAi).toBe(true)
    expect(await WhiteboardLinkModel.countDocuments()).toBe(1)
  })

  it('deleting a hidden frame leaves its children hidden', async () => {
    const frame = await make({ form: 'frame', includeInAi: false })
    const child = await make({ parentId: frame._id })
    await deleteItem(frame._id)
    const stored = await WhiteboardItemModel.findById(child._id).lean()
    expect(stored?.includeInAi).toBe(false)
    expect((await visibleIds()).has(child._id)).toBe(false)
  })

  it('tolerates a delete that stopped partway: orphans read hidden, dangling links vanish', async () => {
    const frame = await make({ form: 'frame' })
    const child = await make({ parentId: frame._id })
    const a = await make()
    const b = await make()
    await link(a._id, b._id)
    // Simulate a function that died after step 3 ran out of order, and a lost link cleanup.
    await WhiteboardItemModel.deleteOne({ _id: frame._id })
    await WhiteboardItemModel.deleteOne({ _id: b._id })

    const { input } = await loadAgentVisible({ kind: 'all' })
    const ids = new Set(input.items.map(i => i.id))
    expect(ids.has(child._id)).toBe(false)
    expect(input.links).toEqual([])
    expect(renderContext(input).markdown).not.toContain(b._id)
  })

  it('returns 404 for an unknown item', async () => {
    expect(await deleteItem(newId())).toMatchObject({ status: 404 })
  })
})

describe('un-hiding a frame (D24)', () => {
  it('keepChildrenPrivate writes the children hidden first', async () => {
    const frame = await make({ form: 'frame', includeInAi: false })
    const child = await make({ parentId: frame._id })
    await patchItem(
      frame._id,
      { includeInAi: true },
      { keepChildrenPrivate: true }
    )
    const ids = await visibleIds()
    expect(ids.has(frame._id)).toBe(true)
    expect(ids.has(child._id)).toBe(false)
  })

  it('without it, the children become readable', async () => {
    const frame = await make({ form: 'frame', includeInAi: false })
    const child = await make({ parentId: frame._id })
    await patchItem(frame._id, { includeInAi: true })
    expect((await visibleIds()).has(child._id)).toBe(true)
  })
})

describe('links', () => {
  it('a retried create of the same id is a 200, not a duplicate (R3-4)', async () => {
    const a = await make()
    const b = await make()
    const checked = validateLink({
      _id: newId(),
      from: a._id,
      to: b._id,
      label: 'x',
    })
    if (!checked.ok) throw new Error()
    const first = await createLink(checked.value as LinkFields)
    const replay = await createLink(checked.value as LinkFields)
    expect(first.ok && replay.ok).toBe(true)
    expect(await WhiteboardLinkModel.countDocuments()).toBe(1)
  })

  it('rejects a duplicate { from, to, label } on another id', async () => {
    const a = await make()
    const b = await make()
    await link(a._id, b._id, 'blocks')
    const again = validateLink({
      _id: newId(),
      from: a._id,
      to: b._id,
      label: 'blocks',
    })
    if (!again.ok) throw new Error()
    expect(await createLink(again.value)).toMatchObject({ status: 400 })
  })

  it('rejects a link whose end does not exist', async () => {
    const a = await make()
    const checked = validateLink({
      _id: newId(),
      from: a._id,
      to: newId(),
      label: '',
    })
    if (!checked.ok) throw new Error()
    expect(await createLink(checked.value)).toMatchObject({ status: 400 })
  })

  it('relabels, rejects a duplicate label, and 404s a missing link (D19)', async () => {
    const a = await make()
    const b = await make()
    const one = await link(a._id, b._id, 'because')
    await link(a._id, b._id, 'blocks')
    expect(await patchLink(one._id, { label: 'led to' })).toMatchObject({
      ok: true,
      value: { label: 'led to' },
    })
    expect(await patchLink(one._id, { label: 'blocks' })).toMatchObject({
      status: 400,
    })
    expect(await patchLink(newId(), { label: 'x' })).toMatchObject({
      status: 404,
    })
  })

  it('deletes a link and 404s the second time', async () => {
    const a = await make()
    const b = await make()
    const one = await link(a._id, b._id)
    expect((await deleteLink(one._id)).ok).toBe(true)
    expect(await deleteLink(one._id)).toMatchObject({ status: 404 })
  })
})

describe('loadAgentVisible', () => {
  it('a hidden frame hides everything inside it, whatever the children say', async () => {
    const hidden = await make({
      form: 'frame',
      title: 'Private',
      includeInAi: false,
    })
    const inside = await make({ parentId: hidden._id, title: 'Secret' })
    const outside = await make({ title: 'Public' })
    await link(inside._id, outside._id, 'leaks?')

    const { input } = await loadAgentVisible({ kind: 'all' })
    const ids = input.items.map(i => i.id)
    expect(ids).toEqual([outside._id])
    expect(input.frames).toEqual([])
    expect(input.links).toEqual([])
    const md = renderContext(input).markdown
    expect(md).not.toContain('Secret')
    expect(md).not.toContain('Private')
  })

  it('reports excludedCount for a mixed selection and scopeHidden for a hidden frame (D25)', async () => {
    const hiddenFrame = await make({ form: 'frame', includeInAi: false })
    const child = await make({ parentId: hiddenFrame._id })
    const shown = await make()
    const off = await make({ includeInAi: false })

    const selection = await loadAgentVisible({
      kind: 'selection',
      ids: [shown._id, off._id, child._id],
    })
    expect(selection.input.items.map(i => i.id)).toEqual([shown._id])
    expect(selection.excludedCount).toBe(2)

    const frame = await loadAgentVisible({ kind: 'frame', id: hiddenFrame._id })
    expect(frame.scopeHidden).toBe(true)
    expect(frame.input.items).toEqual([])
  })

  it('names a visible neighbour outside the scope, never a hidden one', async () => {
    const frame = await make({ form: 'frame', title: 'Scope' })
    const inside = await make({ parentId: frame._id, title: 'Inside' })
    const visible = await make({ title: 'Visible neighbour' })
    const hidden = await make({ title: 'Hidden neighbour', includeInAi: false })
    await link(inside._id, visible._id, 'to visible')
    await link(inside._id, hidden._id, 'to hidden')

    const { input } = await loadAgentVisible({ kind: 'frame', id: frame._id })
    const md = renderContext(input).markdown
    expect(md).toContain('[[Visible neighbour]]')
    expect(md).toContain('(outside this export)')
    expect(md).not.toContain('Hidden neighbour')
    expect(md).not.toContain('to hidden')
  })

  it('filters by the shared date rule, boundary included (D22)', async () => {
    const late = await make({ title: 'Late NYE' })
    const early = await make({ title: 'Early new year' })
    // The raw collection: Mongoose strips an immutable createdAt from $set.
    await WhiteboardItemModel.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(late._id) },
      { $set: { createdAt: new Date('2025-12-31T16:30:00.000Z') } }
    )
    await WhiteboardItemModel.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(early._id) },
      { $set: { createdAt: new Date('2025-12-31T23:00:00.000Z') } }
    )
    const dated = await make({ title: 'Dated', when: '2025-06-01' })

    const { input } = await loadAgentVisible({
      kind: 'filter',
      from: '2025-01-01',
      to: '2025-12-31',
    })
    expect(input.items.map(i => i.title).sort()).toEqual(['Dated', 'Late NYE'])
    void dated
  })

  it('search puts $text and the visibility rules in ONE query (rule 9)', async () => {
    await make({ title: 'kayak trip', includeInAi: false })
    await make({ title: 'kayak club' })
    const spy = vi.spyOn(WhiteboardItemModel, 'find')

    const { results } = await loadAgentVisible({
      kind: 'search',
      query: 'kayak',
      limit: 10,
    })
    expect(results.map(r => r.title)).toEqual(['kayak club'])

    const textCall = spy.mock.calls.find(
      ([filter]) => filter && '$text' in (filter as object)
    )
    const filter = JSON.stringify(textCall?.[0])
    expect(filter).toContain('"includeInAi":true')
    expect(filter).toContain('"parentId"')
  })

  it('finds Vietnamese text, with or without diacritics', async () => {
    await make({ title: 'Mục tiêu năm nay', body: 'Học tiếng Nhật' })
    await make({ title: 'Unrelated' })

    for (const query of ['mục tiêu', 'muc tieu', 'tiếng Nhật']) {
      const { results } = await loadAgentVisible({
        kind: 'search',
        query,
        limit: 10,
      })
      expect(
        results.map(r => r.title),
        query
      ).toEqual(['Mục tiêu năm nay'])
    }
  })

  it('search with no query and a filter sorts by updatedAt; an unknown or malformed frameId is empty', async () => {
    await make({ meaning: 'goal', title: 'g1' })
    await make({ meaning: 'goal', title: 'g2' })
    const { results } = await loadAgentVisible({
      kind: 'search',
      query: '',
      meanings: ['goal'],
      limit: 10,
    })
    expect(results.map(r => r.title)).toEqual(['g2', 'g1'])

    for (const frameId of [newId(), 'not-an-id'])
      expect(
        (
          await loadAgentVisible({
            kind: 'search',
            query: '',
            meanings: ['goal'],
            frameId,
            limit: 10,
          })
        ).results
      ).toEqual([])
  })

  it('get_item: hidden, unknown and malformed ids look the same (rule 6, R3-14)', async () => {
    const hidden = await make({ includeInAi: false })
    const outcomes = await Promise.all(
      [hidden._id, newId(), 'zzz'].map(id =>
        loadAgentVisible({ kind: 'item', id })
      )
    )
    for (const outcome of outcomes) expect(outcome.item).toBeNull()
  })

  it('overview counts run the same filter', async () => {
    const hiddenFrame = await make({ form: 'frame', includeInAi: false })
    await make({ parentId: hiddenFrame._id, meaning: 'goal', status: 'active' })
    await make({ meaning: 'goal', status: 'active', title: 'Visible goal' })
    await make({ meaning: 'failure', includeInAi: false })
    const frame = await make({ form: 'frame', title: 'Open' })
    await make({ parentId: frame._id, meaning: 'note' })

    const overview = await loadAgentVisible({ kind: 'overview' })
    expect(overview.totalVisible).toBe(2)
    expect(overview.meaningCounts).toMatchObject({
      goal: 1,
      failure: 0,
      note: 1,
    })
    expect(overview.active.map(a => a.title)).toEqual(['Visible goal'])
    expect(overview.frames.map(f => [f.item.title, f.visibleCount])).toEqual([
      ['Open', 1],
    ])
  })

  it('no agent read loads ink points (D27)', async () => {
    const frame = await make({ form: 'frame' })
    const ink = await make({
      form: 'ink',
      title: 'scribble',
      parentId: frame._id,
      ink: {
        points: [
          [1, 2],
          [3, 4],
        ],
      },
    })
    await make({ title: 'scribble neighbour' })

    const finds: unknown[] = []
    mongoose.set(
      'debug',
      (collection: string, method: string, ...args: unknown[]) => {
        if (collection === 'whiteboard_items' && /^find/.test(method))
          finds.push(args[1])
      }
    )

    const loads = await Promise.all([
      loadAgentVisible({ kind: 'all' }),
      loadAgentVisible({ kind: 'frame', id: frame._id }),
      loadAgentVisible({ kind: 'selection', ids: [ink._id] }),
      loadAgentVisible({ kind: 'filter', meanings: ['goal'] }),
      loadAgentVisible({ kind: 'search', query: 'scribble', limit: 10 }),
      loadAgentVisible({ kind: 'item', id: ink._id }),
      loadAgentVisible({ kind: 'overview' }),
    ])
    mongoose.set('debug', false)

    expect(JSON.stringify(loads)).not.toContain('points')
    expect(finds.length).toBeGreaterThan(0)
    for (const options of finds) {
      const projection = (options as { projection?: Record<string, number> })
        ?.projection
      expect(projection, JSON.stringify(options)).toBeDefined()
      const excludes = projection?.['ink.points'] === 0
      const inclusionOnly =
        projection &&
        Object.values(projection).every(v => v === 1) &&
        !('ink' in projection) &&
        !('ink.points' in projection)
      expect(excludes || inclusionOnly, JSON.stringify(projection)).toBe(true)
    }
  })
})

describe('the canvas stream (D28)', () => {
  it('yields start, frames, then other items, then links, then end', async () => {
    const card = await make()
    const frame = await make({ form: 'frame' })
    const child = await make({ parentId: frame._id })
    await link(card._id, child._id)

    const lines: BoardLine[] = []
    for await (const line of streamBoard()) lines.push(line)

    expect(lines[0]).toEqual({ t: 'start', items: 3, links: 1 })
    expect(lines.at(-1)).toEqual({ t: 'end', items: 3, links: 1 })
    const kinds = lines
      .slice(1, -1)
      .map(l =>
        l.t === 'item' ? (l.item.form === 'frame' ? 'frame' : 'item') : l.t
      )
    expect(kinds).toEqual(['frame', 'item', 'item', 'link'])
  })

  it('the owner stream includes hidden items and ink points', async () => {
    await make({ includeInAi: false, title: 'Owner only' })
    await make({ form: 'ink', title: '', ink: { points: [[1, 1]] } })
    const lines: BoardLine[] = []
    for await (const line of streamBoard()) lines.push(line)
    const text = JSON.stringify(lines)
    expect(text).toContain('Owner only')
    expect(text).toContain('"points":[[1,1,0.5]]')
  })
})

describe('backup and restore (D20, D21)', () => {
  async function backupFile() {
    let text = ''
    for await (const chunk of streamBackup(
      new Date('2026-01-01T00:00:00.000Z')
    ))
      text += chunk
    return JSON.parse(text) as {
      version: number
      items: Record<string, unknown>[]
      links: Record<string, unknown>[]
    }
  }

  async function seedBoard() {
    const frame = await make({
      form: 'frame',
      title: 'Keep',
      includeInAi: false,
    })
    const child = await make({
      parentId: frame._id,
      meaning: 'goal',
      when: '2025-03-01',
    })
    const ink = await make({
      form: 'ink',
      title: '',
      ink: {
        points: [
          [0, 0],
          [5, 5],
        ],
      },
    })
    await link(child._id, ink._id, 'sketch of')
    return { frame, child, ink }
  }

  const snapshot = async () =>
    JSON.stringify({
      items: await WhiteboardItemModel.find({}).sort({ _id: 1 }).lean(),
      links: await WhiteboardLinkModel.find({})
        .sort({ _id: 1 })
        .select('-createdAt -updatedAt')
        .lean(),
    })

  it('is a versioned file that round-trips: backup, delete, restore = same documents', async () => {
    await seedBoard()
    const before = await snapshot()
    const file = await backupFile()
    expect(file.version).toBe(1)

    await WhiteboardItemModel.deleteMany({})
    await WhiteboardLinkModel.deleteMany({})

    const result = await restoreBatch({
      dryRun: false,
      overwrite: false,
      items: file.items,
      links: file.links,
    })
    expect(result).toMatchObject({
      ok: true,
      value: { items: 3, links: 1, existing: 0 },
    })
    expect(await snapshot()).toBe(before)
  })

  it('an invalid batch is a 400 with zero writes', async () => {
    const result = await restoreBatch({
      dryRun: false,
      overwrite: false,
      items: [
        { _id: newId(), form: 'text', title: 'ok' },
        { _id: newId(), form: 'text', title: 'bad\ntitle' },
      ],
      links: [],
    })
    expect(result).toMatchObject({ ok: false, status: 400 })
    expect(await WhiteboardItemModel.countDocuments()).toBe(0)
  })

  it('a dry run counts and writes nothing', async () => {
    const { child } = await seedBoard()
    const file = await backupFile()
    await WhiteboardItemModel.deleteOne({ _id: child._id })
    const result = await restoreBatch({
      dryRun: true,
      overwrite: false,
      items: file.items,
      links: file.links,
    })
    expect(result).toMatchObject({
      ok: true,
      value: { items: 3, links: 1, existing: 3, written: 0 },
    })
    expect(await WhiteboardItemModel.countDocuments()).toBe(2)
  })

  it('batched, then re-run after a mid-way failure, converges and is idempotent', async () => {
    await seedBoard()
    const before = await snapshot()
    const file = await backupFile()
    await WhiteboardItemModel.deleteMany({})
    await WhiteboardLinkModel.deleteMany({})

    const frames = file.items.filter(i => i.form === 'frame')
    const rest = file.items.filter(i => i.form !== 'frame')
    const batches = [
      { items: frames, links: [] },
      { items: rest, links: [] },
      { items: [], links: file.links },
    ]
    // First run stops after batch 1.
    await restoreBatch({ dryRun: false, overwrite: false, ...batches[0] })
    // Run again, from the start.
    for (const batch of batches)
      expect(
        (await restoreBatch({ dryRun: false, overwrite: false, ...batch })).ok
      ).toBe(true)
    // And once more: nothing new.
    for (const batch of batches) {
      const again = await restoreBatch({
        dryRun: false,
        overwrite: false,
        ...batch,
      })
      expect(again.ok && again.value.written).toBe(0)
    }
    expect(await snapshot()).toBe(before)
  })

  it('keeps includeInAi and createdAt from the file, and re-derives a wrong bbox', async () => {
    const id = newId()
    const result = await restoreBatch({
      dryRun: false,
      overwrite: false,
      items: [
        {
          _id: id,
          form: 'ink',
          title: '',
          includeInAi: false,
          createdAt: '2024-02-02T02:02:02.000Z',
          ink: {
            points: [
              [1, 2],
              [3, 4],
            ],
            bbox: { minX: 9, minY: 9, maxX: 9, maxY: 9 },
          },
        },
      ],
      links: [],
    })
    expect(result.ok).toBe(true)
    const stored = await WhiteboardItemModel.findById(id).lean()
    expect(stored?.includeInAi).toBe(false)
    expect(stored?.createdAt.toISOString()).toBe('2024-02-02T02:02:02.000Z')
    expect(stored?.ink?.bbox).toEqual({ minX: 1, minY: 2, maxX: 3, maxY: 4 })
  })

  it('overwrite keeps the file createdAt too', async () => {
    const card = await make({ title: 'Current' })
    await restoreBatch({
      dryRun: false,
      overwrite: true,
      items: [
        {
          _id: card._id,
          form: 'text',
          title: 'Old',
          createdAt: '2023-03-03T00:00:00.000Z',
        },
      ],
      links: [],
    })
    const stored = await WhiteboardItemModel.findById(card._id).lean()
    expect(stored?.createdAt.toISOString()).toBe('2023-03-03T00:00:00.000Z')
  })

  it('leaves existing ids untouched unless overwrite', async () => {
    const card = await make({ title: 'Current' })
    const entry = { _id: card._id, form: 'text', title: 'From file' }
    await restoreBatch({
      dryRun: false,
      overwrite: false,
      items: [entry],
      links: [],
    })
    expect((await WhiteboardItemModel.findById(card._id).lean())?.title).toBe(
      'Current'
    )
    await restoreBatch({
      dryRun: false,
      overwrite: true,
      items: [entry],
      links: [],
    })
    expect((await WhiteboardItemModel.findById(card._id).lean())?.title).toBe(
      'From file'
    )
  })
})
