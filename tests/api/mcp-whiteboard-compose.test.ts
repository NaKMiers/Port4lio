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
 * `whiteboard_compose` and `whiteboard_arrange` through `/api/mcp`.
 *
 * ```
 *   compose   new board (created shared) or a visible one · frames + cards + heading + links
 *             every item visible and tagged `agent` · beside existing content, never on it
 *             ANY refusal ──▶ nothing written, not even the new board
 *             link ends: refs, or visible ids on the same board · hidden ids refused
 *             clientRef replays · a retry after a partial write converges on the same ids
 *   arrange   agent items only: an owner card anywhere in the call refuses the whole call
 *             deleting an agent frame keeps an owner card that was inside it
 *   both      need write; a read token does not see them
 * ```
 */

vi.hoisted(() => {
  process.env.PROFILE_DOCUMENT_ID = 'mcp-whiteboard-compose-profile'
})

const deferred: (() => unknown)[] = []
vi.mock('next/server', async importOriginal => {
  const actual = await importOriginal<typeof import('next/server')>()
  return { ...actual, after: (fn: () => unknown) => deferred.push(fn) }
})

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
  process.env.AUTH_SECRET = 'mcp-whiteboard-compose-secret'
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

const PLAN = {
  newBoard: { title: 'Launch plan' },
  layout: 'columns',
  heading: 'Launch the course platform',
  sections: [
    {
      ref: 'goals',
      title: 'Goals',
      cards: [
        {
          ref: 'ship',
          title: 'Ship the API by March',
          body: 'Public beta first.\nThen the paid tier.',
          meaning: 'goal',
          status: 'active',
          targetBy: '2027-03-31',
        },
        { ref: 'why', title: 'Why now', meaning: 'note' },
      ],
    },
    {
      ref: 'work',
      title: 'Work',
      columns: 2,
      cards: [
        {
          ref: 'checklist',
          form: 'todo',
          title: 'Launch checklist',
          todos: [{ text: 'Pricing page' }, { text: 'Docs', done: true }],
        },
        { ref: 'risk', form: 'shape', shape: 'diamond', title: 'Go / no-go' },
        { title: 'Load test', meaning: 'draft' },
      ],
    },
  ],
  links: [
    { from: 'checklist', to: 'ship', label: 'serves' },
    { from: 'risk', to: 'goals', label: 'gates' },
  ],
}

type Box = { x: number; y: number; width: number; height: number }
const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width &&
  b.x < a.x + a.width &&
  a.y < b.y + b.height &&
  b.y < a.y + a.height

