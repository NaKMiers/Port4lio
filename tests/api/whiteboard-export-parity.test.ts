import { MongoMemoryServer } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { renderContext } from '@/lib/whiteboard/context'
import {
  createAgentItem,
  createAgentLink,
  createItem,
  createLink,
  loadAgentVisible,
  patchBoard,
  streamBoard,
} from '@/lib/whiteboard/data'
import { validateItem, validateLink } from '@/lib/whiteboard/limits'
import type {
  ClientItem,
  ClientLink,
  ExportScope,
} from '@/lib/whiteboard/types'
import { buildExportPreview, selectExportInput } from '@/lib/whiteboard/visible'
import { WhiteboardBoardModel } from '@/models/WhiteboardBoard'
import { WhiteboardItemModel } from '@/models/WhiteboardItem'
import { WhiteboardLinkModel } from '@/models/WhiteboardLink'

/**
 * The Export sheet filters in the browser (`visible.ts`); agents read through Mongo
 * (`loadAgentVisible`). This suite is the only thing that keeps those two one filter.
 *
 * ```
 *   seed one board with every edge the rules have
 *        │
 *        ├─▶ loadAgentVisible(scope, { board }) ─▶ renderContext ─┐
 *        │                                                         ├─ same markdown,
 *        └─▶ streamBoard (what the canvas loads) ─▶ buildExportPreview ┘  same counts
 * ```
 *
 * Every scope the sheet can send, plus the board switched off. A rule changed on one side
 * only fails here, by name, with the diff of the two exports.
 */

let memory: MongoMemoryServer
let BOARD = ''
const ids: Record<string, string> = {}

const newId = () => new mongoose.Types.ObjectId().toHexString()

async function make(name: string, overrides: Record<string, unknown> = {}) {
  const checked = validateItem({
    _id: newId(),
    form: 'text',
    title: name,
    ...overrides,
  })
  if (!checked.ok) throw new Error(checked.error)
  const result = await createItem(BOARD, checked.value)
  if (!result.ok) throw new Error(result.error)
  ids[name] = result.value._id
  return result.value._id
}

async function link(from: string, to: string, label: string) {
  const checked = validateLink({
    _id: newId(),
    from: ids[from],
    to: ids[to],
    label,
  })
  if (!checked.ok) throw new Error(checked.error)
  const result = await createLink(BOARD, checked.value)
  if (!result.ok) throw new Error(result.error)
}

/** Set a server-owned stamp directly, past the timestamps plugin. */
async function stamp(
  name: string,
  field: 'createdAt' | 'updatedAt',
  iso: string
) {
  await WhiteboardItemModel.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(ids[name]) },
    { $set: { [field]: new Date(iso) } }
  )
}

/** The board exactly as the canvas holds it. */
async function canvas() {
  const items: ClientItem[] = []
  const links: ClientLink[] = []
  for await (const line of streamBoard(BOARD)) {
    if (line.t === 'item') items.push(line.item)
    if (line.t === 'link') links.push(line.link)
  }
  const board = await WhiteboardBoardModel.findById(BOARD).lean()
  return { boardId: BOARD, items, links, visible: board!.includeInAi }
}

async function both(scope: ExportScope) {
  const load = await loadAgentVisible(scope, { board: BOARD })
  const rendered = renderContext(load.input)
  const server = {
    markdown: rendered.markdown,
    excludedCount: load.excludedCount,
    scopeHidden: load.scopeHidden,
    totalCount: rendered.totalCount,
    renderedCount: rendered.renderedCount,
    truncated: rendered.truncated,
  }
  const client = buildExportPreview(await canvas(), scope)
  return { server, client }
}

