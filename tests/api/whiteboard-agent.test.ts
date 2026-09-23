import { MongoMemoryServer } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import { NextRequest } from 'next/server'
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

import { getAuthCookieName, makeAuthToken } from '@/lib/auth'
import { MCP_BUDGET_CHARS } from '@/lib/whiteboard/context'
import { createItem, createLink } from '@/lib/whiteboard/data'
import { validateItem, validateLink } from '@/lib/whiteboard/limits'
import { createToken, hashToken, touchLastUsed } from '@/lib/whiteboard/token'
import { RateLimitModel } from '@/models/RateLimit'
import { WhiteboardItemModel } from '@/models/WhiteboardItem'
import { WhiteboardLinkModel } from '@/models/WhiteboardLink'
import { WhiteboardTokenModel } from '@/models/WhiteboardToken'

/**
 * The agent side: tokens, `GET /api/whiteboard/context.md` and `POST /api/whiteboard/mcp`.
 *
 * `after()` needs Next's request scope, which a handler called directly does not have, so it
 * is replaced with a queue the tests flush. That keeps the real ordering (the touch runs
 * AFTER the response) instead of pretending the write is synchronous.
 */

const deferred: (() => unknown)[] = []
vi.mock('next/server', async importOriginal => {
  const actual = await importOriginal<typeof import('next/server')>()
  return { ...actual, after: (fn: () => unknown) => deferred.push(fn) }
})
const flushAfter = async () => {
  while (deferred.length) await deferred.shift()!()
}

type Handler = (request: NextRequest, ctx?: unknown) => Promise<Response>
let memory: MongoMemoryServer
let contextMd: Handler
let mcpPost: Handler
let mcpGet: Handler
let mcpDelete: Handler
let tokensRoute: Record<'GET' | 'POST', Handler>
let revokeRoute: Handler

beforeAll(async () => {
  memory = await MongoMemoryServer.create()
  process.env.MONGODB_URI = memory.getUri()
  process.env.AUTH_SECRET = 'whiteboard-agent-secret'
  delete process.env.REQUIRE_ADMIN
  await mongoose.connect(memory.getUri())
  await WhiteboardItemModel.syncIndexes()
  await WhiteboardLinkModel.syncIndexes()
  await WhiteboardTokenModel.syncIndexes()

  contextMd = (await import('@/app/api/whiteboard/context.md/route'))
    .GET as Handler
  const mcp = await import('@/app/api/whiteboard/mcp/route')
  mcpPost = mcp.POST as Handler
  mcpGet = mcp.GET as unknown as Handler
  mcpDelete = mcp.DELETE as unknown as Handler
  tokensRoute =
    (await import('@/app/api/admin/whiteboard/tokens/route')) as never
  revokeRoute = (await import('@/app/api/admin/whiteboard/tokens/[id]/route'))
    .DELETE as Handler
}, 120_000)

afterAll(async () => {
  await mongoose.disconnect()
  await memory.stop()
})

let ipCounter = 0
let ip = ''
beforeEach(() => {
  // A fresh caller per test, so one test's traffic never spends another's rate-limit bucket.
  ip = `10.0.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`
})

afterEach(async () => {
  deferred.length = 0
  delete process.env.REQUIRE_ADMIN
  vi.restoreAllMocks()
  await Promise.all([
    WhiteboardItemModel.deleteMany({}),
    WhiteboardLinkModel.deleteMany({}),
    WhiteboardTokenModel.deleteMany({}),
    RateLimitModel.deleteMany({}),
  ])
})

const newId = () => new mongoose.Types.ObjectId().toHexString()