describe('whiteboard_compose', () => {
  it('builds a laid-out board on a new, agent-visible board: frames, cards, heading, links', async () => {
    const t = await token()
    const call = await client.callTool(t, 'whiteboard_compose', {
      ...PLAN,
      clientRef: 'plan-1',
    })
    expect(call.isError, call.text).toBe(false)
    const result = parse(call.text)

    const board = await WhiteboardBoardModel.findById(result.board.id).lean()
    expect(board).toMatchObject({ title: 'Launch plan', includeInAi: true })
    expect(result.board).toMatchObject({
      created: true,
      path: `/admin/whiteboard/${result.board.id}`,
    })
    // 1 heading + 2 frames + 5 cards; 2 links.
    expect(result).toMatchObject({ items: 8, links: 2 })

    const items = await WhiteboardItemModel.find({
      boardId: result.board.id,
    }).lean()
    expect(items).toHaveLength(8)
    for (const item of items) {
      expect(item.tags).toContain('agent')
      expect(item.includeInAi).toBe(true)
    }

    const byId = new Map(items.map(item => [String(item._id), item]))
    const goals = byId.get(result.refs.goals)!
    const ship = byId.get(result.refs.ship)!
    expect(goals).toMatchObject({ form: 'frame', title: 'Goals' })
    expect(String(ship.parentId)).toBe(result.refs.goals)
    expect(ship).toMatchObject({ meaning: 'goal', status: 'active' })
    expect(byId.get(result.refs.heading)).toMatchObject({
      form: 'shape',
      shape: 'rect',
      title: 'Launch the course platform',
      parentId: null,
    })
    expect(byId.get(result.refs.risk)).toMatchObject({
      form: 'shape',
      shape: 'diamond',
    })
    expect(byId.get(result.refs.checklist)?.todos.map(row => row.done)).toEqual(
      [false, true]
    )
    // An unnamed card gets a default ref.
    expect(result.refs['work.card-3']).toBeDefined()

    // Laid out: the two frames and the heading do not overlap each other.
    const top = items.filter(item => item.parentId === null)
    for (let i = 0; i < top.length; i += 1)
      for (let j = i + 1; j < top.length; j += 1)
        expect(overlaps(top[i], top[j])).toBe(false)

    const serves = await WhiteboardLinkModel.findOne({ label: 'serves' }).lean()
    expect(String(serves?.from)).toBe(result.refs.checklist)
    expect(String(serves?.to)).toBe(result.refs.ship)
    // Handles picked from the geometry, so the arrow does not loop over the top.
    expect(serves?.fromHandle).toMatch(/^[trbl]$/)
    expect(serves?.toHandle).toMatch(/^[trbl]$/)

    // Readable back through the one agent read path.
    const read = await client.callTool(t, 'whiteboard_get_item', {
      id: result.refs.ship,
    })
    expect(read.text).toContain('Ship the API by March')
    expect(read.text).toContain('serves')
  })

  it('a refusal anywhere writes nothing - not even the new board', async () => {
    const t = await token()
    const bad = structuredClone(PLAN)
    bad.sections[1].cards[2].meaning = 'unicorn'
    const call = await client.callTool(t, 'whiteboard_compose', bad)
    expect(call.isError).toBe(true)
    expect(call.text).toMatch(/meaning must be one of/)
    expect(
      await WhiteboardBoardModel.countDocuments({ title: 'Launch plan' })
    ).toBe(0)
    expect(await WhiteboardItemModel.countDocuments()).toBe(0)
    expect(await WhiteboardLinkModel.countDocuments()).toBe(0)
  })

  it('refuses a duplicate ref, a link to an unknown ref, and todos on a text card', async () => {
    const t = await token()
    const dupe = structuredClone(PLAN)
    dupe.sections[1].cards[0].ref = 'ship'
    expect((await client.callTool(t, 'whiteboard_compose', dupe)).text).toMatch(
      /ref "ship" is used twice/
    )

    const dangling = { ...PLAN, links: [{ from: 'ship', to: 'nowhere' }] }
    expect(
      (await client.callTool(t, 'whiteboard_compose', dangling)).text
    ).toMatch(/"nowhere" is not a ref in this call/)

    const todos = structuredClone(PLAN) as Record<string, unknown> & typeof PLAN
    ;(todos.sections[0].cards[0] as Record<string, unknown>).todos = [
      { text: 'x' },
    ]
    expect(
      (await client.callTool(t, 'whiteboard_compose', todos)).text
    ).toMatch(/only a to-do card has todos/)
    expect(await WhiteboardItemModel.countDocuments()).toBe(0)
  })

  it('lands beside what is already on a board, and links to the owner card by id', async () => {
    const career = await owner(BOARD, {
      title: 'Career 2027',
      meaning: 'goal',
      status: 'active',
      x: 0,
      y: 40,
      width: 240,
      height: 120,
    })
    const hidden = await owner(BOARD, {
      title: 'Private',
      includeInAi: false,
      y: 40,
    })
    const t = await token()

    const { newBoard: _newBoard, ...onBoard } = PLAN
    const call = await client.callTool(t, 'whiteboard_compose', {
      ...onBoard,
      boardId: BOARD,
      links: [{ from: 'ship', to: career, label: 'serves' }],
    })
    expect(call.isError, call.text).toBe(false)
    const result = parse(call.text)
    expect(result.board).toMatchObject({ id: BOARD, created: false })
    expect(result.bounds.x).toBeGreaterThanOrEqual(240)
    expect(result.bounds.y).toBe(40)

    const link = await WhiteboardLinkModel.findOne({ to: career }).lean()
    expect(String(link?.from)).toBe(result.refs.ship)
    // The owner's card is untouched.
    expect(await WhiteboardItemModel.findById(career).lean()).toMatchObject({
      x: 0,
      y: 40,
      tags: [],
    })

    const refused = await client.callTool(t, 'whiteboard_compose', {
      ...onBoard,
      boardId: BOARD,
      links: [{ from: 'ship', to: hidden }],
    })
    expect(refused.isError).toBe(true)
    expect(refused.text).toMatch(/not a ref in this call or a visible item/)
  })

  it('never writes to a board that is not shared with agents, and asks which board when several are', async () => {
    const t = await token()
    const { newBoard: _newBoard, ...onBoard } = PLAN
    const hidden = await client.callTool(t, 'whiteboard_compose', {
      ...onBoard,
      boardId: HIDDEN_BOARD,
    })
    expect(hidden.isError).toBe(true)
    expect(hidden.text).not.toContain('Diary')

    await WhiteboardBoardModel.create({ title: 'Work' })
    const asked = await client.callTool(t, 'whiteboard_compose', onBoard)
    expect(asked.text).toMatch(/Say which board/)
    expect(await WhiteboardItemModel.countDocuments()).toBe(0)
  })

  it('a clientRef replay returns the first result and writes nothing more', async () => {
    const t = await token()
    const args = { ...PLAN, clientRef: 'plan-once' }
    const first = await client.callTool(t, 'whiteboard_compose', args)
    const second = await client.callTool(t, 'whiteboard_compose', args)
    expect(second).toEqual(first)
    expect(
      await WhiteboardBoardModel.countDocuments({ title: 'Launch plan' })
    ).toBe(1)
    expect(await WhiteboardItemModel.countDocuments()).toBe(8)
  })

  it('a retry after a partial write converges on the same ids instead of a second board', async () => {
    // The takeover path (runTool step 3) re-runs the call with the same seed.
    // Called below the tool, so the zod defaults (form: 'text') are applied by hand.
    const outline = {
      ...PLAN,
      sections: PLAN.sections.map(section => ({
        ...section,
        cards: section.cards.map(card => ({ form: 'text', ...card })),
      })),
    } as Parameters<typeof data.composeAgentBoard>[0]
    const first = await data.composeAgentBoard(outline, { seed: 'tok:ref' })
    if (!first.ok) throw new Error(first.error)
    // Part of the board lost: the retry must put back exactly what is missing.
    await WhiteboardItemModel.deleteMany({
      _id: { $in: [first.value.refs.why, first.value.refs.ship] },
    })
    const second = await data.composeAgentBoard(outline, { seed: 'tok:ref' })
    expect(second).toEqual(first)
    expect(
      await WhiteboardBoardModel.countDocuments({ title: 'Launch plan' })
    ).toBe(1)
    expect(await WhiteboardItemModel.countDocuments()).toBe(8)
    expect(await WhiteboardLinkModel.countDocuments()).toBe(2)
  })

  it('timeline chains its phases; mindmap draws a centre and a spoke to each section', async () => {
    const t = await token()
    const phases = ['Q1', 'Q2', 'Q3'].map(title => ({
      title,
      cards: [{ title: `${title} milestone`, meaning: 'goal' }],
    }))
    const timeline = parse(
      (
        await client.callTool(t, 'whiteboard_compose', {
          newBoard: { title: 'Year' },
          layout: 'timeline',
          sections: phases,
        })
      ).text
    )
    expect(timeline.links).toBe(2)
    const chain = await WhiteboardLinkModel.find({
      boardId: timeline.board.id,
    }).lean()
    expect(chain.every(l => l.fromHandle === 'r' && l.toHandle === 'l')).toBe(
      true
    )

    const mindmap = parse(
      (
        await client.callTool(t, 'whiteboard_compose', {
          newBoard: { title: 'Ideas' },
          layout: 'mindmap',
          sections: phases,
        })
      ).text
    )
    expect(mindmap.links).toBe(3)
    // No heading given: the centre is named after the board.
    expect(
      await WhiteboardItemModel.findById(mindmap.refs.heading).lean()
    ).toMatchObject({ form: 'shape', shape: 'ellipse', title: 'Ideas' })
  })

  it('a clientRef reused with a different outline after its window writes the new outline', async () => {
    const t = await token()
    const first = parse(
      (
        await client.callTool(t, 'whiteboard_compose', {
          ...PLAN,
          clientRef: 'reused',
        })
      ).text
    )
    // Past the 24 h replay window, runTool lets the key run again with other arguments.
    await AgentActionModel.updateMany(
      { clientRef: 'reused' },
      { $set: { at: new Date(Date.now() - 25 * 60 * 60 * 1000) } }
    )
    const other = {
      newBoard: { title: 'Second plan' },
      layout: 'grid',
      sections: [
        {
          ref: 'goals',
          title: 'Other goals',
          cards: [{ ref: 'ship', title: 'Different' }],
        },
      ],
      clientRef: 'reused',
    }
    const second = await client.callTool(t, 'whiteboard_compose', other)
    expect(second.isError, second.text).toBe(false)
    const result = parse(second.text)
    expect(result.board.id).not.toBe(first.board.id)
    expect(result.refs.ship).not.toBe(first.refs.ship)
    expect(
      await WhiteboardItemModel.findById(result.refs.ship).lean()
    ).toMatchObject({
      title: 'Different',
    })
    expect(
      await WhiteboardBoardModel.countDocuments({ title: 'Second plan' })
    ).toBe(1)
  })

  it('refuses a new-board title the board API would refuse, and a body on a to-do card', async () => {
    const t = await token()
    const newline = await client.callTool(t, 'whiteboard_compose', {
      ...PLAN,
      newBoard: { title: 'Plan\nQ3' },
    })
    expect(newline.isError).toBe(true)
    expect(newline.text).toMatch(/newBoard: title must be a single line/)

    const body = structuredClone(PLAN) as typeof PLAN
    ;(body.sections[1].cards[0] as Record<string, unknown>).body = 'Hidden text'
    const refused = await client.callTool(t, 'whiteboard_compose', body)
    expect(refused.text).toMatch(/only a text card shows a body/)
    expect(await WhiteboardBoardModel.countDocuments()).toBe(2)
    expect(await WhiteboardItemModel.countDocuments()).toBe(0)
  })

  it('a retry into a new board the owner has hidden since is refused, and adds nothing', async () => {
    const outline = {
      ...PLAN,
      sections: PLAN.sections.map(section => ({
        ...section,
        cards: section.cards.map(card => ({ form: 'text', ...card })),
      })),
    } as Parameters<typeof data.composeAgentBoard>[0]
    const first = await data.composeAgentBoard(outline, { seed: 'tok:hide' })
    if (!first.ok) throw new Error(first.error)
    await WhiteboardBoardModel.updateOne(
      { _id: first.value.board.id },
      { $set: { includeInAi: false } }
    )
    await WhiteboardItemModel.deleteOne({ _id: first.value.refs.why })

    const retry = await data.composeAgentBoard(outline, { seed: 'tok:hide' })
    expect(retry).toMatchObject({ ok: false, status: 409 })
    expect(
      await WhiteboardItemModel.exists({ _id: first.value.refs.why })
    ).toBeNull()
  })

  it('spends the compose bucket: past WHITEBOARD_COMPOSE_LIMIT a call is refused and writes nothing', async () => {
    const { WHITEBOARD_COMPOSE_LIMIT } = await import('@/lib/rate-limit')
    const t = await token()
    const small = {
      newBoard: { title: 'Tiny' },
      sections: [{ title: 'One', cards: [{ title: 'Card' }] }],
    }
    for (let n = 0; n < WHITEBOARD_COMPOSE_LIMIT.limit; n += 1)
      expect(
        (await client.callTool(t, 'whiteboard_compose', small)).isError
      ).toBe(false)
    const before = await WhiteboardItemModel.countDocuments()
    const limited = await client.callTool(t, 'whiteboard_compose', small)
    expect(limited.isError).toBe(true)
    expect(limited.text).toMatch(
      /Rate limit: this token has used its whiteboard-compose budget/
    )
    expect(await WhiteboardItemModel.countDocuments()).toBe(before)
  })

  it('needs write: a read token sees neither compose nor arrange', async () => {
    const names = await client.toolNames(await token(['read']))
    expect(names).not.toContain('whiteboard_compose')
    expect(names).not.toContain('whiteboard_arrange')
  })
})

