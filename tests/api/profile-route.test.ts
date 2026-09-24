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

/**
 * `GET` and `POST /api/profile`, pinned against the route as it stood before the MCP work
 * moved its write into `profile-service` (mcp-plan.md R10).
 *
 * ```
 *   POST ──▶ owner gate ──▶ Content-Type ──▶ size ──▶ JSON ──▶ $set + upsert ──▶ revalidateTag
 *              401            415             413     !2xx      exact document     tag, 'max'
 * ```
 *
 * These are behaviour assertions, not a snapshot, so a failure names the behaviour that
 * changed. They were green on the unchanged route and must stay unmodified through the
 * extraction: a red test here means the extraction changed what the settings editor gets,
 * not that the test needs updating.
 *
 * `next/cache` is mocked at the framework boundary on purpose. The route calls
 * `revalidateTag` itself today and the service will call it after the extraction, so a mock
 * of either module would only follow one of the two - this one follows both.
 */

const cache = vi.hoisted(() => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
}))
vi.mock('next/cache', () => ({
  revalidateTag: cache.revalidateTag,
  revalidatePath: cache.revalidatePath,
  unstable_cache: <T>(fn: T) => fn,
}))

const DOC_ID = 'profile-route-test'
const URL = 'http://localhost/api/profile'
const NOW = new Date('2026-09-24T10:00:00.000Z')

type Handler = (request: NextRequest) => Promise<Response>
let memory: MongoMemoryServer
let GET: () => Promise<Response>
let POST: Handler
let ProfileModel: typeof import('@/models/Profile').ProfileModel
let PUBLIC_PROFILE_CACHE_TAG: string

beforeAll(async () => {
  memory = await MongoMemoryServer.create()
  process.env.MONGODB_URI = memory.getUri()
  process.env.AUTH_SECRET = 'profile-route-secret'
  // Read once at module load by `models/Profile.ts`, so it is set before the first import.
  process.env.PROFILE_DOCUMENT_ID = DOC_ID
  delete process.env.REQUIRE_ADMIN
  await mongoose.connect(memory.getUri())
  ;({ GET, POST } = (await import('@/app/api/profile/route')) as never)
  ;({ ProfileModel } = await import('@/models/Profile'))
  ;({ PUBLIC_PROFILE_CACHE_TAG } = await import('@/lib/profile-data'))
}, 120_000)

afterAll(async () => {
  await mongoose.disconnect()
  await memory.stop()
})

afterEach(async () => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  delete process.env.REQUIRE_ADMIN
  vi.clearAllMocks()
  await ProfileModel.deleteMany({})
})

const ownerCookie = () =>
  `${getAuthCookieName()}=${makeAuthToken(Date.now() + 3_600_000)}`