beforeAll(async () => {
  memory = await MongoMemoryServer.create()
  process.env.MONGODB_URI = memory.getUri()
  await mongoose.connect(memory.getUri())
  await WhiteboardItemModel.syncIndexes()
  await WhiteboardLinkModel.syncIndexes()
  BOARD = String((await WhiteboardBoardModel.create({ title: 'Parity' }))._id)

  // Frames: one visible, one hidden.
  await make('Plans', { form: 'frame', x: 0, y: 0, width: 800, height: 600 })
  await make('Secret frame', {
    form: 'frame',
    includeInAi: false,
    x: 1000,
    y: 0,
    width: 400,
    height: 400,
  })

  // Inside the visible frame: shown, hidden by its own switch, a to-do list, a sketch.
  await make('Ship it', {
    parentId: ids.Plans,
    meaning: 'goal',
    status: 'active',
    body: 'Line one\n# not a heading\nLine three',
    tags: ['work', 'q`3'],
    targetBy: '2026-06-30',
    x: 20,
    y: 40,
  })
  await make('Private note', {
    parentId: ids.Plans,
    includeInAi: false,
    meaning: 'note',
    x: 300,
    y: 40,
  })
  await make('Checklist', {
    form: 'todo',
    parentId: ids.Plans,
    meaning: 'draft',
    todos: [
      { id: 'a', text: 'First [[row]]', done: true },
      { id: 'b', text: 'Second', done: false },
    ],
    x: 20,
    y: 300,
  })
  await make('', {
    form: 'ink',
    parentId: ids.Plans,
    ink: {
      points: [
        [0, 0, 0.5],
        [40, 30, 0.5],
      ],
    },
    x: 30,
    y: 200,
  })

  // Inside the hidden frame: its own switch on, hidden anyway (rule 1).
  await make('Inside secret', { parentId: ids['Secret frame'], x: 10, y: 10 })

  // Unframed: dated either side of Ho Chi Minh midnight, a dream, an untitled shape, one off.
  await make('Late night', { meaning: 'failure', x: 0, y: 900 })
  await stamp('Late night', 'createdAt', '2025-03-14T16:30:00.000Z') // 23:30 on the 14th
  await make('Just after midnight', { meaning: 'failure', x: 200, y: 900 })
  await stamp('Just after midnight', 'createdAt', '2025-03-14T17:30:00.000Z') // 00:30 on the 15th
  await make('Dated dream', {
    meaning: 'dream',
    status: 'someday',
    when: '2025-03-15',
    x: 400,
    y: 900,
  })
  await make('', { form: 'shape', shape: 'diamond', x: 600, y: 900 })
  await make('Off card', {
    includeInAi: false,
    meaning: 'goal',
    x: 800,
    y: 900,
  })

  // A child whose frame is gone without the unparenting a real delete does: hidden, never
  // "unframed".
  await make('Doomed frame', { form: 'frame', x: 2000, y: 0 })
  await make('Orphan', { parentId: ids['Doomed frame'], x: 5, y: 5 })
  await WhiteboardItemModel.collection.deleteOne({
    _id: new mongoose.Types.ObjectId(ids['Doomed frame']),
  })

  // Links: visible both ends, into hidden cards, out of the frame, and to the orphan.
  await link('Ship it', 'Checklist', 'needs')
  await link('Ship it', 'Private note', 'because')
  await link('Late night', 'Ship it', 'led to')
  await link('Dated dream', 'Inside secret', 'hides')
  await link('Dated dream', 'Orphan', 'lost')
  await link('Just after midnight', 'Dated dream', '')

  // Recency decides order inside a meaning group: make it deterministic and interleaved.
  await stamp('Late night', 'updatedAt', '2025-04-01T00:00:00.000Z')
  await stamp('Just after midnight', 'updatedAt', '2025-04-02T00:00:00.000Z')
}, 120_000)

afterAll(async () => {
  await WhiteboardBoardModel.deleteMany({})
  await WhiteboardItemModel.deleteMany({})
  await WhiteboardLinkModel.deleteMany({})
  await mongoose.disconnect()
  await memory.stop()
})

const SCOPES: [string, () => ExportScope][] = [
  ['all', () => ({ kind: 'all' })],
  ['a visible frame', () => ({ kind: 'frame', id: ids.Plans })],
  ['a hidden frame', () => ({ kind: 'frame', id: ids['Secret frame'] })],
  ['an unknown frame', () => ({ kind: 'frame', id: newId() })],
  ['a malformed frame id', () => ({ kind: 'frame', id: 'nope' })],
  ['a card id as a frame', () => ({ kind: 'frame', id: ids['Ship it'] })],
  [
    'an upper-case frame id',
    () => ({ kind: 'frame', id: ids.Plans.toUpperCase() }),
  ],
  [
    'a mixed selection',
    () => ({
      kind: 'selection',
      ids: [
        ids['Ship it'],
        ids['Off card'],
        ids['Inside secret'],
        ids.Orphan,
        ids['Late night'].toUpperCase(),
        newId(),
        'not-an-id',
      ],
    }),
  ],
  ['an empty selection', () => ({ kind: 'selection', ids: [] })],
  ['an empty filter', () => ({ kind: 'filter' })],
  [
    'a meaning filter',
    () => ({ kind: 'filter', meanings: ['goal', 'failure'] }),
  ],
  ['a status filter', () => ({ kind: 'filter', status: ['active'] })],
  [
    'a day on the timezone boundary',
    () => ({ kind: 'filter', from: '2025-03-15', to: '2025-03-15' }),
  ],
  ['an open-ended day range', () => ({ kind: 'filter', to: '2025-03-14' })],
  [
    'a target range',
    () => ({
      kind: 'filter',
      targetFrom: '2026-01-01',
      targetTo: '2026-12-31',
    }),
  ],
  [
    'meaning and dates together',
    () => ({
      kind: 'filter',
      meanings: ['failure', 'dream'],
      from: '2025-03-15',
    }),
  ],
]

