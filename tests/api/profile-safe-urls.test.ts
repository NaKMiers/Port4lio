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
import { CvModel } from '@/models/Cv'
import { ProfileModel } from '@/models/Profile'

/**
 * The URL rule agents write under (multi-cv-plan.md IT10), and the contract that BOTH agent
 * write paths go through the one copy of it in `lib/mcp/safe-urls.ts`.
 *
 * ```
 *   the rule       new image not this site's Cloudinary ──▶ unsafe · new link not http(s)/mailto
 *                  ──▶ unsafe · a URL already stored ──▶ passes · keys at any depth, `photo` too
 *   the contract   patchProfileSection (update_profile) ──┐
 *                  saveCv, actor 'agent' (update_cv)    ──┴──▶ safe-urls.unsafeUrls, same verdict
 * ```
 *
 * The contract half wraps the real module in a spy rather than re-stating the rule: if
 * either service grew its own copy again, the spy would stop seeing its calls.
 */

vi.hoisted(() => {
  process.env.PROFILE_DOCUMENT_ID = 'safe-urls-profile'
  // The image-host rule reads the cloud name at module load.
  process.env.CLOUDINARY_CLOUD_NAME = 'test-cloud'
})

vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
  unstable_cache: <T>(fn: T) => fn,
}))

const spy = vi.hoisted(() => ({ unsafeUrls: vi.fn() }))
vi.mock('@/lib/mcp/safe-urls', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/mcp/safe-urls')>()
  spy.unsafeUrls.mockImplementation(actual.unsafeUrls)
  return { ...actual, unsafeUrls: spy.unsafeUrls }
})

const DOC_ID = 'safe-urls-profile'
const CLOUD = 'https://res.cloudinary.com/test-cloud/image/upload/v1/me.png'
const PIXEL = 'https://tracker.example.com/p.png'

let memory: MongoMemoryServer
let safe: typeof import('@/lib/mcp/safe-urls')

beforeAll(async () => {
  memory = await MongoMemoryServer.create()
  process.env.MONGODB_URI = memory.getUri()
  await mongoose.connect(memory.getUri())
  safe = await import('@/lib/mcp/safe-urls')
}, 120_000)

afterAll(async () => {
  await mongoose.disconnect()
  await memory.stop()
})

afterEach(async () => {
  spy.unsafeUrls.mockClear()
  await CvModel.deleteMany({})
  await ProfileModel.deleteMany({})
})

describe('the rule', () => {
  it('finds image and link keys at any depth, the CV photo included', () => {
    const found = safe.urlsIn({
      avatar: 'a',
      nested: [{ image: 'b', link: 'c' }],
      resume: { photo: 'd', contact: { links: [{ href: 'e' }] } },
      cv: 'f',
      text: 'https://not-a-url-key.example.com',
      empty: { image: '' },
    })
    expect([...found.images].sort()).toEqual(['a', 'b', 'd'])
    expect([...found.links].sort()).toEqual(['c', 'e', 'f'])
  })

  it('judges only what the write introduces', () => {
    const current = { avatar: 'https://old-host.example.com/me.png' }
    expect(safe.unsafeUrls(current, current)).toEqual([])
    expect(safe.unsafeUrls({ avatar: CLOUD }, current)).toEqual([])
    expect(safe.unsafeUrls({ avatar: PIXEL }, current)).toEqual([PIXEL])
  })

  it('images: only https from this Cloudinary account', () => {
    for (const url of [
      PIXEL,
      'http://res.cloudinary.com/test-cloud/image/upload/v1/me.png',
      'https://res.cloudinary.com/other-cloud/image/upload/v1/me.png',
      '//res.cloudinary.com/test-cloud/x.png',
      '/local.png',
    ])
      expect(safe.unsafeUrls({ photo: url }, {})).toEqual([url])
    expect(safe.unsafeUrls({ photo: CLOUD }, {})).toEqual([])
  })

  it('links: http, https and mailto only', () => {
    for (const href of [
      'https://ada.dev',
      'http://ada.dev',
      'mailto:ada@example.com',
    ])
      expect(safe.isSafeLink(href)).toBe(true)
    for (const href of [
      'javascript:alert(1)',
      'data:text/html,hi',
      '/relative',
      'ada.dev',
    ])
      expect(safe.isSafeLink(href)).toBe(false)
  })

  it('lists refused URLs quoted and cut to 120 characters', () => {
    const long = `https://x.example.com/${'a'.repeat(200)}`
    expect(safe.listUnsafe(['javascript:x', long])).toBe(
      `"javascript:x", ${JSON.stringify(long.slice(0, 120))}`
    )
  })
})

describe('the contract: both agent writes call the one rule', () => {
  it('update_profile (patchProfileSection) refuses a new pixel through safe-urls', async () => {
    const { patchProfileSection } = await import('@/lib/profile-service')
    const { readProfileSection } = await import('@/lib/profile-sections')
    await ProfileModel.create({ _id: DOC_ID, fullName: 'Ada' })
    const identity = await readProfileSection('identity')

    const result = await patchProfileSection(
      'identity',
      { ...identity.value, avatar: PIXEL },
      identity.version
    )

    expect(result).toMatchObject({ ok: false, reason: 'invalid' })
    expect(spy.unsafeUrls).toHaveBeenCalledTimes(1)
    expect(spy.unsafeUrls.mock.results[0].value).toEqual([PIXEL])
  })

  it('update_cv (saveCv as the agent) refuses the same pixel through safe-urls', async () => {
    const { getCv, saveCv } = await import('@/lib/cv/cv-service')
    await ProfileModel.create({
      _id: DOC_ID,
      resume: { ...makeEmptyResume(), name: 'Ada' },
    })
    const read = await getCv()
    if (!read.ok) throw new Error(read.error)

    const result = await saveCv(read.value.cv.id, {
      resume: { ...read.value.cv.resume, photo: PIXEL },
      base: new Date(read.value.cv.updatedAt),
      actor: 'agent',
    })

    expect(result).toMatchObject({ ok: false, status: 400 })
    expect(spy.unsafeUrls).toHaveBeenCalledTimes(1)
    expect(spy.unsafeUrls.mock.results[0].value).toEqual([PIXEL])
  })

  it("the owner's Save CV is not judged: the owner uploads the images", async () => {
    const { getCv, saveCv } = await import('@/lib/cv/cv-service')
    const read = await getCv()
    if (!read.ok) throw new Error(read.error)

    const result = await saveCv(read.value.cv.id, {
      resume: { ...read.value.cv.resume, photo: PIXEL },
      base: '*',
      actor: 'owner',
    })

    expect(result.ok).toBe(true)
    expect(spy.unsafeUrls).not.toHaveBeenCalled()
  })
})
