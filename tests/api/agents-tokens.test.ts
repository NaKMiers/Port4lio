import { MongoMemoryServer } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import { NextRequest } from 'next/server'
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import { getAuthCookieName, makeAuthToken } from '@/lib/auth'
import { AgentActionModel, agentActionExpiryFrom } from '@/models/AgentAction'
import { AgentTokenModel } from '@/models/AgentToken'
import { RateLimitModel } from '@/models/RateLimit'
import { WhiteboardTokenModel } from '@/models/WhiteboardToken'

import { agentRequest, freshIp, type RouteHandler } from './mcp-helpers'

/**
 * `GET/POST /api/admin/agents/tokens` and `DELETE /api/admin/agents/tokens/<id>`, the owner
 * side of `/admin/agents` (mcp-plan.md T3).
 *
 * ```
 *   every verb ──▶ requireOwner (401 without the cookie)
 *   POST  one-line name, 1+ known scopes ──▶ p4_ plaintext ONCE, only sha256 stored
 *   GET   { tokens, legacy, actions }     never a hash, never a plaintext, never resultPreview
 *   DELETE p4_ or legacy wbt_             ──▶ revoked, and the token 401s from the next call
 *   DELETE ?forever=1, revoked only       ──▶ record gone; an active token is a 409
 *   PATCH { scopes }, unrevoked p4_ only  ──▶ the next call sees the new tools
 * ```
 */

vi.hoisted(() => {
  process.env.PROFILE_DOCUMENT_ID = 'agents-tokens-profile'
})

vi.mock('next/server', async importOriginal => {
  const actual = await importOriginal<typeof import('next/server')>()
  return { ...actual, after: () => {} }
})

const URL = 'http://localhost/api/admin/agents/tokens'
let memory: MongoMemoryServer
let list: RouteHandler
let create: RouteHandler
type IdHandler = (
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) => Promise<Response>
let revoke: IdHandler
let patch: IdHandler
let mcpPost: RouteHandler
let createLegacy: typeof import('@/lib/whiteboard/token').createToken
let hashToken: typeof import('@/lib/mcp/token').hashToken

beforeAll(async () => {
  memory = await MongoMemoryServer.create()
  process.env.MONGODB_URI = memory.getUri()
  process.env.AUTH_SECRET = 'agents-tokens-secret'
  delete process.env.REQUIRE_ADMIN
  await mongoose.connect(memory.getUri())
  await AgentTokenModel.syncIndexes()
  const route = await import('@/app/api/admin/agents/tokens/route')
  list = route.GET as RouteHandler
  create = route.POST as RouteHandler
  const idRoute = await import('@/app/api/admin/agents/tokens/[id]/route')
  revoke = idRoute.DELETE as IdHandler
  patch = idRoute.PATCH as IdHandler
  mcpPost = (await import('@/app/api/mcp/route')).POST as RouteHandler
  ;({ createToken: createLegacy } = await import('@/lib/whiteboard/token'))
  ;({ hashToken } = await import('@/lib/mcp/token'))
}, 120_000)

afterAll(async () => {
  await mongoose.disconnect()
  await memory.stop()
})

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all([
    AgentTokenModel.deleteMany({}),
    AgentActionModel.deleteMany({}),
    WhiteboardTokenModel.deleteMany({}),
    RateLimitModel.deleteMany({}),
  ])
})

const ownerCookie = () =>
  `${getAuthCookieName()}=${makeAuthToken(Date.now() + 3_600_000)}`

