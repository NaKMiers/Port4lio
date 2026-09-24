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

import { AgentActionModel } from '@/models/AgentAction'
import { AgentTokenModel } from '@/models/AgentToken'
import { CcafProgressModel } from '@/models/CcafProgress'
import { KindModel } from '@/models/Kind'
import { PostModel } from '@/models/Post'
import { RateLimitModel } from '@/models/RateLimit'
import { SeriesModel } from '@/models/Series'

import { mcpClient, type RouteHandler } from './mcp-helpers'

/**
 * Scenes 3 and 4 through `/api/mcp` (phase 4, mcp-plan.md T8; C8, C11, R6, R8).
 *
 * ```
 *   update_profile   whole section + version · stale version refused · resume refused, unchanged
 *                    · revalidateTag(PUBLIC_PROFILE_CACHE_TAG, { expire: 0 }) inside the service
 *   get_me / resume  never written ──▶ the seed /cv prints, not null
 *   archive_post     archive a live post (revalidates) · unarchive: never public ──▶ draft,
 *                    once public ──▶ refused, pointing at publish_post (C11)
 *   ccaf             status ids · log a mock of 42 correct, once per clientRef · confidence
 *   tailor-cv        markdown only; tells the agent never to call update_profile (R8)
 *   taxonomy-service a relabel revalidates /blog; the delete guards hold (C8)
 * ```
 */

vi.hoisted(() => {
  process.env.PROFILE_DOCUMENT_ID = 'mcp-operator-profile'
})

const deferred: (() => unknown)[] = []
vi.mock('next/server', async importOriginal => {
  const actual = await importOriginal<typeof import('next/server')>()
  return { ...actual, after: (fn: () => unknown) => deferred.push(fn) }
})
const flushAfter = async () => {
  while (deferred.length) await deferred.shift()!()
}

const cache = vi.hoisted(() => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
}))
vi.mock('next/cache', () => ({
  revalidateTag: cache.revalidateTag,
  revalidatePath: cache.revalidatePath,
  unstable_cache: <T>(fn: T) => fn,
}))
vi.mock('@/lib/blog/markdown', async () => {
  const actual = await vi.importActual<typeof import('@/lib/blog/markdown')>(
    '@/lib/blog/markdown'
  )
  return {
    ...actual,
    renderMarkdown: vi.fn(async (markdown: string) => `<p>${markdown}</p>`),
  }
})

const DOC_ID = 'mcp-operator-profile'
const CLOUD = 'https://res.cloudinary.com/test-cloud/image/upload/v1/c.png'

let memory: MongoMemoryServer
let client: ReturnType<typeof mcpClient>
let tokenLib: typeof import('@/lib/mcp/token')
let ProfileModel: typeof import('@/models/Profile').ProfileModel

beforeAll(async () => {
  memory = await MongoMemoryServer.create()
  process.env.MONGODB_URI = memory.getUri()
  process.env.AUTH_SECRET = 'mcp-operator-secret'
  process.env.CLOUDINARY_CLOUD_NAME = 'test-cloud'
  delete process.env.REQUIRE_ADMIN
  await mongoose.connect(memory.getUri())
  await Promise.all([
    AgentTokenModel.syncIndexes(),
    AgentActionModel.syncIndexes(),
  ])
  const route = await import('@/app/api/mcp/route')
  client = mcpClient(route.POST as RouteHandler, 'http://localhost/api/mcp')
  tokenLib = await import('@/lib/mcp/token')
  ;({ ProfileModel } = await import('@/models/Profile'))
}, 120_000)

afterAll(async () => {
  await mongoose.disconnect()
  await memory.stop()
})

afterEach(async () => {
  deferred.length = 0
  vi.clearAllMocks()
  await Promise.all([
    AgentTokenModel.deleteMany({}),
    AgentActionModel.deleteMany({}),
    CcafProgressModel.deleteMany({}),
    KindModel.deleteMany({}),
    PostModel.deleteMany({}),
    ProfileModel.deleteMany({}),
    RateLimitModel.deleteMany({}),
    SeriesModel.deleteMany({}),
  ])
})