function agentRequest(
  url: string,
  {
    token,
    method = 'GET',
    body,
    headers = {},
  }: {
    token?: string
    method?: string
    body?: unknown
    headers?: Record<string, string>
  } = {}
) {
  return new NextRequest(url, {
    method,
    headers: {
      'x-forwarded-for': ip,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
      accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
}

const MD_URL = 'http://localhost/api/whiteboard/context.md'
const MCP_URL = 'http://localhost/api/whiteboard/mcp'

let rpcId = 0
async function rpc(token: string, method: string, params?: unknown) {
  const res = await mcpPost(
    agentRequest(MCP_URL, {
      token,
      method: 'POST',
      body: { jsonrpc: '2.0', id: ++rpcId, method, params },
    })
  )
  return res
}

async function callTool(token: string, name: string, args: unknown = {}) {
  const res = await rpc(token, 'tools/call', { name, arguments: args })
  expect(res.status).toBe(200)
  const body = (await res.json()) as {
    result: { content: { text: string }[]; isError?: boolean }
  }
  return { text: body.result.content[0].text, isError: body.result.isError }
}

async function item(overrides: Record<string, unknown> = {}) {
  const checked = validateItem({ _id: newId(), form: 'text', ...overrides })
  if (!checked.ok) throw new Error(checked.error)
  const result = await createItem(checked.value)
  if (!result.ok) throw new Error(result.error)
  return result.value
}

async function freshToken(name = 'laptop') {
  return (await createToken(name)).token
}

const ownerCookie = () =>
  `${getAuthCookieName()}=${makeAuthToken(Date.now() + 3_600_000)}`

function ownerRequest(method: string, body?: unknown) {
  return new NextRequest('http://localhost/api/admin/whiteboard/tokens', {
    method,
    headers: {
      cookie: ownerCookie(),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
}

describe('token routes (owner)', () => {
  it('create returns the plaintext once; only the hash is stored; list never shows either', async () => {
    const created = await tokensRoute.POST(
      ownerRequest('POST', { name: 'Laptop' })
    )
    expect(created.status).toBe(200)
    expect(created.headers.get('cache-control')).toBe('no-store, private')
    const { token, record } = await created.json()
    expect(token).toMatch(/^wbt_[A-Za-z0-9_-]{43}$/)
    expect(record.prefix).toBe(token.slice(0, 8))

    const stored = await WhiteboardTokenModel.findOne({}).lean()
    expect(stored?.hash).toBe(hashToken(token))
    expect(JSON.stringify(stored)).not.toContain(token)

    const list = await tokensRoute.GET(ownerRequest('GET'))
    const text = await list.text()
    expect(text).not.toContain(token)
    expect(text).not.toContain(stored!.hash)
    expect(Object.keys(JSON.parse(text).tokens[0]).sort()).toEqual([
      'createdAt',
      'id',
      'lastUsedAt',
      'name',
      'prefix',
      'revokedAt',
    ])
  })

  it('refuses a missing or multi-line name', async () => {
    for (const name of ['', 'a\nb', 'x'.repeat(81)])
      expect(
        (await tokensRoute.POST(ownerRequest('POST', { name }))).status
      ).toBe(400)
  })

  it('revoke keeps the record and the token stops working', async () => {
    const token = await freshToken()
    const record = await WhiteboardTokenModel.findOne({}).lean()
    const res = await revokeRoute(ownerRequest('DELETE'), {
      params: Promise.resolve({ id: String(record!._id) }),
    })
    expect(res.status).toBe(200)
    expect((await res.json()).record.revokedAt).not.toBeNull()
    expect(await WhiteboardTokenModel.countDocuments()).toBe(1)
    expect((await contextMd(agentRequest(MD_URL, { token }))).status).toBe(401)
  })

  it('token routes are 401 without the owner cookie', async () => {
    const anon = new NextRequest('http://localhost/api/admin/whiteboard/tokens')
    expect((await tokensRoute.GET(anon)).status).toBe(401)
  })
})

describe('agent auth (both routes)', () => {
  const routes = () =>
    [
      [
        'context.md',
        (token?: string, headers?: Record<string, string>) =>
          contextMd(agentRequest(MD_URL, { token, headers })),
      ],
      [
        'mcp',
        (token?: string, headers?: Record<string, string>) =>
          mcpPost(
            agentRequest(MCP_URL, {
              token,
              headers,
              method: 'POST',
              body: { jsonrpc: '2.0', id: 1, method: 'ping' },
            })
          ),
      ],
    ] as const

  it('401 for a missing, malformed, unknown or revoked token', async () => {
    const revoked = await freshToken()
    await WhiteboardTokenModel.updateOne(
      {},
      { $set: { revokedAt: new Date() } }
    )
    for (const [name, send] of routes()) 
      for (const token of [
        undefined,
        'not-a-token',
        `wbt_${'A'.repeat(43)}`,
        revoked,
      ]) {
        const res = await send(token)
        expect(res.status, `${name} ${token}`).toBe(401)
        expect(res.headers.get('cache-control')).toBe('no-store, private')
      }
    
  })

  it('a token in the query string is ignored', async () => {
    const token = await freshToken()
    const res = await contextMd(agentRequest(`${MD_URL}?token=${token}`))
    expect(res.status).toBe(401)
    const mcp = await mcpPost(
      agentRequest(`${MCP_URL}?access_token=${token}`, {
        method: 'POST',
        body: { jsonrpc: '2.0', id: 1, method: 'ping' },
      })
    )
    expect(mcp.status).toBe(401)
  })

  it('REQUIRE_ADMIN=false and the owner cookie do not open them', async () => {
    process.env.REQUIRE_ADMIN = 'false'
    for (const [name, send] of routes()) {
      expect((await send()).status, name).toBe(401)
      expect(
        (await send(undefined, { cookie: ownerCookie() })).status,
        name
      ).toBe(401)
    }
  })

  it('the 121st request in the window is 429 BEFORE the token is checked', async () => {
    const token = await freshToken()
    for (let i = 0; i < 120; i++)
      expect(
        (await contextMd(agentRequest(MD_URL, { token: 'wbt_guess' + i })))
          .status
      ).toBe(401)
    const findOne = vi.spyOn(WhiteboardTokenModel, 'findOne')
    const res = await mcpPost(
      agentRequest(MCP_URL, {
        token,
        method: 'POST',
        body: { jsonrpc: '2.0', id: 1, method: 'ping' },
      })
    )
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toMatch(/^\d+$/)
    expect(findOne).not.toHaveBeenCalled()
  })

  it('a token-lookup DB error is 503, never a pass', async () => {
    const token = await freshToken()
    vi.spyOn(WhiteboardTokenModel, 'findOne').mockImplementation(
      () =>
        ({
          lean: () => Promise.reject(new Error('connection reset')),
        }) as never
    )
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await contextMd(agentRequest(MD_URL, { token }))).status).toBe(503)
  })
})

describe('lastUsedAt touch (D29)', () => {
  it('runs after the response, and two calls within 5 minutes write once', async () => {
    const token = await freshToken()
    await contextMd(agentRequest(MD_URL, { token }))
    expect(
      (await WhiteboardTokenModel.findOne({}).lean())?.lastUsedAt
    ).toBeNull()
    await flushAfter()
    const first = (await WhiteboardTokenModel.findOne({}).lean())?.lastUsedAt
    expect(first).toBeInstanceOf(Date)

    const updates = vi.spyOn(WhiteboardTokenModel, 'updateOne')
    await contextMd(agentRequest(MD_URL, { token }))
    await flushAfter()
    expect(updates).toHaveBeenCalledTimes(1)
    const second = (await WhiteboardTokenModel.findOne({}).lean())?.lastUsedAt
    expect(second?.getTime()).toBe(first?.getTime())
  })

  it('writes again once the last touch is older than 5 minutes', async () => {
    const { record } = await createToken('x')
    const t0 = new Date('2026-01-01T00:00:00.000Z')
    await touchLastUsed(record.id, t0)
    await touchLastUsed(record.id, new Date(t0.getTime() + 4 * 60_000))
    expect(
      (await WhiteboardTokenModel.findById(record.id).lean())?.lastUsedAt
    ).toEqual(t0)
    const later = new Date(t0.getTime() + 6 * 60_000)
    await touchLastUsed(record.id, later)
    expect(
      (await WhiteboardTokenModel.findById(record.id).lean())?.lastUsedAt
    ).toEqual(later)
  })

  it('a failed touch never fails the request', async () => {
    const token = await freshToken()
    vi.spyOn(WhiteboardTokenModel, 'updateOne').mockRejectedValue(
      new Error('x')
    )
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await contextMd(agentRequest(MD_URL, { token }))
    expect(res.status).toBe(200)
    await flushAfter()
    expect(log).toHaveBeenCalled()
  })
})

describe('GET /api/whiteboard/context.md', () => {
  it('is the visible board as text/markdown, hidden items left out', async () => {
    const token = await freshToken()
    const hiddenFrame = await item({
      form: 'frame',
      title: 'Private',
      includeInAi: false,
    })
    await item({ parentId: hiddenFrame._id, title: 'Inside private' })
    await item({ title: 'Directly hidden', includeInAi: false })
    await item({ title: 'Public goal', meaning: 'goal', status: 'active' })

    const res = await contextMd(agentRequest(MD_URL, { token }))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/markdown; charset=utf-8')
    expect(res.headers.get('cache-control')).toBe('no-store, private')
    const md = await res.text()
    expect(md).toContain('Public goal')
    for (const secret of ['Private', 'Inside private', 'Directly hidden'])
      expect(md).not.toContain(secret)
  })
})

describe('POST /api/whiteboard/mcp - protocol', () => {
  it('initialize answers as JSON, not SSE', async () => {
    const token = await freshToken()
    const res = await rpc(token, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '1' },
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/json')
    expect(res.headers.get('cache-control')).toBe('no-store, private')
    const body = await res.json()
    expect(body.result.serverInfo.name).toBe('port4lio-whiteboard')
    expect(body.result.capabilities.tools).toBeDefined()
    expect(body.result.capabilities.resources).toBeUndefined()
  })

  it('notifications get 202 with no body', async () => {
    const token = await freshToken()
    for (const method of [
      'notifications/initialized',
      'notifications/cancelled',
    ]) {
      const res = await mcpPost(
        agentRequest(MCP_URL, {
          token,
          method: 'POST',
          body: { jsonrpc: '2.0', method, params: { requestId: 1 } },
        })
      )
      expect(res.status, method).toBe(202)
      expect(await res.text()).toBe('')
    }
  })

  it('ping answers, and an unknown request is -32601', async () => {
    const token = await freshToken()
    expect(await (await rpc(token, 'ping')).json()).toMatchObject({
      result: {},
    })
    expect(await (await rpc(token, 'resources/list')).json()).toMatchObject({
      error: { code: -32601 },
    })
    expect(await (await rpc(token, 'made/up')).json()).toMatchObject({
      error: { code: -32601 },
    })
  })

  it('tools/list is exactly the three read-only tools', async () => {
    const token = await freshToken()
    const body = await (await rpc(token, 'tools/list')).json()
    const tools = body.result.tools as {
      name: string
      annotations?: { readOnlyHint?: boolean }
    }[]
    expect(tools.map(t => t.name).sort()).toEqual([
      'get_item',
      'get_overview',
      'search_context',
    ])
    for (const tool of tools) expect(tool.annotations?.readOnlyHint).toBe(true)
  })

  it('a client that accepts only JSON is still served', async () => {
    const token = await freshToken()
    const res = await mcpPost(
      agentRequest(MCP_URL, {
        token,
        method: 'POST',
        headers: { accept: 'application/json' },
        body: { jsonrpc: '2.0', id: 9, method: 'ping' },
      })
    )
    expect(res.status).toBe(200)
  })

  it('GET and DELETE are 405', async () => {
    for (const handler of [mcpGet, mcpDelete]) {
      const res = await handler(agentRequest(MCP_URL))
      expect(res.status).toBe(405)
      expect(res.headers.get('allow')).toBe('POST')
    }
  })
})

describe('MCP tools', () => {
  it('get_overview counts only what agents can see', async () => {
    const token = await freshToken()
    const hidden = await item({
      form: 'frame',
      title: 'Vault',
      includeInAi: false,
    })
    await item({
      parentId: hidden._id,
      meaning: 'goal',
      status: 'active',
      title: 'Hidden goal',
    })
    await item({ meaning: 'goal', status: 'active', title: 'Run a 10k' })
    await item({
      meaning: 'failure',
      title: 'Dropped the course',
      body: 'SECRET BODY',
    })

    const { text } = await callTool(token, 'get_overview')
    expect(text).toContain('2 visible items')
    expect(text).toContain('goal 1')
    expect(text).toContain('Run a 10k')
    expect(text).not.toContain('Hidden goal')
    expect(text).not.toContain('Vault')
    expect(text).not.toContain('SECRET BODY')
  })

  it('search_context finds Vietnamese text and hides what is hidden', async () => {
    const token = await freshToken()
    await item({ title: 'Ước mơ mở quán cà phê', meaning: 'dream' })
    await item({ title: 'Ước mơ bí mật', includeInAi: false })
    for (const query of ['ước mơ', 'uoc mo', 'cà phê']) {
      const { text } = await callTool(token, 'search_context', { query })
      expect(text, query).toContain('Ước mơ mở quán cà phê')
      expect(text, query).not.toContain('bí mật')
    }
  })

  it('search_context with nothing to go on is the D23 tool error', async () => {
    const token = await freshToken()
    expect(await callTool(token, 'search_context', {})).toEqual({
      text: 'Give a query or at least one filter. For a summary of the board, call get_overview.',
      isError: true,
    })
  })

  it('search_context by date range answers "what did I want in 2025?" (D22 boundary)', async () => {
    const token = await freshToken()
    await item({
      title: 'Wanted in 2025',
      meaning: 'dream',
      when: '2025-12-31',
    })
    await item({
      title: 'Wanted in 2026',
      meaning: 'dream',
      when: '2026-01-01',
    })
    const { text } = await callTool(token, 'search_context', {
      meanings: ['dream', 'goal'],
      from: '2025-01-01',
      to: '2025-12-31',
    })
    expect(text).toContain('Wanted in 2025')
    expect(text).not.toContain('Wanted in 2026')
  })

  it('search_context rejects a non-day date', async () => {
    const token = await freshToken()
    const res = await rpc(token, 'tools/call', {
      name: 'search_context',
      arguments: { from: '2025-01-01T00:00:00Z' },
    })
    const body = await res.json()
    expect(body.error ?? body.result?.isError).toBeTruthy()
  })

  it('a malformed or unknown frameId gives the same empty result (R3-14)', async () => {
    const token = await freshToken()
    await item({ title: 'Anything', meaning: 'goal' })
    const answers = await Promise.all(
      ['not-an-id', newId()].map(frameId =>
        callTool(token, 'search_context', { meanings: ['goal'], frameId })
      )
    )
    expect(answers[0]).toEqual(answers[1])
    expect(answers[0].text).toBe('No matching items.')
  })

  it('get_item: hidden, unknown and malformed ids are the same not-found', async () => {
    const token = await freshToken()
    const hidden = await item({ includeInAi: false, title: 'Nope' })
    const answers = await Promise.all(
      [hidden._id, newId(), 'zzz', "{$gt:''}"].map(id =>
        callTool(token, 'get_item', { id })
      )
    )
    for (const answer of answers)
      expect(answer).toEqual({ text: 'No item with that id.', isError: true })
  })

  it('get_item returns the full body and neighbour titles only', async () => {
    const token = await freshToken()
    const goal = await item({ title: 'Big goal', body: 'long '.repeat(3_000) })
    const note = await item({ title: 'Why', body: 'NEIGHBOUR BODY' })
    const checked = validateLink({
      _id: newId(),
      from: note._id,
      to: goal._id,
      label: 'because',
    })
    if (!checked.ok) throw new Error()
    await createLink(checked.value)

    const { text } = await callTool(token, 'get_item', { id: goal._id })
    expect(text).not.toContain('(clipped')
    expect(text).toContain(`- <- because [[Why]] (${note._id})`)
    expect(text).not.toContain('NEIGHBOUR BODY')
  })

  it('every tool answer stays within the D18 budget on a big board', async () => {
    const token = await freshToken()
    await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        item({
          title: `Goal ${i} marathon`,
          meaning: 'goal',
          status: 'active',
          body: 'marathon '.repeat(2_000),
        })
      )
    )
    for (const [name, args] of [
      ['get_overview', {}],
      ['search_context', { query: 'marathon', limit: 25 }],
    ] as const) {
      const { text } = await callTool(token, name, args)
      expect(text.length, name).toBeLessThanOrEqual(MCP_BUDGET_CHARS)
    }
    const { text } = await callTool(token, 'search_context', {
      query: 'marathon',
      limit: 25,
    })
    expect(text).toMatch(/\(\d+ more - narrow the search\)/)
    expect(text).toContain('(clipped - get_item')
  })
})
