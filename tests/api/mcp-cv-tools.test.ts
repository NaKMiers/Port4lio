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

import { makeEmptyResume } from '@/lib/profile'
import { PUBLIC_PROFILE_CACHE_TAG } from '@/lib/profile-data'
import { MAX_CVS } from '@/lib/upload-limits'
import { AgentActionModel } from '@/models/AgentAction'
import { AgentTokenModel } from '@/models/AgentToken'
import { CvModel, LEGACY_CV_ID } from '@/models/Cv'
import { RateLimitModel } from '@/models/RateLimit'

import { mcpClient, type RouteHandler } from './mcp-helpers'

/**
 * The CV tools through `/api/mcp` (multi-cv-plan.md Phase 2, IT12; P2-A to P2-C).
 *
 * ```
 *   happy paths   list_cvs · get_cv (published by default) · create_cv · update_cv · publish_cv
 *                 · delete_cv, each through cv-service with actor 'agent'
 *   scopes        read lists/reads every CV · write creates and edits unpublished CVs · the
 *                 published CV, publish and delete need publish                       (P2-B)
 *   guards        stale version · '*' · published CV undeletable · clientRef replay
 *                 · stored photo '' · new third-party URL refused, stored URL kept
 *   fit (P2-A)    agent writes ──▶ fitVerified false · publishing it warns · owner Save CV clears
 *   freshness     update_cv on the published CV expires /cv's tag outright
 *   audit         exactly one AgentAction row per call, target { kind: 'cv', id }
 * ```
 */

vi.hoisted(() => {
  process.env.PROFILE_DOCUMENT_ID = 'mcp-cv-profile'
  process.env.CLOUDINARY_CLOUD_NAME = 'test-cloud'
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

const DOC_ID = 'mcp-cv-profile'
const AVATAR = 'https://res.cloudinary.com/test-cloud/image/upload/v1/me.png'
const FIT_WARNING =
  'Fit not verified: /cv may clip text. Ask the owner to open this CV in /admin/settings and Save CV.'
const MAIN = String(LEGACY_CV_ID)

let memory: MongoMemoryServer
let client: ReturnType<typeof mcpClient>
let tokenLib: typeof import('@/lib/mcp/token')
let cvService: typeof import('@/lib/cv/cv-service')
let ProfileModel: typeof import('@/models/Profile').ProfileModel

beforeAll(async () => {
  memory = await MongoMemoryServer.create()
  process.env.MONGODB_URI = memory.getUri()
  process.env.AUTH_SECRET = 'mcp-cv-secret'
  delete process.env.REQUIRE_ADMIN
  await mongoose.connect(memory.getUri())
  await Promise.all([
    AgentTokenModel.syncIndexes(),
    AgentActionModel.syncIndexes(),
  ])
  const route = await import('@/app/api/mcp/route')
  client = mcpClient(route.POST as RouteHandler, 'http://localhost/api/mcp')
  tokenLib = await import('@/lib/mcp/token')
  cvService = await import('@/lib/cv/cv-service')
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
    ProfileModel.deleteMany({}),
    RateLimitModel.deleteMany({}),
  ])
})

type Scope = 'read' | 'write' | 'publish' | 'pii'
const token = async (scopes: Scope[]) =>
  (await tokenLib.createAgentToken('agent', scopes)).token
const parse = (text: string) => JSON.parse(text)

/** A profile whose legacy CV becomes "Main CV" on the first CV call, photo inheriting. */
async function seedProfile() {
  await ProfileModel.create({
    _id: DOC_ID,
    fullName: 'Ada',
    avatar: AVATAR,
    resume: {
      ...makeEmptyResume(),
      name: 'Ada',
      role: 'Engineer',
      photo: '',
      contact: {
        email: 'owner@example.com',
        phone: '1',
        location: 'Hanoi',
        links: [{ label: 'Site', text: 'ada.dev', href: 'https://ada.dev' }],
      },
    },
  })
}

async function call(t: string, name: string, args: unknown = {}) {
  const reply = await client.callTool(t, name, args)
  return { ...reply, json: reply.isError ? null : parse(reply.text) }
}