function post(
  body: string | Record<string, unknown>,
  {
    cookie = ownerCookie(),
    contentType = 'application/json',
  }: { cookie?: string | null; contentType?: string } = {}
) {
  return POST(
    new NextRequest(URL, {
      method: 'POST',
      headers: {
        ...(contentType ? { 'content-type': contentType } : {}),
        ...(cookie ? { cookie } : {}),
      },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  )
}

const stored = () => ProfileModel.findById(DOC_ID).lean()

/** What an upsert writes for every field the body did not send (Mongoose's schema defaults). */
const DEFAULTS = {
  cv: '',
  fullName: '',
  username: '',
  jobTitle: [],
  description: '',
  avatar: '',
  backgroundImage: '',
  publicLocation: '',
  socials: [],
  profileHeading: '',
  profileSubHeading: '',
  stats: [],
  aboutMe: '',
  skills: [],
  experience: [],
  education: [],
  certificates: [],
  serviceHeading: '',
  serviceSubHeading: '',
  briefServices: [],
  services: [],
  workHeading: '',
  workSubHeading: '',
  projects: [],
}

const RESUME = {
  name: 'Ada Lovelace',
  role: 'Engineer',
  photo: '',
  hidePhoto: false,
  contact: {
    email: 'ada@example.com',
    phone: '+84 900 000 000',
    location: 'Hanoi',
    links: [],
  },
  skillBlocks: [],
  projectSections: [],
}

describe('POST /api/profile - owner gate', () => {
  it('401 without the owner cookie, and nothing is written', async () => {
    const res = await post({ fullName: 'Stranger' }, { cookie: null })
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Unauthorized' })
    expect(await stored()).toBeNull()
    expect(cache.revalidateTag).not.toHaveBeenCalled()
  })

  it('401 with a forged cookie', async () => {
    const res = await post(
      { fullName: 'Stranger' },
      { cookie: `${getAuthCookieName()}=forged.token` }
    )
    expect(res.status).toBe(401)
    expect(await stored()).toBeNull()
  })

  it('REQUIRE_ADMIN=false opens it outside production', async () => {
    process.env.REQUIRE_ADMIN = 'false'
    const res = await post({ fullName: 'Local' }, { cookie: null })
    expect(res.status).toBe(200)
    expect((await stored())?.fullName).toBe('Local')
  })

  it('REQUIRE_ADMIN=false is ignored in production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    process.env.REQUIRE_ADMIN = 'false'
    const res = await post({ fullName: 'Local' }, { cookie: null })
    expect(res.status).toBe(401)
    expect(await stored()).toBeNull()
  })
})

describe('POST /api/profile - validation', () => {
  it('415 for a body that is not declared JSON', async () => {
    const res = await post(JSON.stringify({ fullName: 'X' }), {
      contentType: 'text/plain',
    })
    expect(res.status).toBe(415)
    expect(await res.json()).toEqual({
      error: 'Expected Content-Type: application/json',
    })
    expect(await stored()).toBeNull()
  })

  it('413 past the 4 MB cap, and nothing is written', async () => {
    const res = await post({ aboutMe: 'x'.repeat(4 * 1024 * 1024 + 1) })
    expect(res.status).toBe(413)
    expect(await res.json()).toEqual({ error: 'Profile JSON exceeds 4 MB' })
    expect(await stored()).toBeNull()
  })

  it('malformed JSON is refused and nothing is written', async () => {
    const res = await post('{"fullName": ')
    expect(res.ok).toBe(false)
    expect(await stored()).toBeNull()
    expect(cache.revalidateTag).not.toHaveBeenCalled()
  })

  it('a value the schema cannot cast is refused and nothing is written', async () => {
    const res = await post({ stats: [{ label: 'Years', value: 'many' }] })
    expect(res.ok).toBe(false)
    expect(await stored()).toBeNull()
    expect(cache.revalidateTag).not.toHaveBeenCalled()
  })
})

describe('POST /api/profile - what gets stored', () => {
  it('first save upserts the singleton: the body, schema defaults, both timestamps', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)

    const res = await post({
      fullName: 'Ada Lovelace',
      jobTitle: ['Engineer', 'Writer'],
      stats: [{ label: 'Years', value: 8 }],
    })

    expect(res.status).toBe(200)
    expect(await stored()).toEqual({
      ...DEFAULTS,
      _id: DOC_ID,
      fullName: 'Ada Lovelace',
      jobTitle: ['Engineer', 'Writer'],
      stats: [{ label: 'Years', value: 8 }],
      createdAt: NOW,
      updatedAt: NOW,
    })
  })

  it('a later save is a $set: sent fields replace, unsent fields stay, createdAt is kept', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    await post({
      fullName: 'Ada',
      aboutMe: 'First about',
      skills: [{ groupName: 'Web', items: [{ icon: 'ts', name: 'TS' }] }],
    })

    const later = new Date(NOW.getTime() + 60_000)
    vi.setSystemTime(later)
    const res = await post({ aboutMe: 'Second about', skills: [] })

    expect(res.status).toBe(200)
    expect(await stored()).toEqual({
      ...DEFAULTS,
      _id: DOC_ID,
      fullName: 'Ada',
      aboutMe: 'Second about',
      skills: [],
      createdAt: NOW,
      updatedAt: later,
    })
  })

  it('stores the private resume block, contact details included', async () => {
    await post({ fullName: 'Ada', resume: RESUME })
    const doc = await stored()
    expect(doc?.resume).toEqual(RESUME)
  })

  it('drops a field the schema does not know', async () => {
    await post({ fullName: 'Ada', isAdmin: true })
    const doc = (await stored()) as Record<string, unknown>
    expect(doc.fullName).toBe('Ada')
    expect(doc).not.toHaveProperty('isAdmin')
  })

  it('refuses a body carrying a $-operator key, and writes nothing', async () => {
    const res = await post({ fullName: 'Ada', $where: 'x' })
    expect(res.ok).toBe(false)
    expect(await stored()).toBeNull()
  })

  it('answers { ok, profile } with every field, private ones included, and no bookkeeping', async () => {
    const res = await post({ fullName: 'Ada', resume: RESUME })
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.profile).toEqual({
      ...DEFAULTS,
      fullName: 'Ada',
      resume: RESUME,
    })
    expect(body.profile).not.toHaveProperty('_id')
    expect(body.profile).not.toHaveProperty('createdAt')
    expect(body.profile).not.toHaveProperty('updatedAt')
  })
})

describe('POST /api/profile - revalidation', () => {
  it("calls revalidateTag(PUBLIC_PROFILE_CACHE_TAG, 'max') once per successful save", async () => {
    await post({ fullName: 'Ada' })
    expect(cache.revalidateTag).toHaveBeenCalledTimes(1)
    expect(cache.revalidateTag).toHaveBeenCalledWith(
      PUBLIC_PROFILE_CACHE_TAG,
      'max'
    )
    expect(PUBLIC_PROFILE_CACHE_TAG).toBe('public-profile')
  })

  it('does not revalidate a refused save', async () => {
    await post({ fullName: 'Ada' }, { cookie: null })
    await post('{', {})
    expect(cache.revalidateTag).not.toHaveBeenCalled()
  })
})

describe('GET /api/profile - the public read', () => {
  it('serves allowlisted fields only: no resume, no contact details, no bookkeeping', async () => {
    await post({ fullName: 'Ada', aboutMe: 'Hi', resume: RESUME })

    const res = await GET()
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).not.toContain('ada@example.com')
    expect(text).not.toContain('+84 900 000 000')

    const { profile } = JSON.parse(text)
    expect(profile.fullName).toBe('Ada')
    expect(profile.aboutMe).toBe('Hi')
    expect(profile).not.toHaveProperty('resume')
    expect(profile).not.toHaveProperty('_id')
    expect(profile).not.toHaveProperty('createdAt')
    expect(profile).not.toHaveProperty('updatedAt')
    expect(Object.keys(profile).sort()).toEqual(Object.keys(DEFAULTS).sort())
  })

  it('needs no cookie', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    expect((await res.json()).profile.fullName).toBe('')
  })
})
