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
import { TestEventModel, testEventExpiryFrom } from '@/models/TestEvent'

/**
 * `GET /api/admin/metrics`, pinned against the route as it stood before the MCP work moved
 * its funnel logic into `lib/metrics/tests.ts` (mcp-plan.md R10).
 *
 * ```
 *   GET ──▶ owner gate ──▶ per product in TEST_PRODUCTS:
 *            401            funnel      $sum count per event   (day buckets: summing IS right)
 *                           shares      countDocuments         (one doc = one share)
 *                           attributions countDocuments
 *                           shareRate   attributions / shares, null with no shares
 *                           abandonment { sessions, medianFurthest }  (skip-to-middle, 0 -> null)
 * ```
 *
 * Asserted field by field for a seeded fixture, not snapshotted, so a changed number names
 * itself. The briefing reuses exactly these numbers, which is why they are pinned before the
 * move. Unmodified through the extraction.
 */

const URL = 'http://localhost/api/admin/metrics'

type Handler = (request: NextRequest) => Promise<Response>
let memory: MongoMemoryServer
let GET: Handler

beforeAll(async () => {
  memory = await MongoMemoryServer.create()
  process.env.MONGODB_URI = memory.getUri()
  process.env.AUTH_SECRET = 'admin-metrics-secret'
  delete process.env.REQUIRE_ADMIN
  await mongoose.connect(memory.getUri())
  ;({ GET } = (await import('@/app/api/admin/metrics/route')) as never)
}, 120_000)

afterAll(async () => {
  await mongoose.disconnect()
  await memory.stop()
})

afterEach(async () => {
  vi.unstubAllEnvs()
  delete process.env.REQUIRE_ADMIN
  await TestEventModel.deleteMany({})
})

const ownerCookie = () =>
  `${getAuthCookieName()}=${makeAuthToken(Date.now() + 3_600_000)}`

function get(cookie: string | null = ownerCookie()) {
  return GET(new NextRequest(URL, { headers: cookie ? { cookie } : undefined }))
}

const expireAt = testEventExpiryFrom(new Date())

function funnel(product: string, event: string, day: string, count: number) {
  return {
    _id: `${product}:funnel:${event}:${day}`,
    product,
    kind: 'funnel',
    event,
    count,
    expireAt,
  }
}

function share(product: string, token: string, count = 1) {
  return {
    _id: `${product}:share:${token}`,
    product,
    kind: 'share',
    count,
    data: { type: 'link' },
    expireAt,
  }
}

function attribute(product: string, token: string, session: string, count = 1) {
  return {
    _id: `${product}:attribute:${token}:${session}`,
    product,
    kind: 'attribute',
    count,
    expireAt,
  }
}

function progress(product: string, session: string, furthest: number) {
  return {
    _id: `${product}:progress:${session}`,
    product,
    kind: 'progress',
    count: 3,
    data: { furthest, total: 60 },
    expireAt,
  }
}

const EMPTY = {
  funnel: {},
  shares: 0,
  attributions: 0,
  shareRate: null,
  abandonment: { sessions: 0, medianFurthest: null },
}

describe('GET /api/admin/metrics - owner gate', () => {
  it('401 without the owner cookie', async () => {
    const res = await get(null)
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Unauthorized' })
  })

  it('401 with a forged cookie', async () => {
    const res = await get(`${getAuthCookieName()}=forged.token`)
    expect(res.status).toBe(401)
  })

  it('REQUIRE_ADMIN=false opens it outside production', async () => {
    process.env.REQUIRE_ADMIN = 'false'
    expect((await get(null)).status).toBe(200)
  })

  it('REQUIRE_ADMIN=false is ignored in production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    process.env.REQUIRE_ADMIN = 'false'
    expect((await get(null)).status).toBe(401)
  })
})

describe('GET /api/admin/metrics - the numbers', () => {
  it('every product renders its zeros before any event', async () => {
    const res = await get()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ products: { mbti: EMPTY, iq: EMPTY } })
  })

  it('a seeded fixture, field by field', async () => {
    await TestEventModel.insertMany([
      // Funnel: day buckets, summed by event across days.
      funnel('mbti', 'result-viewed', '2026-09-20', 40),
      funnel('mbti', 'result-viewed', '2026-09-21', 60),
      funnel('mbti', 'paywall-seen', '2026-09-21', 30),
      funnel('mbti', 'checkout-started', '2026-09-21', 6),
      funnel('mbti', 'paid', '2026-09-21', 3),
      // Shares and attributions: documents, never the re-fire count.
      share('mbti', 'a', 5),
      share('mbti', 'b'),
      share('mbti', 'c'),
      share('mbti', 'd'),
      attribute('mbti', 'a', 's1', 9),
      attribute('mbti', 'a', 's2'),
      attribute('mbti', 'b', 's3'),
      // Abandonment: three sessions, the middle one by furthest.
      progress('mbti', 'p1', 25),
      progress('mbti', 'p2', 3),
      progress('mbti', 'p3', 10),
      // Another product's rows stay in their own product.
      funnel('iq', 'paid', '2026-09-21', 2),
      share('iq', 'z'),
      progress('iq', 'q1', 7),
      progress('iq', 'q2', 1),
      progress('iq', 'q3', 20),
      progress('iq', 'q4', 12),
    ])

    const res = await get()
    expect(res.status).toBe(200)
    const { products } = await res.json()

    expect(Object.keys(products).sort()).toEqual(['iq', 'mbti'])

    expect(products.mbti.funnel).toEqual({
      'result-viewed': 100,
      'paywall-seen': 30,
      'checkout-started': 6,
      paid: 3,
    })
    expect(products.mbti.shares).toBe(4)
    expect(products.mbti.attributions).toBe(3)
    expect(products.mbti.shareRate).toBe(0.75)
    expect(products.mbti.abandonment).toEqual({
      sessions: 3,
      medianFurthest: 10,
    })

    expect(products.iq.funnel).toEqual({ paid: 2 })
    expect(products.iq.shares).toBe(1)
    expect(products.iq.attributions).toBe(0)
    expect(products.iq.shareRate).toBe(0)
    // An even count takes the upper middle: sorted 1, 7, 12, 20, skip 2.
    expect(products.iq.abandonment).toEqual({
      sessions: 4,
      medianFurthest: 12,
    })
  })

  it('attributions with no shares give a null share rate, not Infinity', async () => {
    await TestEventModel.insertMany([attribute('mbti', 'gone', 's1')])
    const { products } = await (await get()).json()
    expect(products.mbti.attributions).toBe(1)
    expect(products.mbti.shareRate).toBeNull()
  })

  it('a median furthest of 0 reads as null', async () => {
    await TestEventModel.insertMany([
      progress('mbti', 'p1', 0),
      progress('mbti', 'p2', 0),
      progress('mbti', 'p3', 5),
    ])
    const { products } = await (await get()).json()
    expect(products.mbti.abandonment).toEqual({
      sessions: 3,
      medianFurthest: null,
    })
  })

  it('a database failure is a 500 with a fixed message', async () => {
    vi.spyOn(TestEventModel, 'aggregate').mockImplementation(() => {
      throw new Error('connection reset')
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await get()
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Metrics unavailable' })
  })
})