function owner(method: string, body?: unknown, url = URL) {
  return new NextRequest(url, {
    method,
    headers: {
      cookie: ownerCookie(),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

const revokeId = (id: string) =>
  revoke(owner('DELETE', undefined, `${URL}/${id}`), {
    params: Promise.resolve({ id }),
  })

const deleteForever = (id: string) =>
  revoke(owner('DELETE', undefined, `${URL}/${id}?forever=1`), {
    params: Promise.resolve({ id }),
  })

const patchScopes = (id: string, body: unknown) =>
  patch(owner('PATCH', body, `${URL}/${id}`), {
    params: Promise.resolve({ id }),
  })

async function toolNames(token: string) {
  const res = await mcpPost(
    agentRequest('http://localhost/api/mcp', {
      token,
      ip: freshIp(),
      body: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    })
  )
  const body = await res.json()
  return (body.result.tools as { name: string }[]).map(tool => tool.name)
}

async function ping(token: string) {
  const res = await mcpPost(
    agentRequest('http://localhost/api/mcp', {
      token,
      ip: freshIp(),
      body: { jsonrpc: '2.0', id: 1, method: 'ping' },
    })
  )
  return res.status
}

describe('the owner gate', () => {
  it('every verb is 401 without the owner cookie, and no-store', async () => {
    const anon = (method: string) => new NextRequest(URL, { method })
    for (const res of [
      await list(anon('GET')),
      await create(anon('POST')),
      await revoke(anon('DELETE'), {
        params: Promise.resolve({
          id: new mongoose.Types.ObjectId().toHexString(),
        }),
      }),
      await patch(anon('PATCH'), {
        params: Promise.resolve({
          id: new mongoose.Types.ObjectId().toHexString(),
        }),
      }),
    ]) {
      expect(res.status).toBe(401)
      expect(res.headers.get('cache-control')).toBe('no-store, private')
    }
  })
})

describe('create', () => {
  it('returns the plaintext once with the scopes asked for; only the hash is stored', async () => {
    const res = await create(
      owner('POST', { name: 'Laptop', scopes: ['publish', 'read'] })
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store, private')
    const { token, record } = await res.json()
    expect(token).toMatch(/^p4_[A-Za-z0-9_-]{43}$/)
    expect(record).toMatchObject({
      name: 'Laptop',
      prefix: token.slice(0, 8),
      scopes: ['read', 'publish'],
      lastUsedAt: null,
      revokedAt: null,
    })
    const stored = await AgentTokenModel.findOne({}).lean()
    expect(stored?.hash).toBe(hashToken(token))
    expect(JSON.stringify(stored)).not.toContain(token)
    expect(await ping(token)).toBe(200)
  })

  it('refuses a bad name or a bad scope list', async () => {
    for (const body of [
      { name: '', scopes: ['read'] },
      { name: 'a\nb', scopes: ['read'] },
      { name: 'x'.repeat(81), scopes: ['read'] },
      { name: 'ok', scopes: [] },
      { name: 'ok', scopes: ['read', 'admin'] },
      { name: 'ok', scopes: ['whiteboard:legacy'] },
      { name: 'ok' },
    ]) {
      const res = await create(owner('POST', body))
      expect(res.status, JSON.stringify(body)).toBe(400)
    }
    expect(await AgentTokenModel.countDocuments()).toBe(0)
  })

  it('400 for malformed JSON', async () => {
    const res = await create(
      new NextRequest(URL, {
        method: 'POST',
        headers: { cookie: ownerCookie(), 'content-type': 'application/json' },
        body: '{"name":',
      })
    )
    expect(res.status).toBe(400)
  })
})

describe('list', () => {
  it('tokens, legacy tokens and the feed; never a hash, a plaintext or a replay result', async () => {
    const { token } = await (
      await create(owner('POST', { name: 'New', scopes: ['read'] }))
    ).json()
    const legacy = await createLegacy('Old laptop')
    const tokenDoc = await AgentTokenModel.findOne({}).lean()
    const now = new Date()
    await AgentActionModel.create({
      tokenId: tokenDoc!._id,
      tokenName: 'New',
      tool: 'create_draft',
      clientRef: 'r1',
      outcome: 'ok',
      reason: null,
      target: { kind: 'post', id: 'p1', slug: 'hello' },
      argsPreview: '{"title":"Hello"}',
      resultPreview: 'SECRET FULL DRAFT BODY',
      at: now,
      expireAt: agentActionExpiryFrom(now),
    })

    const res = await list(owner('GET'))
    expect(res.status).toBe(200)
    const text = await res.text()
    for (const secret of [
      token,
      legacy.token,
      tokenDoc!.hash,
      'SECRET FULL DRAFT BODY',
    ])
      expect(text).not.toContain(secret)

    const body = JSON.parse(text)
    expect(body.tokens.map((t: { name: string }) => t.name)).toEqual(['New'])
    expect(body.legacy.map((t: { name: string }) => t.name)).toEqual([
      'Old laptop',
    ])
    expect(body.actions).toEqual([
      {
        id: expect.any(String),
        tokenName: 'New',
        tool: 'create_draft',
        outcome: 'ok',
        reason: null,
        target: { kind: 'post', id: 'p1', slug: 'hello' },
        argsPreview: '{"title":"Hello"}',
        at: now.toISOString(),
      },
    ])
  })
})

describe('revoke', () => {
  it('a p4_ token: kept in the list, greyed out, and 401 from the next call', async () => {
    const { token, record } = await (
      await create(owner('POST', { name: 'Laptop', scopes: ['read'] }))
    ).json()
    const res = await revokeId(record.id)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.kind).toBe('agent')
    expect(body.record.revokedAt).not.toBeNull()
    expect(await AgentTokenModel.countDocuments()).toBe(1)
    expect(await ping(token)).toBe(401)
    // Revoking again is still a success.
    expect((await revokeId(record.id)).status).toBe(200)
  })

  it('a legacy wbt_ token: revoked through the same route', async () => {
    const { record } = await createLegacy('Old laptop')
    const res = await revokeId(record.id)
    expect(res.status).toBe(200)
    expect((await res.json()).kind).toBe('legacy')
    expect(
      (await WhiteboardTokenModel.findById(record.id).lean())?.revokedAt
    ).toBeInstanceOf(Date)
  })

  it('unknown and malformed ids are 404', async () => {
    expect(
      (await revokeId(new mongoose.Types.ObjectId().toHexString())).status
    ).toBe(404)
    expect((await revokeId('nope')).status).toBe(404)
  })
})

describe('delete forever', () => {
  it('an active p4_ token is a 409 and keeps working; once revoked it is gone', async () => {
    const { token, record } = await (
      await create(owner('POST', { name: 'Laptop', scopes: ['read'] }))
    ).json()

    const refused = await deleteForever(record.id)
    expect(refused.status).toBe(409)
    expect(await AgentTokenModel.countDocuments()).toBe(1)
    expect(await ping(token)).toBe(200)

    await revokeId(record.id)
    const res = await deleteForever(record.id)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ deleted: true, kind: 'agent' })
    expect(await AgentTokenModel.countDocuments()).toBe(0)
    expect(await ping(token)).toBe(401)
    // Gone means gone: a second delete is a 404, not a success.
    expect((await deleteForever(record.id)).status).toBe(404)
  })

  it('the Activity feed still names a deleted token', async () => {
    const { record } = await (
      await create(owner('POST', { name: 'Old laptop', scopes: ['read'] }))
    ).json()
    const now = new Date()
    await AgentActionModel.create({
      tokenId: record.id,
      tokenName: 'Old laptop',
      tool: 'create_draft',
      clientRef: 'r-deleted',
      outcome: 'ok',
      reason: null,
      target: null,
      argsPreview: '{}',
      at: now,
      expireAt: agentActionExpiryFrom(now),
    })
    await revokeId(record.id)
    await deleteForever(record.id)

    const body = await (await list(owner('GET'))).json()
    expect(body.tokens).toEqual([])
    expect(body.actions.map((a: { tokenName: string }) => a.tokenName)).toEqual(
      ['Old laptop']
    )
  })

  it('a legacy wbt_ token: 409 while active, deleted once revoked', async () => {
    const { record } = await createLegacy('Old laptop')
    expect((await deleteForever(record.id)).status).toBe(409)
    await revokeId(record.id)
    const res = await deleteForever(record.id)
    expect(res.status).toBe(200)
    expect((await res.json()).kind).toBe('legacy')
    expect(await WhiteboardTokenModel.countDocuments()).toBe(0)
  })

  it('unknown and malformed ids are 404', async () => {
    expect(
      (await deleteForever(new mongoose.Types.ObjectId().toHexString())).status
    ).toBe(404)
    expect((await deleteForever('nope')).status).toBe(404)
  })
})

describe('change scopes', () => {
  it('the same token gets the new tools from its next call, in canonical order', async () => {
    const { token, record } = await (
      await create(owner('POST', { name: 'Laptop', scopes: ['read'] }))
    ).json()
    expect(await toolNames(token)).not.toContain('create_draft')

    const res = await patchScopes(record.id, {
      scopes: ['write', 'read', 'write'],
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store, private')
    const body = await res.json()
    expect(body.record).toMatchObject({
      id: record.id,
      scopes: ['read', 'write'],
    })
    expect(JSON.stringify(body)).not.toContain(token)
    expect(await toolNames(token)).toContain('create_draft')

    // Narrowing works the same way.
    await patchScopes(record.id, { scopes: ['write'] })
    expect(await toolNames(token)).not.toContain('get_post')
  })

  it('refuses an empty, unknown or legacy scope list and changes nothing', async () => {
    const { record } = await (
      await create(owner('POST', { name: 'Laptop', scopes: ['read'] }))
    ).json()
    for (const body of [
      { scopes: [] },
      { scopes: ['admin'] },
      { scopes: ['whiteboard:legacy'] },
      {},
    ]) {
      const res = await patchScopes(record.id, body)
      expect(res.status, JSON.stringify(body)).toBe(400)
    }
    expect((await AgentTokenModel.findById(record.id).lean())?.scopes).toEqual([
      'read',
    ])
  })

  it('a revoked token is a 409 and stays revoked with its old scopes', async () => {
    const { token, record } = await (
      await create(owner('POST', { name: 'Laptop', scopes: ['read'] }))
    ).json()
    await revokeId(record.id)
    const res = await patchScopes(record.id, { scopes: ['read', 'publish'] })
    expect(res.status).toBe(409)
    const stored = await AgentTokenModel.findById(record.id).lean()
    expect(stored?.scopes).toEqual(['read'])
    expect(stored?.revokedAt).toBeInstanceOf(Date)
    expect(await ping(token)).toBe(401)
  })

  it('a legacy wbt_ token, an unknown id and a malformed id are 404', async () => {
    const { record } = await createLegacy('Old laptop')
    for (const id of [
      record.id,
      new mongoose.Types.ObjectId().toHexString(),
      'nope',
    ])
      expect((await patchScopes(id, { scopes: ['read'] })).status, id).toBe(404)
  })
})