/** An agent copy of the published CV, with the version update_cv needs. */
async function agentCopy(t: string, label = 'Acme') {
  const made = await call(t, 'create_cv', { label })
  expect(made.isError, made.text).toBe(false)
  const read = await call(t, 'get_cv', { id: made.json.id })
  return read.json as {
    id: string
    version: string
    resume: Record<string, unknown>
  }
}

const rows = async () => {
  await flushAfter()
  return AgentActionModel.find(
    {},
    { tool: 1, outcome: 1, reason: 1, target: 1, _id: 0 }
  )
    .sort({ at: 1 })
    .lean()
}

describe('happy paths', () => {
  it('list_cvs migrates and lists every CV with its version and fit', async () => {
    await seedProfile()
    const t = await token(['read'])

    const { json } = await call(t, 'list_cvs')

    expect(json.publishedId).toBe(MAIN)
    expect(json.cvs).toHaveLength(1)
    const [main] = json.cvs
    expect(main).toMatchObject({
      id: MAIN,
      label: 'Main CV',
      published: true,
      fitVerified: true,
    })
    expect(main.version).toBe(main.updatedAt)
    expect(new Date(main.version).toISOString()).toBe(main.version)
  })

  it('get_cv defaults to the published CV and returns the STORED resume: photo "" plus the avatar', async () => {
    await seedProfile()
    const t = await token(['read'])

    const { json } = await call(t, 'get_cv')

    expect(json).toMatchObject({
      id: MAIN,
      label: 'Main CV',
      published: true,
      fitVerified: true,
      avatar: AVATAR,
    })
    // The derived copy /cv prints would carry AVATAR here; writing that back would freeze it.
    expect(json.resume.photo).toBe('')
    expect(json.resume.contact.email).toBe('owner@example.com')
    expect(typeof json.version).toBe('string')
  })

  it('read covers every CV, not only the published one (P2-C)', async () => {
    await seedProfile()
    const writer = await token(['read', 'write'])
    const copy = await agentCopy(writer)

    const reader = await token(['read'])
    const { json } = await call(reader, 'get_cv', { id: copy.id })
    expect(json).toMatchObject({ id: copy.id, published: false })
  })

  it('create_cv copies the published CV by default; nothing goes live', async () => {
    await seedProfile()
    const t = await token(['read', 'write'])

    const { json } = await call(t, 'create_cv', { label: 'Acme - Senior TS' })

    expect(json).toMatchObject({
      label: 'Acme - Senior TS',
      published: false,
      fitVerified: false,
      copiedFrom: MAIN,
    })
    const stored = await CvModel.findById(json.id).lean()
    expect(stored?.resume.name).toBe('Ada')
    expect(stored?.publishedAt).toBeNull()
    expect((await cvService.findPublished())?._id.toString()).toBe(MAIN)
  })

  it('update_cv replaces an unpublished CV whole, with the version', async () => {
    await seedProfile()
    const t = await token(['read', 'write'])
    const copy = await agentCopy(t)

    const { json, isError, text } = await call(t, 'update_cv', {
      id: copy.id,
      version: copy.version,
      label: 'Acme (tailored)',
      resume: { ...copy.resume, role: 'Senior TypeScript Engineer' },
    })

    expect(isError, text).toBe(false)
    expect(json).toMatchObject({
      id: copy.id,
      label: 'Acme (tailored)',
      published: false,
      fitVerified: false,
    })
    expect(json.warning).toBeUndefined()
    expect(json.version).not.toBe(copy.version)
    const stored = await CvModel.findById(copy.id).lean()
    expect(stored?.resume.role).toBe('Senior TypeScript Engineer')
    expect(stored?.resume.photo).toBe('')
  })

  it('publish_cv makes the CV live; delete_cv removes an unpublished one', async () => {
    await seedProfile()
    const t = await token(['read', 'write', 'publish'])
    const copy = await agentCopy(t)

    const published = await call(t, 'publish_cv', { id: copy.id })
    expect(published.json.publishedId).toBe(copy.id)
    expect((await cvService.findPublished())?._id.toString()).toBe(copy.id)
    expect(cache.revalidateTag).toHaveBeenCalledWith(PUBLIC_PROFILE_CACHE_TAG, {
      expire: 0,
    })

    const deleted = await call(t, 'delete_cv', { id: MAIN })
    expect(deleted.json).toEqual({ ok: true, id: MAIN })
    expect(await CvModel.exists({ _id: MAIN })).toBeNull()
  })
})

