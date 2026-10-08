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
import { CvModel } from '@/models/Cv'
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
 *   tailor-cv        write: a copy via create_cv + update_cv, never published · else markdown
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
    CvModel.deleteMany({}),
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

  it('refuses a new off-site image or an unsafe link, but keeps a URL already stored', async () => {
    await ProfileModel.create({
      _id: DOC_ID,
      fullName: 'Ada',
      avatar: 'https://old-host.example.com/me.png',
      socials: [{ name: 'Site', icon: 'globe', link: 'https://ada.dev' }],
    })
    const t = await token(['read', 'publish'])
    const identity = async () =>
      parse(
        (await client.callTool(t, 'get_profile', { section: 'identity' })).text
      )
    const update = async (patch: Record<string, unknown>) => {
      const read = await identity()
      return client.callTool(t, 'update_profile', {
        section: 'identity',
        version: read.version,
        value: { ...read.value, ...patch },
      })
    }

    // The owner's old avatar is not re-judged when an agent fixes the name.
    const fixed = await update({ fullName: 'Ada L.' })
    expect(fixed.isError, fixed.text).toBe(false)

    const pixel = await update({ avatar: 'https://tracker.example.com/p.png' })
    expect(pixel.isError).toBe(true)
    expect(pixel.text).toMatch(/not allowed on the profile/)

    const badLink = await update({
      socials: [{ name: 'Site', icon: 'globe', link: 'data:text/html,hi' }],
    })
    expect(badLink.isError).toBe(true)

    const cloud = await update({
      avatar: 'https://res.cloudinary.com/test-cloud/image/upload/v1/me.png',
    })
    expect(cloud.isError, cloud.text).toBe(false)
    const doc = await ProfileModel.findById(DOC_ID).lean()
    expect(doc?.avatar).toBe(
      'https://res.cloudinary.com/test-cloud/image/upload/v1/me.png'
    )
  })

  it('refuses a section over the profile size limit', async () => {
    await seedProfile()
    const t = await token(['read', 'publish'])
    const read = parse(
      (await client.callTool(t, 'get_profile', { section: 'about' })).text
    )
    const call = await client.callTool(t, 'update_profile', {
      section: 'about',
      version: read.version,
      value: { ...read.value, aboutMe: 'x'.repeat(4 * 1024 * 1024 + 10) },
    })
    expect(call.isError).toBe(true)
    expect(call.text).toMatch(/over the 4 MB profile limit/)
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

describe('the settings save guard (stale tab)', () => {
  const owner = async () => {
    const { getAuthCookieName, makeAuthToken } = await import('@/lib/auth')
    return `${getAuthCookieName()}=${makeAuthToken(Date.now() + 3_600_000)}`
  }
  const save = async (body: Record<string, unknown>, base?: string) => {
    const { NextRequest } = await import('next/server')
    const { POST } = await import('@/app/api/profile/route')
    return POST(
      new NextRequest('http://localhost/api/profile', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: await owner(),
          ...(base ? { 'x-profile-base-updated-at': base } : {}),
        },
        body: JSON.stringify(body),
      })
    )
  }

  it('a save from a tab opened before an agent edit is a 409; overwrite and a fresh base work', async () => {
    const loaded = new Date('2026-09-20T00:00:00.000Z')
    await ProfileModel.create({
      _id: DOC_ID,
      fullName: 'Ada',
      updatedAt: loaded,
    })
    // An agent's update_profile lands while the settings tab sits open.
    await ProfileModel.updateOne(
      { _id: DOC_ID },
      {
        $set: {
          fullName: 'Agent fix',
          updatedAt: new Date(loaded.getTime() + 1_000),
        },
      }
    )

    const stale = await save({ fullName: 'Old tab' }, loaded.toISOString())
    expect(stale.status).toBe(409)
    expect((await stale.json()).code).toBe('stale')
    expect((await ProfileModel.findById(DOC_ID).lean())?.fullName).toBe(
      'Agent fix'
    )

    const overwrite = await save({ fullName: 'Owner wins' }, '*')
    expect(overwrite.status).toBe(200)
    const { updatedAt } = (await overwrite.json()) as { updatedAt: string }
    expect(typeof updatedAt).toBe('string')

    const fresh = await save({ fullName: 'Next save' }, updatedAt)
    expect(fresh.status).toBe(200)
    expect((await ProfileModel.findById(DOC_ID).lean())?.fullName).toBe(
      'Next save'
    )
  })
})