describe('whiteboard_arrange', () => {
  async function composed(t: string) {
    const call = await client.callTool(t, 'whiteboard_compose', PLAN)
    expect(call.isError, call.text).toBe(false)
    return parse(call.text) as { refs: Record<string, string> }
  }

  it('moves and resizes agent items', async () => {
    const t = await token()
    const { refs } = await composed(t)
    const call = await client.callTool(t, 'whiteboard_arrange', {
      moves: [
        { id: refs.ship, x: 40, y: 300 },
        { id: refs.goals, width: 900, height: 700 },
      ],
    })
    expect(call.isError, call.text).toBe(false)
    expect(await WhiteboardItemModel.findById(refs.ship).lean()).toMatchObject({
      x: 40,
      y: 300,
    })
    expect(await WhiteboardItemModel.findById(refs.goals).lean()).toMatchObject(
      { width: 900, height: 700 }
    )
  })

  it('one owner card in the call refuses all of it, and changes nothing', async () => {
    const t = await token()
    const { refs } = await composed(t)
    const mine = await owner(BOARD, { title: 'Mine', x: 5, y: 5 })
    const before = await WhiteboardItemModel.findById(refs.ship).lean()

    const call = await client.callTool(t, 'whiteboard_arrange', {
      moves: [
        { id: refs.ship, x: 999, y: 999 },
        { id: mine, x: 500, y: 500 },
      ],
    })
    expect(call.isError).toBe(true)
    expect(call.text).toContain(`Not an agent item you can change: ${mine}`)
    expect(await WhiteboardItemModel.findById(mine).lean()).toMatchObject({
      x: 5,
      y: 5,
    })
    expect(await WhiteboardItemModel.findById(refs.ship).lean()).toMatchObject({
      x: before!.x,
      y: before!.y,
    })

    const del = await client.callTool(t, 'whiteboard_arrange', {
      deletes: [mine],
    })
    expect(del.isError).toBe(true)
    expect(await WhiteboardItemModel.exists({ _id: mine })).toBeTruthy()
  })

  it('refuses to move or delete an agent frame the owner has put their own card into', async () => {
    const t = await token()
    const { refs } = await composed(t)
    const frame = await WhiteboardItemModel.findById(refs.goals).lean()
    // The owner dragged their own card into the agent's frame.
    const mine = await owner(String(frame!.boardId), {
      title: 'Mine',
      parentId: refs.goals,
      x: 10,
      y: 10,
    })

    for (const args of [
      { deletes: [refs.goals] },
      { moves: [{ id: refs.goals, x: 5000, y: 5000 }] },
    ]) {
      const call = await client.callTool(t, 'whiteboard_arrange', args)
      expect(call.isError).toBe(true)
      expect(call.text).toMatch(/holds items the owner put there/)
      expect(call.text).not.toContain('Mine')
    }
    expect(await WhiteboardItemModel.findById(refs.goals).lean()).toMatchObject(
      { x: frame!.x, y: frame!.y }
    )
    expect(await WhiteboardItemModel.findById(mine).lean()).toMatchObject({
      parentId: new mongoose.Types.ObjectId(refs.goals),
      x: 10,
    })
  })

  it('deletes an agent frame of agent cards: the cards stay, un-framed, and its arrows go', async () => {
    const t = await token()
    const { refs } = await composed(t)
    const frame = await WhiteboardItemModel.findById(refs.goals).lean()
    const ship = await WhiteboardItemModel.findById(refs.ship).lean()

    const call = await client.callTool(t, 'whiteboard_arrange', {
      deletes: [refs.goals],
    })
    expect(call.isError, call.text).toBe(false)
    expect(parse(call.text)).toEqual({ moved: [], deleted: [refs.goals] })
    expect(await WhiteboardItemModel.exists({ _id: refs.goals })).toBeNull()
    expect(await WhiteboardItemModel.findById(refs.ship).lean()).toMatchObject({
      parentId: null,
      x: frame!.x + ship!.x,
      y: frame!.y + ship!.y,
    })
    expect(await WhiteboardLinkModel.countDocuments({ to: refs.goals })).toBe(0)
  })

  it('an agent item the owner has since hidden, or claimed by removing the tag, is refused', async () => {
    const t = await token()
    const { refs } = await composed(t)
    await WhiteboardItemModel.updateOne(
      { _id: refs.why },
      { $set: { includeInAi: false } }
    )
    await WhiteboardItemModel.updateOne(
      { _id: refs.ship },
      { $set: { tags: [] } }
    )
    for (const id of [refs.why, refs.ship]) {
      const call = await client.callTool(t, 'whiteboard_arrange', {
        deletes: [id],
      })
      expect(call.isError).toBe(true)
      expect(call.text).toContain(`Not an agent item you can change: ${id}`)
      expect(await WhiteboardItemModel.exists({ _id: id })).toBeTruthy()
    }

    // A whole board hidden since: nothing on it is reachable.
    const board = (await WhiteboardItemModel.findById(refs.risk).lean())!
      .boardId
    await WhiteboardBoardModel.updateOne(
      { _id: board },
      { $set: { includeInAi: false } }
    )
    const hidden = await client.callTool(t, 'whiteboard_arrange', {
      moves: [{ id: refs.risk, x: 1, y: 1 }],
    })
    expect(hidden.isError).toBe(true)
  })
})