describe('the browser export matches the agent export, scope by scope', () => {
  it.each(SCOPES)('%s', async (_name, scope) => {
    const { server, client } = await both(scope())
    expect(client).toEqual(server)
  })

  it('the seed actually exercises the rules it claims to', async () => {
    const all = await both({ kind: 'all' })
    expect(all.client.markdown).toContain('Ship it')
    expect(all.client.markdown).not.toContain('Private note')
    expect(all.client.markdown).not.toContain('Inside secret')
    expect(all.client.markdown).not.toContain('Orphan')
    expect(all.client.markdown).toContain('[Sketch near:')
    // Off card, Private note, Secret frame, Inside secret, Orphan.
    expect(all.client.excludedCount).toBe(5)

    const hidden = await both({ kind: 'frame', id: ids['Secret frame'] })
    expect(hidden.client).toMatchObject({ scopeHidden: true, excludedCount: 2 })

    const boundary = await both({
      kind: 'filter',
      from: '2025-03-15',
      to: '2025-03-15',
    })
    expect(boundary.client.markdown).toContain('Just after midnight')
    expect(boundary.client.markdown).not.toContain('Late night')
  })

  it('truncates the same way under a small budget', async () => {
    const load = await loadAgentVisible({ kind: 'all' }, { board: BOARD })
    const mine = selectExportInput(await canvas(), { kind: 'all' })
    const server = renderContext(load.input, { maxBytes: 1_200 })
    const client = renderContext(mine.input, { maxBytes: 1_200 })
    expect(server.truncated).toBe(true)
    expect(client).toEqual(server)
  })
})

describe('an agent-created card is in both exports (site MCP whiteboard writes)', () => {
  // Written through the same wrappers `whiteboard_add_item` / `whiteboard_link` use. They add
  // no schema field - the mark is the existing `agent` tag - so the browser filter and the
  // Mongo filter must still agree on every scope with these cards on the board.
  beforeAll(async () => {
    const top = await createAgentItem({
      boardId: BOARD,
      form: 'text',
      title: 'Agent idea',
      meaning: 'goal',
      status: 'active',
    })
    const inFrame = await createAgentItem({
      frameId: ids.Plans,
      form: 'todo',
      title: 'Agent steps',
      todos: [{ text: 'One' }],
    })
    if (!top.ok || !inFrame.ok) throw new Error('agent create failed')
    ids['Agent idea'] = top.value._id
    ids['Agent steps'] = inFrame.value._id
    const linked = await createAgentLink({
      from: ids['Agent idea'],
      to: ids['Ship it'],
      label: 'serves',
    })
    if (!linked.ok) throw new Error(linked.error)
  })

  it.each(SCOPES)('%s', async (_name, scope) => {
    const { server, client } = await both(scope())
    expect(client).toEqual(server)
  })

  it('the agent cards are visible, tagged, and linked in the export', async () => {
    const all = await both({ kind: 'all' })
    expect(all.client.markdown).toContain('Agent idea')
    expect(all.client.markdown).toContain('Agent steps')
    expect(all.client.markdown).toContain('`agent`')
    expect(all.client.markdown).toContain('serves -> [[Ship it]]')

    const frame = await both({ kind: 'frame', id: ids.Plans })
    expect(frame.client.markdown).toContain('Agent steps')
  })
})

describe('with the board itself switched off (D32)', () => {
  beforeAll(async () => {
    const result = await patchBoard(BOARD, { includeInAi: false })
    if (!result.ok) throw new Error(result.error)
  })

  it.each(SCOPES)('%s', async (_name, scope) => {
    const { server, client } = await both(scope())
    expect(client).toEqual(server)
    expect(client).toMatchObject({ markdown: '', scopeHidden: true })
  })
})
