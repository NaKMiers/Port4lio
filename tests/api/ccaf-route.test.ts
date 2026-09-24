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
import { DEFAULT_EXAM_DATE, emptyState } from '@/lib/ccaf/progress'
import { CcafProgressModel } from '@/models/CcafProgress'
import { RateLimitModel } from '@/models/RateLimit'

/**
 * `GET` and `PUT /api/ccaf`, pinned against the route as it stood before the MCP work moved
 * its write into `ccaf/progress-service` (mcp-plan.md R10).
 *
 * ```
 *   PUT ──▶ Content-Type ──▶ size ──▶ rate limit ──▶ owner gate ──▶ JSON ──▶ sanitize ──▶ upsert
 *             415            413        429            401          400      400        200 { ok, state }
 * ```
 *
 * The ORDER is part of the contract: the limiter runs before the owner check, so a stranger
 * hammering the route spends the same bucket. Behaviour assertions, not a snapshot, and
 * unmodified through the extraction - a red test here means the extraction changed what the
 * tracker page gets back.
 */

const URL = 'http://localhost/api/ccaf'
/** Mid-minute, so the 60 s fixed window cannot roll over inside one test. */
const NOW = new Date('2026-09-24T10:00:20.000Z')

type Handler = (request: NextRequest) => Promise<Response>
let memory: MongoMemoryServer
let GET: Handler
let PUT: Handler

beforeAll(async () => {
  memory = await MongoMemoryServer.create()
  process.env.MONGODB_URI = memory.getUri()
  process.env.AUTH_SECRET = 'ccaf-route-secret'
  delete process.env.REQUIRE_ADMIN
  await mongoose.connect(memory.getUri())
  ;({ GET, PUT } = (await import('@/app/api/ccaf/route')) as never)
}, 120_000)

afterAll(async () => {
  await mongoose.disconnect()
  await memory.stop()
})

let ipCounter = 0
let ip = ''
beforeEach(() => {
  ip = `10.1.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`
})

afterEach(async () => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  delete process.env.REQUIRE_ADMIN
  await Promise.all([
    CcafProgressModel.deleteMany({}),
    RateLimitModel.deleteMany({}),
  ])
})

const ownerCookie = () =>
  `${getAuthCookieName()}=${makeAuthToken(Date.now() + 3_600_000)}`

function put(
  body: unknown,
  {
    cookie = ownerCookie(),
    contentType = 'application/json',
    raw,
  }: { cookie?: string | null; contentType?: string; raw?: string } = {}
) {
  return PUT(
    new NextRequest(URL, {
      method: 'PUT',
      headers: {
        'x-forwarded-for': ip,
        ...(contentType ? { 'content-type': contentType } : {}),
        ...(cookie ? { cookie } : {}),
      },
      body: raw ?? JSON.stringify(body),
    })
  )
}

function get(cookie: string | null = ownerCookie()) {
  return GET(new NextRequest(URL, { headers: cookie ? { cookie } : undefined }))
}

const stored = () => CcafProgressModel.findById('ccaf-progress').lean()

const MOCK = {
  id: 'm1',
  date: '2026-09-20',
  label: 'Đề 1',
  correct: 44,
  domainPercents: [80, null, 70, 60, 90],
}

describe('PUT /api/ccaf - gate and order', () => {
  it('401 without the owner cookie, and nothing is written', async () => {
    const res = await put({ doneTaskIds: ['w1-0-0'] }, { cookie: null })
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Unauthorized' })
    expect(await stored()).toBeNull()
  })

  it('REQUIRE_ADMIN=false opens it outside production', async () => {
    process.env.REQUIRE_ADMIN = 'false'
    const res = await put({ doneTaskIds: ['w1-0-0'] }, { cookie: null })
    expect(res.status).toBe(200)
    expect((await stored())?.doneTaskIds).toEqual(['w1-0-0'])
  })

  it('REQUIRE_ADMIN=false is ignored in production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    process.env.REQUIRE_ADMIN = 'false'
    const res = await put({ doneTaskIds: ['w1-0-0'] }, { cookie: null })
    expect(res.status).toBe(401)
    expect(await stored()).toBeNull()
  })

  it('the 41st save in a minute is 429 with Retry-After, and nothing more is written', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    for (let i = 0; i < 40; i++)
      expect((await put({ examDate: '2026-10-01' })).status).toBe(200)

    const res = await put({ examDate: '2026-12-31' })
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: 'Too many requests' })
    expect(res.headers.get('retry-after')).toBe('40')
    expect((await stored())?.examDate).toBe('2026-10-01')
  })

  it('the limiter runs before the owner check: anonymous saves spend the bucket', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    for (let i = 0; i < 40; i++)
      expect((await put({}, { cookie: null })).status).toBe(401)
    expect((await put({})).status).toBe(429)
  })
})

