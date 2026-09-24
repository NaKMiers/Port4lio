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
import { z } from 'zod'

import { AgentActionModel } from '@/models/AgentAction'
import { AgentTokenModel } from '@/models/AgentToken'
import { RateLimitModel } from '@/models/RateLimit'
import { WhiteboardBoardModel } from '@/models/WhiteboardBoard'
import { WhiteboardItemModel } from '@/models/WhiteboardItem'
import { WhiteboardTokenModel } from '@/models/WhiteboardToken'

import {
  agentRequest,
  freshIp,
  mcpClient,
  type RouteHandler,
} from './mcp-helpers'

/**
 * The MCP core: the front door (`lib/mcp/token.ts`), per-request registration
 * (`lib/mcp/server.ts`) and the one wrapper around every call (`lib/mcp/run-tool.ts`).
 *
 * ```
 *   guard         p4_ ok · unknown/revoked/malformed 401 · wbt_ on /api/mcp 401 · lookup throws 503
 *   registration  tools/list == registry filtered by scope · prompts per scope (C6)
 *   R1            out-of-scope registry name ──▶ isError + ONE refused row; unknown name ──▶ SDK error, no row
 *   runTool       scope recheck · zod teaching error · clientRef claim/replay/concurrent/takeover/mismatch (R4)
 *                 per-token cost bucket (R5) · one row per audited call · the budget net's marker (C10)
 * ```
 *
 * The write-tool mechanics are exercised through a synthetic server spec, which isolates
 * `runTool` from any one tool's service; the same `runTool` runs every real tool, and
 * mcp-blog-tools, mcp-operator-tools and mcp-whiteboard-tools drive it through them.
 */

vi.hoisted(() => {
  process.env.PROFILE_DOCUMENT_ID = 'mcp-core-profile'
})

const deferred: (() => unknown)[] = []
vi.mock('next/server', async importOriginal => {
  const actual = await importOriginal<typeof import('next/server')>()
  return { ...actual, after: (fn: () => unknown) => deferred.push(fn) }
})
const flushAfter = async () => {
  while (deferred.length) await deferred.shift()!()
}

const MCP_URL = 'http://localhost/api/mcp'
const ALIAS_URL = 'http://localhost/api/whiteboard/mcp'
const MD_URL = 'http://localhost/api/whiteboard/context.md'

let memory: MongoMemoryServer
let mcpPost: RouteHandler
let mcpGet: () => Promise<Response>
let mcpDelete: () => Promise<Response>
let aliasPost: RouteHandler
let contextMd: RouteHandler
let tokenLib: typeof import('@/lib/mcp/token')
let serverLib: typeof import('@/lib/mcp/server')
let runToolLib: typeof import('@/lib/mcp/run-tool')
let legacyLib: typeof import('@/lib/whiteboard/token')
let ProfileModel: typeof import('@/models/Profile').ProfileModel
let BOARD = ''

beforeAll(async () => {
  memory = await MongoMemoryServer.create()
  process.env.MONGODB_URI = memory.getUri()
  process.env.AUTH_SECRET = 'mcp-core-secret'
  delete process.env.REQUIRE_ADMIN
  await mongoose.connect(memory.getUri())
  await Promise.all([
    AgentTokenModel.syncIndexes(),
    AgentActionModel.syncIndexes(),
    WhiteboardTokenModel.syncIndexes(),
    WhiteboardItemModel.syncIndexes(),
  ])
  BOARD = String((await WhiteboardBoardModel.create({ title: 'Board' }))._id)

  const mcp = await import('@/app/api/mcp/route')
  mcpPost = mcp.POST as RouteHandler
  mcpGet = mcp.GET
  mcpDelete = mcp.DELETE
  aliasPost = (await import('@/app/api/whiteboard/mcp/route'))
    .POST as RouteHandler
  contextMd = (await import('@/app/api/whiteboard/context.md/route'))
    .GET as RouteHandler
  tokenLib = await import('@/lib/mcp/token')
  serverLib = await import('@/lib/mcp/server')
  runToolLib = await import('@/lib/mcp/run-tool')
  legacyLib = await import('@/lib/whiteboard/token')
  ;({ ProfileModel } = await import('@/models/Profile'))
}, 120_000)

afterAll(async () => {
  await mongoose.disconnect()
  await memory.stop()
})

afterEach(async () => {
  deferred.length = 0
  delete process.env.REQUIRE_ADMIN
  vi.restoreAllMocks()
  await Promise.all([
    AgentTokenModel.deleteMany({}),
    AgentActionModel.deleteMany({}),
    WhiteboardTokenModel.deleteMany({}),
    WhiteboardItemModel.deleteMany({}),
    RateLimitModel.deleteMany({}),
    ProfileModel.deleteMany({}),
  ])
})

type Scope = 'read' | 'write' | 'publish' | 'pii'
const p4 = async (scopes: Scope[] = ['read'], name = 'laptop') =>
  (await tokenLib.createAgentToken(name, scopes)).token
