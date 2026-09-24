import { MongoMemoryServer } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import { AgentActionModel } from '@/models/AgentAction'
import { AgentTokenModel } from '@/models/AgentToken'
import { RateLimitModel } from '@/models/RateLimit'
import { WhiteboardBoardModel } from '@/models/WhiteboardBoard'
import { WhiteboardItemModel } from '@/models/WhiteboardItem'
import { WhiteboardLinkModel } from '@/models/WhiteboardLink'

import { mcpClient, type RouteHandler } from './mcp-helpers'

/**
 * The whiteboard writes through `/api/mcp` (phase 4, mcp-plan.md T9; mcp.md "Whiteboard writes").
 *
 * ```
 *   whiteboard_add_item  visible board or visible frame only · includeInAi true · tag `agent`
 *                        several boards and no boardId ──▶ refused, listing the visible ones
 *   whiteboard_link      both ends visible, same board · hidden and unknown ids answer alike
 *   both                 clientRef replays instead of writing twice (R4) · audited
 *   read back            the new card is readable through loadAgentVisible (whiteboard_get_item)
 * ```
 */

vi.hoisted(() => {
  process.env.PROFILE_DOCUMENT_ID = 'mcp-whiteboard-profile'
})

const deferred: (() => unknown)[] = []
vi.mock('next/server', async importOriginal => {
  const actual = await importOriginal<typeof import('next/server')>()
  return { ...actual, after: (fn: () => unknown) => deferred.push(fn) }
})
const flushAfter = async () => {
  while (deferred.length) await deferred.shift()!()
}

let memory: MongoMemoryServer
let client: ReturnType<typeof mcpClient>
let tokenLib: typeof import('@/lib/mcp/token')
let data: typeof import('@/lib/whiteboard/data')
let limits: typeof import('@/lib/whiteboard/limits')
let BOARD = ''
let HIDDEN_BOARD = ''

beforeAll(async () => {
  memory = await MongoMemoryServer.create()
  process.env.MONGODB_URI = memory.getUri()
  process.env.AUTH_SECRET = 'mcp-whiteboard-secret'
  delete process.env.REQUIRE_ADMIN
  await mongoose.connect(memory.getUri())
  await Promise.all([
    AgentTokenModel.syncIndexes(),
    AgentActionModel.syncIndexes(),
    WhiteboardItemModel.syncIndexes(),
    WhiteboardLinkModel.syncIndexes(),
  ])
  const route = await import('@/app/api/mcp/route')
  client = mcpClient(route.POST as RouteHandler, 'http://localhost/api/mcp')
  tokenLib = await import('@/lib/mcp/token')
  data = await import('@/lib/whiteboard/data')
  limits = await import('@/lib/whiteboard/limits')
}, 120_000)

afterAll(async () => {
  await mongoose.disconnect()
  await memory.stop()
})

beforeEach(async () => {
  BOARD = String((await WhiteboardBoardModel.create({ title: 'Life' }))._id)
  HIDDEN_BOARD = String(
    (await WhiteboardBoardModel.create({ title: 'Diary', includeInAi: false }))
      ._id
  )
})

afterEach(async () => {
  deferred.length = 0
  await Promise.all([
    AgentTokenModel.deleteMany({}),
    AgentActionModel.deleteMany({}),
    RateLimitModel.deleteMany({}),
    WhiteboardBoardModel.deleteMany({}),
    WhiteboardItemModel.deleteMany({}),
    WhiteboardLinkModel.deleteMany({}),
  ])
})

const token = async (scopes: ('read' | 'write')[] = ['read', 'write']) =>
  (await tokenLib.createAgentToken('agent', scopes)).token

async function owner(board: string, fields: Record<string, unknown>) {
  const checked = limits.validateItem({
    _id: new mongoose.Types.ObjectId().toHexString(),
    form: 'text',
    ...fields,
  })
  if (!checked.ok) throw new Error(checked.error)
  const result = await data.createItem(board, checked.value)
  if (!result.ok) throw new Error(result.error)
  return result.value._id
}