type Scope = 'read' | 'write' | 'publish' | 'pii'
const token = async (scopes: Scope[]) =>
  (await tokenLib.createAgentToken('agent', scopes)).token
const parse = (text: string) => JSON.parse(text)

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

describe('update_profile (R6, R8)', () => {
  async function seedProfile() {
    await ProfileModel.create({
      _id: DOC_ID,
      fullName: 'Ada',
      profileHeading: 'Builidng things that ship',
      profileSubHeading: 'Sub',
      aboutMe: 'Hello',
      resume: RESUME,
    })
  }

  it('fixes the headline typo: the section is replaced whole, the rest is untouched, the cache is revalidated', async () => {
    await seedProfile()
    const t = await token(['read', 'publish'])
    const read = parse(
      (await client.callTool(t, 'get_profile', { section: 'about' })).text
    )
    const value = { ...read.value, profileHeading: 'Building things that ship' }

    const call = await client.callTool(t, 'update_profile', {
      section: 'about',
      version: read.version,
      value,
    })
    expect(call.isError, call.text).toBe(false)
    const saved = parse(call.text)
    expect(saved.version).not.toBe(read.version)

    const doc = await ProfileModel.findById(DOC_ID).lean()
    expect(doc).toMatchObject({
      profileHeading: 'Building things that ship',
      profileSubHeading: 'Sub',
      aboutMe: 'Hello',
      fullName: 'Ada',
    })
    // Expired, not marked stale: the next load of `/` must show the fix (acceptance ask 6).
    expect(cache.revalidateTag).toHaveBeenCalledWith('public-profile', {
      expire: 0,
    })
    await flushAfter()
    expect(
      await AgentActionModel.find({}, { tool: 1, outcome: 1, _id: 0 }).lean()
    ).toEqual([{ tool: 'update_profile', outcome: 'ok' }])
  })

  it('a stale version is refused and nothing changes', async () => {
    await seedProfile()
    const t = await token(['read', 'publish'])
    const read = parse(
      (await client.callTool(t, 'get_profile', { section: 'about' })).text
    )
    // The owner saves the section in /admin/settings meanwhile.
    await ProfileModel.updateOne(
      { _id: DOC_ID },
      { $set: { aboutMe: 'Owner edit' } }
    )

    const call = await client.callTool(t, 'update_profile', {
      section: 'about',
      version: read.version,
      value: { ...read.value, profileHeading: 'Agent edit' },
    })
    expect(call.isError).toBe(true)
    expect(call.text).toMatch(/changed since you read it/)
    expect((await ProfileModel.findById(DOC_ID).lean())?.profileHeading).toBe(
      'Builidng things that ship'
    )
    expect(cache.revalidateTag).not.toHaveBeenCalled()
  })

  it('a resume write is refused and nothing changes (R8)', async () => {
    await seedProfile()
    const t = await token(['read', 'publish'])
    const read = parse(
      (await client.callTool(t, 'get_profile', { section: 'resume' })).text
    )
    const call = await client.callTool(t, 'update_profile', {
      section: 'resume',
      version: read.version,
      value: { resume: { ...RESUME, role: 'Tailored role' } },
    })
    expect(call.isError).toBe(true)
    expect(call.text).toMatch(/\/admin\/settings/)
    expect((await ProfileModel.findById(DOC_ID).lean())?.resume?.role).toBe(
      'Engineer'
    )
    await flushAfter()
    expect(
      await AgentActionModel.find({}, { outcome: 1, reason: 1, _id: 0 }).lean()
    ).toEqual([{ outcome: 'refused', reason: 'resume' }])
  })

  it('a partial section is refused, naming what is missing', async () => {
    await seedProfile()
    const t = await token(['read', 'publish'])
    const read = parse(
      (await client.callTool(t, 'get_profile', { section: 'about' })).text
    )
    const call = await client.callTool(t, 'update_profile', {
      section: 'about',
      version: read.version,
      value: { profileHeading: 'Only this' },
    })
    expect(call.isError).toBe(true)
    expect(call.text).toMatch(/Missing: profileSubHeading, stats, aboutMe/)
  })

  it('needs publish: a read + write token does not list it', async () => {
    expect(
      await client.toolNames(await token(['read', 'write']))
    ).not.toContain('update_profile')
  })
})