const wbt = async () => (await legacyLib.createToken('old laptop')).token
const contextOf = async (token: string) => {
  const doc = await AgentTokenModel.findOne({
    hash: tokenLib.hashToken(token),
  }).lean()
  return {
    tokenId: String(doc!._id),
    name: doc!.name,
    scopes: doc!.scopes,
    kind: 'agent' as const,
  }
}

/** The registry's read tools, grown phase by phase (acceptance.md "Tool coverage"). */
const READ_TOOLS = [
  'ccaf_status',
  'get_briefing',
  'get_me',
  'get_post',
  'get_profile',
  'get_writing_brief',
  'lint_draft',
  'list_posts',
  'list_taxonomy',
  'whiteboard_get_item',
  'whiteboard_overview',
  'whiteboard_search',
]

describe('the front door (guardAgent)', () => {
  it('a p4_ token opens /api/mcp; the response is JSON and no-store', async () => {
    const token = await p4()
    const { rpc } = mcpClient(mcpPost, MCP_URL)
    const res = await rpc(token, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '1' },
    })
    expect(res.status).toBe(200)
    expect(res.body.result?.serverInfo).toMatchObject({ name: 'port4lio' })
  })

  it('401 for missing, malformed, unknown and revoked tokens, all no-store', async () => {
    const revoked = await p4()
    await AgentTokenModel.updateOne({}, { $set: { revokedAt: new Date() } })
    const ip = freshIp()
    for (const token of [
      undefined,
      'not-a-token',
      `p4_${'A'.repeat(43)}`,
      revoked,
    ]) {
      const res = await mcpPost(
        agentRequest(MCP_URL, {
          token,
          ip,
          body: { jsonrpc: '2.0', id: 1, method: 'ping' },
        })
      )
      expect(res.status, String(token)).toBe(401)
      expect(res.headers.get('cache-control')).toBe('no-store, private')
      expect(res.headers.get('www-authenticate')).toContain('Bearer')
    }
  })

  it('a wbt_ token gets 401 from /api/mcp without being looked up', async () => {
    const token = await wbt()
    const findLegacy = vi.spyOn(WhiteboardTokenModel, 'findOne')
    const res = await mcpPost(
      agentRequest(MCP_URL, {
        token,
        ip: freshIp(),
        body: { jsonrpc: '2.0', id: 1, method: 'ping' },
      })
    )
    expect(res.status).toBe(401)
    expect(findLegacy).not.toHaveBeenCalled()
  })

  it('a token in the query string is ignored', async () => {
    const token = await p4()
    const res = await mcpPost(
      agentRequest(`${MCP_URL}?access_token=${token}`, {
        ip: freshIp(),
        body: { jsonrpc: '2.0', id: 1, method: 'ping' },
      })
    )
    expect(res.status).toBe(401)
  })

  it('REQUIRE_ADMIN=false and an owner cookie do not open it', async () => {
    process.env.REQUIRE_ADMIN = 'false'
    const res = await mcpPost(
      agentRequest(MCP_URL, {
        ip: freshIp(),
        headers: { cookie: 'p4-auth=anything' },
        body: { jsonrpc: '2.0', id: 1, method: 'ping' },
      })
    )
    expect(res.status).toBe(401)
  })

  it('a token-lookup DB error is 503, never a pass', async () => {
    const token = await p4()
    vi.spyOn(AgentTokenModel, 'findOne').mockImplementation(
      () =>
        ({
          lean: () => Promise.reject(new Error('connection reset')),
        }) as never
    )
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await mcpPost(
      agentRequest(MCP_URL, {
        token,
        ip: freshIp(),
        body: { jsonrpc: '2.0', id: 1, method: 'ping' },
      })
    )
    expect(res.status).toBe(503)
  })

  it('one front-door bucket for every agent route, spent before the token is checked', async () => {
    const token = await p4()
    const ip = freshIp()
    for (let i = 0; i < 120; i++) {
      const url = [MCP_URL, ALIAS_URL][i % 2]
      const handler = i % 2 ? aliasPost : mcpPost
      await handler(
        agentRequest(url, {
          token: `p4_guess${i}${'x'.repeat(16)}`,
          ip,
          body: { jsonrpc: '2.0', id: 1, method: 'ping' },
        })
      )
    }
    const lookup = vi.spyOn(AgentTokenModel, 'findOne')
    const res = await contextMd(
      agentRequest(MD_URL, { token, ip, method: 'GET' })
    )
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toMatch(/^\d+$/)
    expect(lookup).not.toHaveBeenCalled()
  })

  it('the first call touches lastUsedAt after the response', async () => {
    const token = await p4()
    const { rpc } = mcpClient(mcpPost, MCP_URL)
    await rpc(token, 'ping')
    expect((await AgentTokenModel.findOne({}).lean())?.lastUsedAt).toBeNull()
    await flushAfter()
    expect(
      (await AgentTokenModel.findOne({}).lean())?.lastUsedAt
    ).toBeInstanceOf(Date)
  })

  it('GET and DELETE are 405 without touching the database', async () => {
    for (const handler of [mcpGet, mcpDelete]) {
      const res = await handler()
      expect(res.status).toBe(405)
      expect(res.headers.get('allow')).toBe('POST')
    }
  })
})