describe('the CV an agent reads', () => {
  it('falls back to the avatar for the photo, as /cv does', async () => {
    await ProfileModel.create({
      _id: DOC_ID,
      fullName: 'Ada',
      avatar: 'https://res.cloudinary.com/test-cloud/image/upload/v1/me.png',
    })
    const t = await token(['read'])
    const section = JSON.parse(
      (await client.callTool(t, 'get_profile', { section: 'resume' })).text
    )
    expect(section.value.resume.photo).toBe(
      'https://res.cloudinary.com/test-cloud/image/upload/v1/me.png'
    )
  })

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

  it('a published CV is what get_me and get_profile resume return (multi-CV)', async () => {
    const { makeEmptyResume } = await import('@/lib/profile')
    await ProfileModel.create({
      _id: DOC_ID,
      fullName: 'Ada',
      avatar: 'https://res.cloudinary.com/test-cloud/image/upload/v1/me.png',
      resume: RESUME,
    })
    await CvModel.create([
      {
        label: 'Published',
        labelKey: 'published',
        resume: { ...makeEmptyResume(), name: 'Published CV' },
        publishedAt: new Date('2026-09-25T10:00:00.000Z'),
      },
      {
        label: 'Draft copy',
        labelKey: 'draft copy',
        resume: { ...makeEmptyResume(), name: 'Never published' },
        publishedAt: null,
      },
    ])
    const t = await token(['read'])

    const me = JSON.parse((await client.callTool(t, 'get_me', {})).text)
    expect(me.cv.name).toBe('Published CV')
    // The avatar fallback still applies to the published CV.
    expect(me.cv.photo).toBe(
      'https://res.cloudinary.com/test-cloud/image/upload/v1/me.png'
    )
    const section = JSON.parse(
      (await client.callTool(t, 'get_profile', { section: 'resume' })).text
    )
    expect(section.value.resume).toEqual(me.cv)
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

describe('the MCP copy after Phase 2 (multi-cv-plan.md IT13)', () => {
  it('get_me names every CV once migrated, and [] before - it never migrates', async () => {
    await ProfileModel.create({ _id: DOC_ID, fullName: 'Ada', resume: RESUME })
    const t = await token(['read'])

    const before = JSON.parse((await client.callTool(t, 'get_me', {})).text)
    expect(before.cvs).toEqual([])
    expect(await CvModel.countDocuments()).toBe(0)

    const { listCvs, createCv } = await import('@/lib/cv/cv-service')
    const { publishedId } = await listCvs()
    await createCv({ label: 'Frontend', fromId: publishedId, actor: 'owner' })

    const after = JSON.parse((await client.callTool(t, 'get_me', {})).text)
    expect(after.cvs).toEqual([
      { id: publishedId, label: 'Main CV', published: true },
      { id: expect.any(String), label: 'Frontend', published: false },
    ])
    expect(after.cv.name).toBe('Ada')
  })

  it('the update_profile resume refusal points to update_cv', async () => {
    await ProfileModel.create({ _id: DOC_ID, fullName: 'Ada', resume: RESUME })
    const t = await token(['read', 'publish'])
    const read = JSON.parse(
      (await client.callTool(t, 'get_profile', { section: 'resume' })).text
    )
    const call = await client.callTool(t, 'update_profile', {
      section: 'resume',
      version: read.version,
      value: read.value,
    })
    expect(call.isError).toBe(true)
    expect(call.text).toMatch(/update_cv/)
    expect(call.text).toMatch(/\/admin\/settings/)
  })

  it('tailor-cv with write access copies and edits, never publishes unasked, and sends the owner to check the fit', async () => {
    const t = await token(['read', 'write', 'publish'])
    const reply = await client.rpc(t, 'prompts/get', {
      name: 'tailor-cv',
      arguments: { job_posting: 'Senior TypeScript engineer, Next.js' },
    })
    const text = reply.body.result?.messages?.[0].content.text ?? ''
    expect(text).toContain('Senior TypeScript engineer, Next.js')
    expect(text).toMatch(/create_cv/)
    expect(text).toMatch(/update_cv/)
    expect(text).toMatch(/Leave fromId out: it copies the published CV/)
    expect(text).toMatch(/Do not call publish_cv unless the owner asks/)
    expect(text).toMatch(/\/admin\/settings/)
    expect(text).toMatch(/Invent nothing/)
    expect(text).not.toMatch(/as markdown/)
  })

  it('SCOPE_INFO says read covers all CVs and drops "never the CV"', async () => {
    const { SCOPE_INFO } = await import('@/lib/mcp/scopes')
    expect(SCOPE_INFO.read.grants).toMatch(/all CVs/)
    expect(SCOPE_INFO.write.grants).toMatch(/unpublished CVs/)
    expect(SCOPE_INFO.publish.grants).toMatch(/publish and delete CVs/)
    expect(SCOPE_INFO.publish.grants).not.toMatch(/never the CV/)
  })
})