describe('scopes (P2-B)', () => {
  it('a read token lists only list_cvs and get_cv; every CV write is refused and audited', async () => {
    await seedProfile()
    const t = await token(['read'])
    const names = await client.toolNames(t)
    expect(names).toEqual(expect.arrayContaining(['list_cvs', 'get_cv']))
    for (const name of ['create_cv', 'update_cv', 'publish_cv', 'delete_cv'])
      expect(names).not.toContain(name)

    const create = await call(t, 'create_cv', { label: 'X' })
    expect(create.isError).toBe(true)
    expect(create.text).toContain('needs the write scope')
    const publish = await call(t, 'publish_cv', { id: MAIN })
    expect(publish.text).toContain('needs the publish scope')
    const del = await call(t, 'delete_cv', { id: MAIN })
    expect(del.text).toContain('needs the publish scope')
    const update = await call(t, 'update_cv', {
      id: MAIN,
      version: new Date().toISOString(),
      label: 'X',
    })
    expect(update.text).toContain('needs the write scope')

    expect((await rows()).map(row => [row.tool, row.reason])).toEqual([
      ['create_cv', 'scope'],
      ['publish_cv', 'scope'],
      ['delete_cv', 'scope'],
      ['update_cv', 'scope'],
    ])
  })

  it('a write token without read cannot list or read CVs', async () => {
    const t = await token(['write'])
    expect((await call(t, 'list_cvs')).text).toContain('needs the read scope')
    expect((await call(t, 'get_cv')).text).toContain('needs the read scope')
  })

  it('write edits an unpublished CV but not the published one, which is left untouched', async () => {
    await seedProfile()
    const t = await token(['read', 'write'])
    const main = (await call(t, 'get_cv')).json

    const refused = await call(t, 'update_cv', {
      id: MAIN,
      version: main.version,
      resume: { ...main.resume, role: 'Live edit' },
    })

    expect(refused.isError).toBe(true)
    expect(refused.text).toMatch(/needs the publish scope/)
    expect(refused.text).toMatch(/create_cv/)
    expect((await CvModel.findById(MAIN).lean())?.resume.role).toBe('Engineer')
    expect(cache.revalidateTag).not.toHaveBeenCalled()
    expect((await rows()).at(-1)).toMatchObject({
      tool: 'update_cv',
      outcome: 'refused',
      reason: 'scope',
      target: { kind: 'cv', id: MAIN },
    })
  })

  it('write cannot publish or delete, even an unpublished CV', async () => {
    await seedProfile()
    const t = await token(['read', 'write'])
    const copy = await agentCopy(t)
    expect((await call(t, 'publish_cv', { id: copy.id })).isError).toBe(true)
    expect((await call(t, 'delete_cv', { id: copy.id })).isError).toBe(true)
    expect(await CvModel.exists({ _id: copy.id })).not.toBeNull()
  })

  it('publish edits the published CV, and /cv is expired outright', async () => {
    await seedProfile()
    const t = await token(['read', 'write', 'publish'])
    const main = (await call(t, 'get_cv')).json
    cache.revalidateTag.mockClear()

    const { json, isError, text } = await call(t, 'update_cv', {
      id: MAIN,
      version: main.version,
      resume: { ...main.resume, role: 'Live edit' },
    })

    expect(isError, text).toBe(false)
    expect(json).toMatchObject({ published: true, fitVerified: false })
    expect(json.warning).toBe(FIT_WARNING)
    expect((await CvModel.findById(MAIN).lean())?.resume.role).toBe('Live edit')
    expect(cache.revalidateTag).toHaveBeenCalledWith(PUBLIC_PROFILE_CACHE_TAG, {
      expire: 0,
    })
  })
})