describe('archive_post (C11)', () => {
  async function post(overrides: Record<string, unknown>) {
    return PostModel.create({
      slug: 'a-post',
      title: 'A post',
      kind: 'article',
      bodyMarkdown: 'Body.',
      coverImage: CLOUD,
      ...overrides,
    })
  }

  it('archives a live post and revalidates its path', async () => {
    const live = await post({ status: 'published', publishedAt: new Date() })
    const t = await token(['read', 'publish'])
    const call = await client.callTool(t, 'archive_post', {
      id: String(live._id),
      action: 'archive',
    })
    expect(parse(call.text)).toMatchObject({
      status: 'archived',
      slug: 'a-post',
    })
    expect((await PostModel.findById(live._id))?.status).toBe('archived')
    expect(cache.revalidatePath).toHaveBeenCalledWith('/blog/a-post')
  })

  it('unarchives a never-published post to draft', async () => {
    const generated = await post({ status: 'archived', publishedAt: null })
    const t = await token(['read', 'publish'])
    const call = await client.callTool(t, 'archive_post', {
      id: String(generated._id),
      action: 'unarchive',
    })
    expect(parse(call.text)).toMatchObject({ status: 'draft' })
  })

  it('refuses to unarchive a once-public post, pointing at publish_post', async () => {
    const once = await post({
      status: 'archived',
      publishedAt: new Date('2025-01-01'),
    })
    const t = await token(['read', 'publish'])
    const call = await client.callTool(t, 'archive_post', {
      id: String(once._id),
      action: 'unarchive',
    })
    expect(call.isError).toBe(true)
    expect(call.text).toMatch(/Publish it again to make it live/)
    expect(call.text).toMatch(/publish_post/)
    expect((await PostModel.findById(once._id))?.status).toBe('archived')
  })
})

describe('CCA-F', () => {
  it('logs a mock by correct answers, once per clientRef, and reports readiness', async () => {
    const t = await token(['read', 'write'])
    const status = parse((await client.callTool(t, 'ccaf_status')).text)
    expect(status.progress.total).toBeGreaterThan(0)
    expect(status.nextTasks[0].id).toMatch(/^w\d+-\d+-\d+$/)
    expect(status.latestMock).toBeNull()

    const args = {
      logMock: { correct: 42, label: 'Mock 3' },
      confidence: [{ domain: 1, level: 4 }],
      tickTasks: [status.nextTasks[0].id],
      clientRef: 'mock-3',
    }
    const logged = await client.callTool(t, 'ccaf_update', args)
    expect(logged.isError, logged.text).toBe(false)
    const result = parse(logged.text)
    expect(result.loggedMock).toMatchObject({ correct: 42, label: 'Mock 3' })
    expect(result.status.latestMock).toMatchObject({
      correct: 42,
      outOf: 60,
      estimatedScaledScore: 730,
      passes: true,
    })
    expect(result.status.readinessPercent).not.toBeNull()
    expect(result.status.progress.done).toBe(1)

    // A retry after a timeout does not log the mock twice.
    await client.callTool(t, 'ccaf_update', args)
    expect(
      (await CcafProgressModel.findById('ccaf-progress').lean())?.mocks
    ).toHaveLength(1)
  })

  it('refuses unknown ids and a scaled score passed as correct, writing nothing', async () => {
    const t = await token(['read', 'write'])
    const unknown = await client.callTool(t, 'ccaf_update', {
      tickTasks: ['w9-9-9'],
    })
    expect(unknown.isError).toBe(true)
    expect(unknown.text).toMatch(/Unknown task ids: w9-9-9/)

    const scaled = await client.callTool(t, 'ccaf_update', {
      logMock: { correct: 720 },
    })
    expect(scaled.isError).toBe(true)
    expect(scaled.text).toMatch(/logMock\.correct/)
    expect(await CcafProgressModel.countDocuments()).toBe(0)
  })
})