describe('tokens: stored as a hash, scopes canonical', () => {
  it('p4_ + 43 base64url chars, shown once, only sha256 stored', async () => {
    const { token, record } = await tokenLib.createAgentToken('Laptop', [
      'write',
      'read',
      'read',
    ])
    expect(token).toMatch(/^p4_[A-Za-z0-9_-]{43}$/)
    expect(record.prefix).toBe(token.slice(0, 8))
    expect(record.scopes).toEqual(['read', 'write'])
    const stored = await AgentTokenModel.findOne({}).lean()
    expect(stored?.hash).toBe(tokenLib.hashToken(token))
    expect(JSON.stringify(stored)).not.toContain(token)
  })
})

describe('the whiteboard alias and context.md (premise 7, C5)', () => {
  it('a wbt_ token keeps the three old tools and context.md', async () => {
    const token = await wbt()
    const alias = mcpClient(aliasPost, ALIAS_URL)
    expect(await alias.toolNames(token)).toEqual([
      'get_item',
      'get_overview',
      'search_context',
    ])
    const { isError } = await alias.callTool(token, 'get_overview')
    expect(isError).toBe(false)
    const md = await contextMd(
      agentRequest(MD_URL, { token, ip: freshIp(), method: 'GET' })
    )
    expect(md.status).toBe(200)
  })

  it('a p4_ token with read works on the alias and on context.md', async () => {
    const token = await p4(['read'])
    const alias = mcpClient(aliasPost, ALIAS_URL)
    expect(await alias.toolNames(token)).toEqual([
      'get_item',
      'get_overview',
      'search_context',
    ])
    const md = await contextMd(
      agentRequest(MD_URL, { token, ip: freshIp(), method: 'GET' })
    )
    expect(md.status).toBe(200)
  })

  it('a p4_ token without read is refused on the alias (and audited) and gets 403 on context.md', async () => {
    const token = await p4(['write'])
    const alias = mcpClient(aliasPost, ALIAS_URL)
    const call = await alias.callTool(token, 'get_overview')
    expect(call.isError).toBe(true)
    expect(call.text).toContain('needs the read scope')
    await flushAfter()
    expect(
      await AgentActionModel.find(
        {},
        { tool: 1, outcome: 1, reason: 1, _id: 0 }
      ).lean()
    ).toEqual([{ tool: 'get_overview', outcome: 'refused', reason: 'scope' }])

    const md = await contextMd(
      agentRequest(MD_URL, { token, ip: freshIp(), method: 'GET' })
    )
    expect(md.status).toBe(403)
  })
})