describe('guards', () => {
  it('a stale version is refused and nothing changes', async () => {
    await seedProfile()
    const t = await token(['read', 'write'])
    const copy = await agentCopy(t)
    // The owner saves the same CV in /admin/settings meanwhile.
    await cvService.saveCv(copy.id, {
      resume: { ...makeEmptyResume(), name: 'Owner saved' },
      base: '*',
      actor: 'owner',
    })

    const stale = await call(t, 'update_cv', {
      id: copy.id,
      version: copy.version,
      resume: { ...copy.resume, role: 'Agent' },
    })

    expect(stale.isError).toBe(true)
    expect(stale.text).toMatch(/Call get_cv again/)
    expect((await CvModel.findById(copy.id).lean())?.resume.name).toBe(
      'Owner saved'
    )
    expect((await rows()).at(-1)).toMatchObject({ reason: 'stale' })
  })

  it("'*' and a version that is not a date are refused", async () => {
    await seedProfile()
    const t = await token(['read', 'write'])
    const copy = await agentCopy(t)

    const star = await call(t, 'update_cv', {
      id: copy.id,
      version: '*',
      label: 'Forced',
    })
    expect(star.isError).toBe(true)
    expect(star.text).toMatch(/not available to agents/)
    const junk = await call(t, 'update_cv', {
      id: copy.id,
      version: 'yesterday',
      label: 'Forced',
    })
    expect(junk.isError).toBe(true)
    expect((await CvModel.findById(copy.id).lean())?.label).toBe('Acme')
  })

  it('a partial resume is refused, naming what is missing', async () => {
    await seedProfile()
    const t = await token(['read', 'write'])
    const copy = await agentCopy(t)

    const partial = await call(t, 'update_cv', {
      id: copy.id,
      version: copy.version,
      resume: { role: 'Only this' },
    })

    expect(partial.isError).toBe(true)
    expect(partial.text).toMatch(/replaced whole/)
    expect(partial.text).toMatch(/Missing: name/)
    expect((await CvModel.findById(copy.id).lean())?.resume.name).toBe('Ada')
  })

  it('the published CV cannot be deleted', async () => {
    await seedProfile()
    const t = await token(['read', 'publish'])
    await call(t, 'list_cvs')

    const refused = await call(t, 'delete_cv', { id: MAIN })

    expect(refused.isError).toBe(true)
    expect(refused.text).toMatch(/Publish another CV first/)
    expect(await CvModel.exists({ _id: MAIN })).not.toBeNull()
    expect((await rows()).at(-1)).toMatchObject({
      tool: 'delete_cv',
      reason: 'published',
    })
  })

  it('create_cv replays on a repeated clientRef: one CV, the same answer', async () => {
    await seedProfile()
    const t = await token(['read', 'write'])

    const first = await call(t, 'create_cv', {
      label: 'Once',
      clientRef: 'tailor-1',
    })
    const retry = await call(t, 'create_cv', {
      label: 'Once',
      clientRef: 'tailor-1',
    })

    expect(retry.text).toBe(first.text)
    expect(await CvModel.countDocuments({ label: 'Once' })).toBe(1)
  })

  it('a new third-party image or unsafe link is refused; a URL already stored passes', async () => {
    await seedProfile()
    const t = await token(['read', 'write'])
    const copy = await agentCopy(t)
    const update = async (resume: Record<string, unknown>) => {
      const { version } = (await call(t, 'get_cv', { id: copy.id })).json
      return call(t, 'update_cv', { id: copy.id, version, resume })
    }

    const pixel = await update({
      ...copy.resume,
      photo: 'https://tracker.example.com/p.png',
    })
    expect(pixel.isError).toBe(true)
    expect(pixel.text).toMatch(/not allowed on the CV/)

    const contact = copy.resume.contact as Record<string, unknown>
    const badLink = await update({
      ...copy.resume,
      contact: {
        ...contact,
        links: [{ label: 'X', text: 'x', href: 'javascript:alert(1)' }],
      },
    })
    expect(badLink.isError).toBe(true)

    // https://ada.dev was stored by the owner; re-sending it untouched passes.
    const kept = await update({ ...copy.resume, role: 'Kept links' })
    expect(kept.isError, kept.text).toBe(false)

    const cloud = await update({ ...copy.resume, photo: AVATAR })
    expect(cloud.isError, cloud.text).toBe(false)
  })

  it('refusals carry the reason the agent can act on: labelTaken, cap, not-found', async () => {
    await seedProfile()
    const t = await token(['read', 'write'])

    const taken = await call(t, 'create_cv', { label: 'main cv' })
    expect(taken.isError).toBe(true)
    expect(taken.text).toMatch(/already has this label/)

    const missing = await call(t, 'get_cv', {
      id: new mongoose.Types.ObjectId().toHexString(),
    })
    expect(missing.text).toMatch(/list_cvs/)

    for (let i = 1; i < MAX_CVS; i += 1)
      await cvService.createCv({
        label: `CV ${i}`,
        fromId: MAIN,
        actor: 'owner',
      })
    const full = await call(t, 'create_cv', { label: 'One too many' })
    expect(full.isError).toBe(true)
    expect(full.text).toMatch(new RegExp(`${MAX_CVS} CVs`))

    expect((await rows()).map(row => row.reason)).toEqual([
      'labelTaken',
      'not-found',
      'cap',
    ])
  })
})