const parse = (text: string) => JSON.parse(text)

describe('whiteboard_add_item', () => {
  it('adds a visible, agent-tagged goal to the one shared board, readable back', async () => {
    await owner(BOARD, { title: 'Existing', x: 0, y: 0 })
    const t = await token()
    const added = await client.callTool(t, 'whiteboard_add_item', {
      title: 'Speak at a meetup',
      meaning: 'goal',
      status: 'active',
      body: 'An idea from the chat.',
      clientRef: 'idea-1',
    })
    expect(added.isError, added.text).toBe(false)
    const { id } = parse(added.text)

    const stored = await WhiteboardItemModel.findById(id).lean()
    expect(stored).toMatchObject({
      title: 'Speak at a meetup',
      meaning: 'goal',
      status: 'active',
      includeInAi: true,
      parentId: null,
    })
    expect(String(stored?.boardId)).toBe(BOARD)
    expect(stored?.tags).toEqual(['agent'])
    // Placed beside what was already there, not on top of it.
    expect(stored!.x).toBeGreaterThan(0)

    const read = await client.callTool(t, 'whiteboard_get_item', { id })
    expect(read.text).toContain('Speak at a meetup')
    expect(read.text).toContain('`agent`')
  })

  it('a retry with the same clientRef replays, and adds nothing twice', async () => {
    const t = await token()
    const args = { title: 'Once', meaning: 'note', clientRef: 'dup' }
    const first = await client.callTool(t, 'whiteboard_add_item', args)
    const second = await client.callTool(t, 'whiteboard_add_item', args)
    expect(second).toEqual(first)
    expect(await WhiteboardItemModel.countDocuments({ title: 'Once' })).toBe(1)
  })

  it('goes inside a visible frame, and never into a hidden one', async () => {
    const frame = await owner(BOARD, {
      form: 'frame',
      title: 'Career',
      width: 800,
      height: 600,
    })
    const hidden = await owner(BOARD, {
      form: 'frame',
      title: 'Secret',
      includeInAi: false,
    })
    const t = await token()

    const inside = parse(
      (
        await client.callTool(t, 'whiteboard_add_item', {
          frameId: frame,
          title: 'In frame',
        })
      ).text
    )
    expect(inside.parentId).toBe(frame)

    const refused = await client.callTool(t, 'whiteboard_add_item', {
      frameId: hidden,
      title: 'Nope',
    })
    expect(refused).toMatchObject({
      isError: true,
      text: 'No visible frame with that id.',
    })
    expect(await WhiteboardItemModel.countDocuments({ title: 'Nope' })).toBe(0)
  })

  it('never writes to a board that is not shared with agents', async () => {
    const t = await token()
    const refused = await client.callTool(t, 'whiteboard_add_item', {
      boardId: HIDDEN_BOARD,
      title: 'Diary entry',
    })
    expect(refused.isError).toBe(true)
    expect(refused.text).toMatch(/No visible board with that id/)
    expect(refused.text).not.toContain('Diary')
    expect(
      await WhiteboardItemModel.countDocuments({ boardId: HIDDEN_BOARD })
    ).toBe(0)
  })

  it('with several shared boards and no boardId, asks which, listing the visible ones only', async () => {
    const second = String(
      (await WhiteboardBoardModel.create({ title: 'Work' }))._id
    )
    const t = await token()
    const asked = await client.callTool(t, 'whiteboard_add_item', {
      title: 'Where?',
    })
    expect(asked.isError).toBe(true)
    expect(asked.text).toContain(`Life (${BOARD})`)
    expect(asked.text).toContain(`Work (${second})`)
    expect(asked.text).not.toContain('Diary')

    const placed = await client.callTool(t, 'whiteboard_add_item', {
      title: 'Here',
      boardId: second,
    })
    expect(placed.isError).toBe(false)
  })

  it('a to-do card carries its rows; a text card may not', async () => {
    const t = await token()
    const todo = parse(
      (
        await client.callTool(t, 'whiteboard_add_item', {
          form: 'todo',
          title: 'Steps',
          todos: [
            { text: 'Draft the talk' },
            { text: 'Book the room', done: true },
          ],
        })
      ).text
    )
    const stored = await WhiteboardItemModel.findById(todo.id).lean()
    expect(stored?.todos.map(row => [row.text, row.done])).toEqual([
      ['Draft the talk', false],
      ['Book the room', true],
    ])
    const refused = await client.callTool(t, 'whiteboard_add_item', {
      title: 'x',
      todos: [{ text: 'y' }],
    })
    expect(refused.isError).toBe(true)
  })

  it('needs write: a read token does not see it, and a call is refused and audited', async () => {
    const t = await token(['read'])
    expect(await client.toolNames(t)).not.toContain('whiteboard_add_item')
    const call = await client.callTool(t, 'whiteboard_add_item', { title: 'x' })
    expect(call.isError).toBe(true)
    await flushAfter()
    expect(
      await AgentActionModel.countDocuments({
        tool: 'whiteboard_add_item',
        outcome: 'refused',
      })
    ).toBe(1)
    expect(await WhiteboardItemModel.countDocuments()).toBe(0)
  })
})