describe('per-request registration (C1, C6)', () => {
  it("a read-only token's tools/list is exactly the registry's read tools", async () => {
    const token = await p4(['read'])
    const expected = serverLib.SITE_SERVER.tools
      .filter(({ def }) => def.scopes.includes('read'))
      .map(({ def }) => def.name)
      .sort()
    const { toolNames } = mcpClient(mcpPost, MCP_URL)
    expect(await toolNames(token)).toEqual(expected)
    expect(expected).toEqual(READ_TOOLS)
  })

  it('the registry is the 27 designed tools less the four the Assignment cut (D1)', () => {
    const names = serverLib.SITE_SERVER.tools.map(({ def }) => def.name)
    expect(names).toHaveLength(23)
    for (const cut of [
      'delete_post',
      'save_taxonomy',
      'get_test_metrics',
      'whiteboard_update_item',
      'generate_post',
    ])
      expect(names).not.toContain(cut)
    expect(serverLib.SITE_SERVER.prompts.map(({ def }) => def.name)).toEqual([
      'write-post',
      'weekly-briefing',
      'tailor-cv',
    ])
  })

  it('every listed tool carries its JSON Schema, built once at module load', async () => {
    const token = await p4(['read'])
    const { rpc } = mcpClient(mcpPost, MCP_URL)
    const first = await rpc(token, 'tools/list')
    const second = await rpc(token, 'tools/list')
    const schemaOf = (reply: typeof first, name: string) =>
      (
        reply.body.result?.tools as { name: string; inputSchema: unknown }[]
      ).find(tool => tool.name === name)?.inputSchema
    expect(schemaOf(first, 'get_profile')).toMatchObject({
      type: 'object',
      properties: { section: { enum: expect.arrayContaining(['resume']) } },
      required: ['section'],
    })
    // The same compiled object serves every request.
    const compiled = serverLib.SITE_SERVER.tools.find(
      ({ def }) => def.name === 'get_profile'
    )!.schema['~standard'] as unknown as {
      jsonSchema: { input: () => unknown }
    }
    expect(compiled.jsonSchema.input()).toBe(compiled.jsonSchema.input())
    expect(schemaOf(second, 'get_profile')).toEqual(
      schemaOf(first, 'get_profile')
    )
  })

  it('prompts are listed and rendered per token (C6)', async () => {
    const { compileTools, compilePrompts, handleMcpRequest } = serverLib
    const { defineTool, ok } = runToolLib
    const tool = (name: string, scope: Scope) =>
      defineTool({
        name,
        title: name,
        description: 'd',
        scopes: [scope],
        input: z.object({}),
        annotations: {},
        async run() {
          return ok(name)
        },
      })
    const spec = {
      name: 'test',
      version: '0',
      tools: compileTools([
        tool('see_thing', 'read'),
        tool('make_thing', 'write'),
      ]),
      prompts: compilePrompts([
        {
          name: 'do-it',
          title: 'Do it',
          description: 'd',
          scopes: ['read'],
          args: z.object({ topic: z.string() }),
          render: (args, tools) =>
            `topic=${args.topic}; ${tools.has('make_thing') ? 'then call make_thing' : 'you cannot make things'}`,
        },
      ]),
      instructions: () => '',
    }

    const readOnly = await contextOf(await p4(['read'], 'reader'))
    const writer = await contextOf(await p4(['read', 'write'], 'writer'))
    const noRead = await contextOf(await p4(['write'], 'blind'))

    const send = async (
      who: typeof readOnly,
      method: string,
      params?: unknown
    ) => {
      const res = await handleMcpRequest(
        agentRequest(MCP_URL, {
          ip: freshIp(),
          body: { jsonrpc: '2.0', id: 1, method, params },
        }),
        who,
        spec
      )
      return res.json()
    }

    expect(
      (await send(readOnly, 'prompts/list')).result.prompts.map(
        (p: { name: string }) => p.name
      )
    ).toEqual(['do-it'])
    expect((await send(noRead, 'prompts/list')).error.code).toBe(-32601)

    const get = (who: typeof readOnly) =>
      send(who, 'prompts/get', { name: 'do-it', arguments: { topic: 'x' } })
    expect((await get(readOnly)).result.messages[0].content.text).toBe(
      'topic=x; you cannot make things'
    )
    expect((await get(writer)).result.messages[0].content.text).toBe(
      'topic=x; then call make_thing'
    )
  })
})

describe('R1: calls outside the token', () => {
  it('a registry tool the token lacks: isError naming the scope, one refused row, nothing run', async () => {
    const token = await p4(['write'])
    const { callTool } = mcpClient(mcpPost, MCP_URL)
    const call = await callTool(token, 'get_profile', { section: 'identity' })
    expect(call.isError).toBe(true)
    expect(call.rpcError).toBeUndefined()
    expect(call.text).toContain('get_profile is not allowed for this token')
    expect(call.text).toContain('read scope')
    await flushAfter()
    const rows = await AgentActionModel.find({}).lean()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      tool: 'get_profile',
      outcome: 'refused',
      reason: 'scope',
      argsPreview: '{"section":"identity"}',
    })
  })

  it('an unknown name gets the SDK error and no row', async () => {
    const token = await p4(['read'])
    const { callTool } = mcpClient(mcpPost, MCP_URL)
    const call = await callTool(token, 'publish_everything')
    expect(call.isError).toBe(true)
    await flushAfter()
    expect(await AgentActionModel.countDocuments()).toBe(0)
  })

  it('a JSON-RPC batch is refused before the SDK, so it cannot carry an unaudited call', async () => {
    const token = await p4(['read'])
    const res = await mcpPost(
      agentRequest(MCP_URL, {
        token,
        ip: freshIp(),
        body: [
          {
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: { name: 'publish_post', arguments: { id: 'x' } },
          },
          { jsonrpc: '2.0', id: 2, method: 'tools/list' },
        ],
      })
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error?: { code: number } }
    expect(body.error?.code).toBe(-32600)
    expect(res.headers.get('cache-control')).toContain('no-store')
  })

  it('a mixed-case Content-Type does not skip the audit', async () => {
    const token = await p4(['write'])
    const res = await mcpPost(
      agentRequest(MCP_URL, {
        token,
        ip: freshIp(),
        body: {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'get_profile', arguments: { section: 'identity' } },
        },
        headers: { 'content-type': 'Application/JSON' },
      })
    )
    expect(res.status).toBe(200)
    await flushAfter()
    expect(
      await AgentActionModel.countDocuments({
        outcome: 'refused',
        reason: 'scope',
      })
    ).toBe(1)
  })
})