describe('fit tracking (P2-A)', () => {
  it('an agent copy is unverified; publishing it succeeds and warns', async () => {
    await seedProfile()
    const t = await token(['read', 'write', 'publish'])
    const copy = await agentCopy(t)
    expect((await call(t, 'list_cvs')).json.cvs[1].fitVerified).toBe(false)

    const { json, isError } = await call(t, 'publish_cv', { id: copy.id })

    expect(isError).toBe(false)
    expect(json).toEqual({ publishedId: copy.id, warning: FIT_WARNING })
  })

  it("the owner's Save CV verifies it, and publishing then carries no warning", async () => {
    await seedProfile()
    const t = await token(['read', 'write', 'publish'])
    const copy = await agentCopy(t)
    const saved = await cvService.saveCv(copy.id, {
      resume: copy.resume,
      base: new Date(copy.version),
      actor: 'owner',
    })
    expect(saved).toMatchObject({ ok: true, value: { fitVerified: true } })

    const { json } = await call(t, 'publish_cv', { id: copy.id })
    expect(json).toEqual({ publishedId: copy.id })
  })

  it('the migrated CV is verified, so re-publishing it does not warn', async () => {
    await seedProfile()
    const t = await token(['read', 'publish'])
    expect((await call(t, 'publish_cv', { id: MAIN })).json).toEqual({
      publishedId: MAIN,
    })
  })
})

describe('audit', () => {
  it('exactly one AgentAction row per call, each targeting its CV', async () => {
    await seedProfile()
    const t = await token(['read', 'write', 'publish'])

    await call(t, 'list_cvs')
    await call(t, 'get_cv')
    const made = await call(t, 'create_cv', {
      label: 'Audited',
      clientRef: 'a1',
    })
    const id = made.json.id
    const { version, resume } = (await call(t, 'get_cv', { id })).json
    await call(t, 'update_cv', { id, version, resume })
    await call(t, 'publish_cv', { id })
    await call(t, 'delete_cv', { id }) // refused: it is published now
    await call(t, 'publish_cv', { id: MAIN })
    await call(t, 'delete_cv', { id })

    const audit = await rows()
    expect(audit.map(row => [row.tool, row.outcome, row.target])).toEqual([
      ['list_cvs', 'ok', null],
      ['get_cv', 'ok', { kind: 'cv', id: MAIN }],
      ['create_cv', 'ok', { kind: 'cv', id }],
      ['get_cv', 'ok', { kind: 'cv', id }],
      ['update_cv', 'ok', { kind: 'cv', id }],
      ['publish_cv', 'ok', { kind: 'cv', id }],
      ['delete_cv', 'refused', { kind: 'cv', id }],
      ['publish_cv', 'ok', { kind: 'cv', id: MAIN }],
      ['delete_cv', 'ok', { kind: 'cv', id }],
    ])
  })
})