describe('the CV an agent reads', () => {
  it('with no resume ever written, get_me and get_profile return the seed /cv prints', async () => {
    const { RESUME_SEED } = await import('@/lib/resume-seed')
    await ProfileModel.create({ _id: DOC_ID, fullName: 'Ada' })
    const t = await token(['read'])
    const me = JSON.parse((await client.callTool(t, 'get_me', {})).text)
    expect(me.cv).toEqual(RESUME_SEED)
    const section = JSON.parse(
      (await client.callTool(t, 'get_profile', { section: 'resume' })).text
    )
    expect(section.value.resume).toEqual(RESUME_SEED)
  })
})

describe('the tailor-cv prompt (R8)', () => {
  it('returns markdown built from get_me and never writes the profile', async () => {
    const t = await token(['read', 'publish'])
    const reply = await client.rpc(t, 'prompts/get', {
      name: 'tailor-cv',
      arguments: { job_posting: 'Senior TypeScript engineer, Next.js' },
    })
    const text = reply.body.result?.messages?.[0].content.text ?? ''
    expect(text).toContain('Senior TypeScript engineer, Next.js')
    expect(text).toContain('get_me')
    expect(text).toContain('markdown')
    expect(text).toMatch(/Do not call update_profile/)
  })
})

describe('taxonomy-service (C8)', () => {
  it('a kind relabel and a series retitle revalidate /blog; creating one does not', async () => {
    const service = await import('@/lib/blog/taxonomy-service')
    const kind = await service.createKind({
      slug: 'note',
      label: 'Note',
      eyebrow: true,
    })
    expect(kind.ok).toBe(true)
    expect(cache.revalidatePath).not.toHaveBeenCalled()
    if (!kind.ok) return
    await service.updateKind(kind.value.id, { label: 'Quick note' })
    expect(cache.revalidatePath).toHaveBeenCalledWith('/blog')

    const series = await service.createSeries({ slug: 'logs', title: 'Logs' })
    if (!series.ok) throw new Error(series.error)
    cache.revalidatePath.mockClear()
    await service.updateSeries(series.value.id, { title: 'Build logs' })
    expect(cache.revalidatePath).toHaveBeenCalledWith('/blog')
  })

  it('keeps the delete guards: the last kind, and a kind or series still in use', async () => {
    const service = await import('@/lib/blog/taxonomy-service')
    const only = await service.createKind({ slug: 'article', label: 'Article' })
    if (!only.ok) throw new Error(only.error)
    expect(await service.deleteKind(only.value.id)).toMatchObject({
      ok: false,
      status: 409,
    })

    await service.createKind({ slug: 'note', label: 'Note' })
    const series = await service.createSeries({ slug: 'logs', title: 'Logs' })
    if (!series.ok) throw new Error(series.error)
    await PostModel.create({
      slug: 'p',
      title: 'P',
      kind: 'article',
      series: 'logs',
    })
    const inUse = await service.deleteKind(only.value.id)
    expect(inUse).toMatchObject({ ok: false, status: 409 })
    if (!inUse.ok) expect(inUse.extra?.posts).toHaveLength(1)
    expect(await service.deleteSeries(series.value.id)).toMatchObject({
      ok: false,
      status: 409,
    })
    expect(
      await service.updateKind(only.value.id, { slug: 'renamed' })
    ).toMatchObject({
      ok: false,
      status: 400,
    })
  })
})