describe('runTool', () => {
  const counter = { runs: 0 }
  const makeKeyed = (cost: 'image' | null = null) =>
    runToolLib.defineTool({
      name: 'create_thing',
      title: 'Create',
      description: 'd',
      scopes: ['write'],
      input: z.object({
        title: z.string().min(1),
        delayMs: z.number().default(0),
      }),
      annotations: {},
      keyed: true,
      cost: cost
        ? () => [
            {
              route: 'blog-generate-image',
              limit: 2,
              windowSeconds: 600,
            },
          ]
        : undefined,
      async run({ title, delayMs }, ctx) {
        counter.runs += 1
        if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs))
        if (title === 'boom') throw new Error('kaboom')
        if (title === 'nope')
          return runToolLib.refuse('Not today.', 'live-post')
        ctx.setTarget({ kind: 'thing', id: `t-${counter.runs}` })
        return runToolLib.ok(`created ${title} #${counter.runs}`)
      },
    })

  const call = async (
    def: ReturnType<typeof makeKeyed>,
    args: unknown,
    token: Awaited<ReturnType<typeof contextOf>>
  ) => {
    const result = await runToolLib.runTool(def, args, token)
    return { text: result.content[0].text, isError: Boolean(result.isError) }
  }

  const rows = async () =>
    AgentActionModel.find(
      {},
      { _id: 0, tool: 1, outcome: 1, reason: 1, clientRef: 1 }
    )
      .sort({ at: 1, _id: 1 })
      .lean()

  it('rechecks the scope even when a registry bug lets the tool be called', async () => {
    counter.runs = 0
    const token = await contextOf(await p4(['read']))
    const result = await call(makeKeyed(), { title: 'x' }, token)
    expect(result.isError).toBe(true)
    expect(result.text).toContain('needs the write scope')
    expect(counter.runs).toBe(0)
    await flushAfter()
    expect(await rows()).toEqual([
      { tool: 'create_thing', outcome: 'refused', reason: 'scope' },
    ])
  })

  it('invalid arguments get a teaching message and a refused(invalid) row', async () => {
    const token = await contextOf(await p4(['write']))
    const result = await call(
      makeKeyed(),
      { title: '', delayMs: 'soon' },
      token
    )
    expect(result.isError).toBe(true)
    expect(result.text).toMatch(/Invalid arguments for create_thing/)
    expect(result.text).toMatch(/- title:/)
    expect(result.text).toMatch(/- delayMs:/)
    await flushAfter()
    expect(await rows()).toEqual([
      { tool: 'create_thing', outcome: 'refused', reason: 'invalid' },
    ])
  })

  it('one row per audited call, whatever the outcome: ok, refused, error', async () => {
    const token = await contextOf(await p4(['write']))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await call(makeKeyed(), { title: 'fine' }, token)
    await call(makeKeyed(), { title: 'nope' }, token)
    const boom = await call(makeKeyed(), { title: 'boom' }, token)
    expect(boom.text).toContain('failed unexpectedly')
    await flushAfter()
    expect(await rows()).toEqual([
      { tool: 'create_thing', outcome: 'ok', reason: null },
      { tool: 'create_thing', outcome: 'refused', reason: 'live-post' },
      { tool: 'create_thing', outcome: 'error', reason: 'exception' },
    ])
  })

  it('clientRef: a sequential retry replays the stored result and runs nothing', async () => {
    counter.runs = 0
    const token = await contextOf(await p4(['write']))
    const first = await call(
      makeKeyed(),
      { title: 'a', clientRef: 'r1' },
      token
    )
    const again = await call(
      makeKeyed(),
      { title: 'a', clientRef: 'r1' },
      token
    )
    expect(first).toEqual({ text: 'created a #1', isError: false })
    expect(again).toEqual(first)
    expect(counter.runs).toBe(1)
    await flushAfter()
    expect(await rows()).toEqual([
      { tool: 'create_thing', outcome: 'ok', reason: null, clientRef: 'r1' },
      { tool: 'create_thing', outcome: 'ok', reason: 'replay' },
    ])
    const keyed = await AgentActionModel.findOne({ clientRef: 'r1' }).lean()
    expect(keyed?.target).toEqual({ kind: 'thing', id: 't-1' })
  })

  it('clientRef: two concurrent calls run once; the other is told it is still running', async () => {
    counter.runs = 0
    const token = await contextOf(await p4(['write']))
    const [a, b] = await Promise.all([
      call(makeKeyed(), { title: 'c', delayMs: 150, clientRef: 'r2' }, token),
      call(makeKeyed(), { title: 'c', delayMs: 150, clientRef: 'r2' }, token),
    ])
    expect(counter.runs).toBe(1)
    const texts = [a, b].map(r => r.text).sort()
    expect(texts[0]).toBe(
      'A call with clientRef "r2" is still running. Retry shortly with the same clientRef to get its result.'
    )
    expect(texts[1]).toBe('created c #1')
    await flushAfter()
    const outcomes = (await rows())
      .map(row => `${row.outcome}:${row.reason}`)
      .sort()
    expect(outcomes).toEqual(['ok:null', 'refused:in-flight'])
  })

  it('clientRef: after a refusal or an error, a retry runs again, and the first call keeps its row', async () => {
    counter.runs = 0
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const token = await contextOf(await p4(['write']))
    // A refused call cannot be retried with DIFFERENT args under the same key...
    await call(makeKeyed(), { title: 'nope', clientRef: 'r3' }, token)
    const mismatch = await call(
      makeKeyed(),
      { title: 'yes', clientRef: 'r3' },
      token
    )
    expect(mismatch.text).toContain('already used with different arguments')
    // ...but the same call can: an error, then success.
    await call(makeKeyed(), { title: 'boom', clientRef: 'r4' }, token)
    const retried = await call(
      makeKeyed(),
      { title: 'boom', clientRef: 'r4' },
      token
    )
    expect(retried.text).toContain('failed unexpectedly')
    expect(counter.runs).toBe(3)
    await flushAfter()
    const r4 = (await rows()).filter(
      row => row.clientRef === 'r4' || row.reason === 'exception'
    )
    // One keyed row for the latest attempt, the earlier attempt kept without the key.
    expect(r4.map(row => row.clientRef ?? null).sort()).toEqual([null, 'r4'])
  })

  it('clientRef: a refused first call, then the same call succeeds on retry', async () => {
    counter.runs = 0
    const token = await contextOf(await p4(['write']))
    const refused = runToolLib.defineTool({
      name: 'flaky',
      title: 'Flaky',
      description: 'd',
      scopes: ['write'],
      input: z.object({}),
      annotations: {},
      keyed: true,
      async run() {
        counter.runs += 1
        return counter.runs === 1
          ? runToolLib.refuse('busy, try again', 'rate')
          : runToolLib.ok('done')
      },
    })
    const first = await call(refused as never, { clientRef: 'r5' }, token)
    const second = await call(refused as never, { clientRef: 'r5' }, token)
    const third = await call(refused as never, { clientRef: 'r5' }, token)
    expect([first.isError, second.text, third.text]).toEqual([
      true,
      'done',
      'done',
    ])
    expect(counter.runs).toBe(2)
  })

  it('clientRef: an ok row older than 24 h runs again instead of replaying', async () => {
    counter.runs = 0
    const token = await contextOf(await p4(['write']))
    await call(makeKeyed(), { title: 'a', clientRef: 'r6' }, token)
    await AgentActionModel.updateOne(
      { clientRef: 'r6' },
      { $set: { at: new Date(Date.now() - 25 * 60 * 60 * 1000) } }
    )
    const later = await call(
      makeKeyed(),
      { title: 'a', clientRef: 'r6' },
      token
    )
    expect(later).toEqual({ text: 'created a #2', isError: false })
    expect(counter.runs).toBe(2)
  })

  it('clientRef: a pending row abandoned by a killed call is taken over, and kept as an error', async () => {
    counter.runs = 0
    const token = await contextOf(await p4(['write']))
    await call(makeKeyed(), { title: 'a', clientRef: 'r7' }, token)
    // As a function killed mid-call leaves it: never finalized, 11 minutes old.
    await AgentActionModel.updateOne(
      { clientRef: 'r7' },
      {
        $set: {
          outcome: 'pending',
          at: new Date(Date.now() - 11 * 60 * 1000),
        },
      }
    )
    const retried = await call(
      makeKeyed(),
      { title: 'a', clientRef: 'r7' },
      token
    )
    expect(retried).toEqual({ text: 'created a #2', isError: false })
    await flushAfter()
    const outcomes = (await rows())
      .map(row => `${row.outcome}:${row.reason}:${row.clientRef ?? '-'}`)
      .sort()
    expect(outcomes).toEqual(['error:abandoned:-', 'ok:null:r7'])
  })

  it('clientRef: two concurrent retries of a failed call run it once', async () => {
    counter.runs = 0
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const token = await contextOf(await p4(['write']))
    const args = { title: 'boom', delayMs: 150, clientRef: 'r8' }
    await call(makeKeyed(), args, token)
    expect(counter.runs).toBe(1)
    const [a, b] = await Promise.all([
      call(makeKeyed(), args, token),
      call(makeKeyed(), args, token),
    ])
    expect(counter.runs).toBe(2)
    expect(
      [a.text, b.text].filter(text => text.includes('still running'))
    ).toHaveLength(1)
  })

  it('clientRef: the same key on a different tool is a mismatch, and runs nothing', async () => {
    counter.runs = 0
    const token = await contextOf(await p4(['write']))
    const other = runToolLib.defineTool({
      name: 'other_thing',
      title: 'Other',
      description: 'd',
      scopes: ['write'],
      input: z.object({ title: z.string().min(1) }),
      annotations: {},
      keyed: true,
      async run() {
        counter.runs += 1
        return runToolLib.ok('other')
      },
    })
    await call(makeKeyed(), { title: 'a', clientRef: 'r9' }, token)
    const reused = await call(
      other as never,
      { title: 'a', clientRef: 'r9' },
      token
    )
    expect(reused.isError).toBe(true)
    expect(reused.text).toContain('already used with different arguments')
    expect(counter.runs).toBe(1)
  })

  it('lazyCost: a call refused by its own cheap checks spends nothing; the paid step spends once', async () => {
    const token = await contextOf(await p4(['write']))
    const lazy = runToolLib.defineTool({
      name: 'lazy_thing',
      title: 'Lazy',
      description: 'd',
      scopes: ['write'],
      input: z.object({ ok: z.boolean() }),
      annotations: {},
      audited: true,
      cost: () => [{ route: 'lazy-cost', limit: 5, windowSeconds: 600 }],
      lazyCost: true,
      async run({ ok }, ctx) {
        if (!ok) return runToolLib.refuse('cheap refusal')
        const refused = await ctx.spend()
        if (refused) return refused
        await ctx.spend()
        return runToolLib.ok('paid')
      },
    })
    await call(lazy as never, { ok: false }, token)
    const spentAfterRefusal = await RateLimitModel.countDocuments({
      _id: { $regex: '^lazy-cost:' },
    })
    expect(spentAfterRefusal).toBe(0)
    await call(lazy as never, { ok: true }, token)
    const row = await RateLimitModel.findOne({
      _id: { $regex: '^lazy-cost:' },
    }).lean()
    expect((row as { count?: number } | null)?.count).toBe(1)
  })

  it('clientRef: a call whose claim was taken over does not overwrite the newer attempt', async () => {
    counter.runs = 0
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const token = await contextOf(await p4(['write']))
    const first = call(
      makeKeyed(),
      { title: 'slow', delayMs: 200, clientRef: 'r10' },
      token
    )
    await new Promise(resolve => setTimeout(resolve, 50))
    // A newer attempt now holds the row (as a takeover after 10 minutes would leave it).
    await AgentActionModel.updateOne(
      { clientRef: 'r10' },
      { $set: { at: new Date(Date.now() + 1_000) } }
    )
    await first
    const row = await AgentActionModel.findOne({ clientRef: 'r10' }).lean()
    expect(row?.outcome).toBe('pending')
  })

  it('per-token cost bucket: the token is refused at its limit while the editor IP bucket is untouched (R5)', async () => {
    const token = await contextOf(await p4(['write']))
    const def = makeKeyed('image')
    await call(def, { title: 'a' }, token)
    await call(def, { title: 'b' }, token)
    const over = await call(def, { title: 'c' }, token)
    expect(over.isError).toBe(true)
    expect(over.text).toMatch(
      /Rate limit: this token has used its blog-generate-image budget/
    )
    await flushAfter()
    expect((await rows()).at(-1)).toMatchObject({
      outcome: 'refused',
      reason: 'rate',
    })

    const { checkRateLimit, BLOG_GENERATE_IMAGE_LIMIT } =
      await import('@/lib/rate-limit')
    expect(
      (await checkRateLimit('203.0.113.9', BLOG_GENERATE_IMAGE_LIMIT)).ok
    ).toBe(true)
    const keys = (await RateLimitModel.find({}).lean()).map(row =>
      String(row._id)
    )
    expect(
      keys.some(key =>
        key.startsWith(`blog-generate-image:mcp-token:${token.tokenId}:`)
      )
    ).toBe(true)
  })

  it('argsPreview is bounded, long strings become lengths, emails are masked', () => {
    const preview = runToolLib.previewArgs({
      bodyMarkdown: 'x'.repeat(5_000),
      note: 'mail ada@example.com please',
      many: Array.from({ length: 400 }, (_, i) => `item-${i}`),
    })
    expect(preview).toContain('"bodyMarkdown":"[5000 chars]"')
    expect(preview).toContain('mail [email] please')
    expect(preview).not.toContain('ada@example.com')
    expect(Buffer.byteLength(preview)).toBeLessThanOrEqual(2048)
    // Keys too: a refusal previews raw, unparsed arguments.
    expect(runToolLib.previewArgs({ 'ada@example.com': 1 })).toBe(
      '{"[email]":1}'
    )
    // Deep nesting is a marker, not a stack overflow outside the call's try.
    let deep: unknown = 'bottom'
    for (let i = 0; i < 20_000; i += 1) deep = { a: deep }
    expect(runToolLib.previewArgs(deep)).toContain('[nested]')
  })

  it('isTokenLive: true for an active token, false once revoked', async () => {
    const token = await contextOf(await p4(['write']))
    expect(await tokenLib.isTokenLive(token)).toBe(true)
    await AgentTokenModel.updateOne(
      { _id: token.tokenId },
      { $set: { revokedAt: new Date() } }
    )
    expect(await tokenLib.isTokenLive(token)).toBe(false)
  })

  it('the budget net cuts with an explicit marker and a warning (C10)', async () => {
    const { clipToBudget, MCP_BUDGET_CHARS } = await import('@/lib/mcp/budget')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const clipped = clipToBudget('y'.repeat(MCP_BUDGET_CHARS + 500), 'big_tool')
    expect(clipped.length).toBeLessThanOrEqual(MCP_BUDGET_CHARS)
    expect(clipped).toMatch(/\[truncated: \d+ chars dropped\]$/)
    expect(warn).toHaveBeenCalled()
    expect(clipToBudget('short', 'small_tool')).toBe('short')
  })
})