describe('whiteboard_link', () => {
  it('links a new card to an existing visible one ("Career 2027"), once per clientRef', async () => {
    const career = await owner(BOARD, {
      title: 'Career 2027',
      meaning: 'goal',
      status: 'active',
    })
    const t = await token()
    const found = await client.callTool(t, 'whiteboard_search', {
      query: 'Career 2027',
    })
    expect(found.text).toContain(career)
    const idea = parse(
      (
        await client.callTool(t, 'whiteboard_add_item', {
          title: 'Idea',
          meaning: 'goal',
        })
      ).text
    )

    const args = {
      from: idea.id,
      to: career,
      label: 'serves',
      clientRef: 'link-1',
    }
    const linked = await client.callTool(t, 'whiteboard_link', args)
    expect(parse(linked.text)).toMatchObject({
      from: idea.id,
      to: career,
      label: 'serves',
    })
    expect(await client.callTool(t, 'whiteboard_link', args)).toEqual(linked)
    expect(await WhiteboardLinkModel.countDocuments()).toBe(1)

    const read = await client.callTool(t, 'whiteboard_get_item', { id: career })
    expect(read.text).toContain(`<- serves [[Idea]] (${idea.id})`)
  })

  it('a hidden, unknown or malformed end gets the same answer, and no link', async () => {
    const visible = await owner(BOARD, { title: 'Visible' })
    const hiddenCard = await owner(BOARD, {
      title: 'Hidden',
      includeInAi: false,
    })
    const onHiddenBoard = await owner(HIDDEN_BOARD, { title: 'Diary card' })
    const t = await token()
    for (const other of [
      hiddenCard,
      onHiddenBoard,
      new mongoose.Types.ObjectId().toHexString(),
      'nope',
    ]) {
      const call = await client.callTool(t, 'whiteboard_link', {
        from: visible,
        to: other,
        label: 'x',
      })
      expect(call, other).toMatchObject({
        isError: true,
        text: 'No visible item with that id.',
      })
    }
    expect(await WhiteboardLinkModel.countDocuments()).toBe(0)
  })

  it('refuses two cards on different boards', async () => {
    const work = String(
      (await WhiteboardBoardModel.create({ title: 'Work' }))._id
    )
    const a = await owner(BOARD, { title: 'A' })
    const b = await owner(work, { title: 'B' })
    const call = await client.callTool(await token(), 'whiteboard_link', {
      from: a,
      to: b,
      label: '',
    })
    expect(call).toMatchObject({
      isError: true,
      text: 'A link joins two items on the same board.',
    })
  })
})