describe('PUT /api/ccaf - validation', () => {
  it('415 for a body that is not declared JSON', async () => {
    const res = await put({}, { contentType: 'text/plain' })
    expect(res.status).toBe(415)
    expect(await res.json()).toEqual({
      error: 'Expected Content-Type: application/json',
    })
  })

  it('413 past 64 KB', async () => {
    const res = await put({ examDate: 'x'.repeat(64 * 1024) })
    expect(res.status).toBe(413)
    expect(await res.json()).toEqual({ error: 'Payload too large' })
    expect(await stored()).toBeNull()
  })

  it('400 for malformed JSON', async () => {
    const res = await put(undefined, { raw: '{"doneTaskIds": [' })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid JSON body' })
    expect(await stored()).toBeNull()
  })

  it('400 for a body that is not an object', async () => {
    for (const body of [null, [], 'tasks', 7]) {
      const res = await put(body)
      expect(res.status, JSON.stringify(body)).toBe(400)
      expect(await res.json()).toEqual({ error: 'Invalid progress state' })
    }
    expect(await stored()).toBeNull()
  })
})

describe('PUT /api/ccaf - what gets stored', () => {
  it('stores the sanitised state, both timestamps, and echoes the state', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)

    const res = await put({
      doneTaskIds: ['w1-0-1', 'not-a-task', 'w1-0-0', 'w1-0-1'],
      doneCheckIds: ['ck2', 'ck99', 'ck1'],
      confidence: [5, 9, -2, '3', 'x', 4],
      mocks: [MOCK, 'junk', { correct: 'many' }],
      examDate: '2026-10-05',
    })

    const state = {
      doneTaskIds: ['w1-0-0', 'w1-0-1'],
      doneCheckIds: ['ck1', 'ck2'],
      confidence: [5, 5, 0, 3, 0],
      mocks: [MOCK],
      examDate: '2026-10-05',
    }
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, state })
    expect(await stored()).toEqual({
      _id: 'ccaf-progress',
      ...state,
      createdAt: NOW,
      updatedAt: NOW,
    })
  })

  it('accepts the state wrapped as { state } too', async () => {
    const res = await put({ state: { doneTaskIds: ['w1-0-0'] } })
    expect(res.status).toBe(200)
    expect((await stored())?.doneTaskIds).toEqual(['w1-0-0'])
  })

  it('replaces rather than merges: an empty body clears every tick and keeps createdAt', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    await put({
      doneTaskIds: ['w1-0-0'],
      doneCheckIds: ['ck1'],
      confidence: [1, 2, 3, 4, 5],
      mocks: [MOCK],
      examDate: '2026-10-05',
    })

    const later = new Date(NOW.getTime() + 5_000)
    vi.setSystemTime(later)
    const res = await put({})

    expect(res.status).toBe(200)
    expect(await stored()).toEqual({
      _id: 'ccaf-progress',
      ...emptyState(),
      examDate: DEFAULT_EXAM_DATE,
      createdAt: NOW,
      updatedAt: later,
    })
  })

  it('fills in a mock label, date and id when they are missing', async () => {
    const res = await put({ mocks: [{ correct: 30 }] })
    const { state } = await res.json()
    expect(state.mocks).toEqual([
      {
        id: 'mock-0',
        date: DEFAULT_EXAM_DATE,
        label: 'Đề 1',
        correct: 30,
        domainPercents: [null, null, null, null, null],
      },
    ])
  })
})

describe('GET /api/ccaf', () => {
  it('401 without the owner cookie', async () => {
    const res = await get(null)
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Unauthorized' })
  })

  it('the empty state before any save', async () => {
    const res = await get()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ state: emptyState() })
  })

  it('reads back what PUT stored', async () => {
    await put({
      doneTaskIds: ['w1-0-0'],
      mocks: [MOCK],
      confidence: [1, 2, 3, 4, 5],
    })
    const res = await get()
    expect(await res.json()).toEqual({
      state: {
        doneTaskIds: ['w1-0-0'],
        doneCheckIds: [],
        confidence: [1, 2, 3, 4, 5],
        mocks: [MOCK],
        examDate: DEFAULT_EXAM_DATE,
      },
    })
  })
})