describe('get_profile (C3)', () => {
  const RESUME = {
    name: 'Ada',
    role: 'Engineer',
    contact: {
      email: 'owner@example.com',
      phone: '1',
      location: 'Hanoi',
      links: [],
    },
  }

  it('returns one section whole, with a version that changes only when the section does', async () => {
    await ProfileModel.create({
      _id: 'mcp-core-profile',
      fullName: 'Ada',
      jobTitle: ['Engineer'],
      aboutMe: 'Hello',
      resume: RESUME,
    })
    const token = await p4(['read'])
    const { callTool } = mcpClient(mcpPost, MCP_URL)

    const identity = JSON.parse(
      (await callTool(token, 'get_profile', { section: 'identity' })).text
    )
    expect(identity.section).toBe('identity')
    expect(Object.keys(identity.value).sort()).toEqual([
      'avatar',
      'backgroundImage',
      'description',
      'fullName',
      'jobTitle',
      'publicLocation',
      'socials',
      'username',
    ])
    expect(identity.value.fullName).toBe('Ada')
    expect(identity.version).toMatch(/^[0-9a-f]{16}$/)

    await ProfileModel.updateOne(
      { _id: 'mcp-core-profile' },
      { $set: { aboutMe: 'Changed' } }
    )
    const again = JSON.parse(
      (await callTool(token, 'get_profile', { section: 'identity' })).text
    )
    expect(again.version).toBe(identity.version)

    await ProfileModel.updateOne(
      { _id: 'mcp-core-profile' },
      { $set: { fullName: 'Ada L.' } }
    )
    const changed = JSON.parse(
      (await callTool(token, 'get_profile', { section: 'identity' })).text
    )
    expect(changed.version).not.toBe(identity.version)
  })

  it("the resume section carries the owner's own contact details (premise 5)", async () => {
    await ProfileModel.create({ _id: 'mcp-core-profile', resume: RESUME })
    const token = await p4(['read'])
    const { callTool } = mcpClient(mcpPost, MCP_URL)
    const { text } = await callTool(token, 'get_profile', { section: 'resume' })
    expect(JSON.parse(text).value.resume.contact.email).toBe(
      'owner@example.com'
    )
  })

  it('an unknown section is a teaching error listing the valid ones', async () => {
    const token = await p4(['read'])
    const { callTool } = mcpClient(mcpPost, MCP_URL)
    const call = await callTool(token, 'get_profile', { section: 'salary' })
    expect(call.isError).toBe(true)
    expect(call.text).toContain('section')
    expect(call.text).toContain('resume')
  })

  it('a large seeded section stays inside the budget, without the net firing', async () => {
    const warn = vi.spyOn(console, 'warn')
    await ProfileModel.create({
      _id: 'mcp-core-profile',
      projects: Array.from({ length: 12 }, (_, i) => ({
        title: `Project ${i}`,
        overview: 'o'.repeat(800),
        techStack: ['Next.js', 'MongoDB', 'TypeScript'],
        parts: Array.from({ length: 3 }, () => ({
          image: 'https://res.cloudinary.com/x/image/upload/v1/p.png',
          description: 'd'.repeat(300),
          link: 'https://example.com',
        })),
      })),
    })
    const token = await p4(['read'])
    const { callTool } = mcpClient(mcpPost, MCP_URL)
    const { text } = await callTool(token, 'get_profile', { section: 'work' })
    expect(text).not.toContain('[truncated:')
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('budget net'))
  })
})

describe('whiteboard tools on /api/mcp', () => {
  it('read through loadAgentVisible under their site names', async () => {
    const { createItem } = await import('@/lib/whiteboard/data')
    const { validateItem } = await import('@/lib/whiteboard/limits')
    for (const fields of [
      { title: 'Visible goal', meaning: 'goal', status: 'active' },
      { title: 'Hidden goal', meaning: 'goal', includeInAi: false },
    ]) {
      const checked = validateItem({
        _id: new mongoose.Types.ObjectId().toHexString(),
        form: 'text',
        ...fields,
      })
      if (!checked.ok) throw new Error(checked.error)
      await createItem(BOARD, checked.value)
    }
    const token = await p4(['read'])
    const { callTool } = mcpClient(mcpPost, MCP_URL)
    const overview = await callTool(token, 'whiteboard_overview')
    expect(overview.text).toContain('Visible goal')
    expect(overview.text).not.toContain('Hidden goal')
    expect(overview.text).toContain('whiteboard_search')

    const empty = await callTool(token, 'whiteboard_search', {})
    expect(empty).toMatchObject({
      isError: true,
      text: 'Give a query or at least one filter. For a summary of the board, call whiteboard_overview.',
    })
  })
})
