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
import { AttemptModel } from '@/models/Attempt'
import { IqPaymentModel } from '@/models/IqPayment'
import { PaymentModel } from '@/models/Payment'
import { PostEventModel } from '@/models/PostEvent'
import { PostModel } from '@/models/Post'
import { RateLimitModel } from '@/models/RateLimit'
import { SubscriberModel } from '@/models/Subscriber'
import { TestEventModel } from '@/models/TestEvent'

import { mcpClient, type RouteHandler } from './mcp-helpers'

/**
 * The metrics tools (phase 3, mcp-plan.md T7, R11, premise 5).
 *
 * ```
 *   get_briefing   week vs the week before, every section · month: funnel left out with a
 *                  reason · 120 days: blog left out too · documents counted, never $sum count
 *   find_order     by code only · paid/unpaid · result email sent / not sent / not recorded (D2)
 *                  pii scope only, and audited
 *   personal data  no tool answer contains a seeded customer email or certificate name
 *   D2             fulfilment stamps resultEmailedAt only when the email went out
 * ```
 */

vi.hoisted(() => {
  process.env.PROFILE_DOCUMENT_ID = 'mcp-metrics-profile'
})

const deferred: (() => unknown)[] = []
vi.mock('next/server', async importOriginal => {
  const actual = await importOriginal<typeof import('next/server')>()
  return { ...actual, after: (fn: () => unknown) => deferred.push(fn) }
})
const flushAfter = async () => {
  while (deferred.length) await deferred.shift()!()
}

const DAY = 86_400_000
const NOW = Date.now()
const daysAgo = (days: number) => new Date(NOW - days * DAY)
const utcDay = (date: Date) => date.toISOString().slice(0, 10)

const EMAILS = [
  'buyer.one@example.com',
  'buyer.two@example.org',
  'reader@example.net',
]
const CERTIFICATE_NAMES = ['Nguyễn Văn Khách', 'Jane Q. Customer']

let memory: MongoMemoryServer
let client: ReturnType<typeof mcpClient>
let tokenLib: typeof import('@/lib/mcp/token')

beforeAll(async () => {
  memory = await MongoMemoryServer.create()
  process.env.MONGODB_URI = memory.getUri()
  process.env.AUTH_SECRET = 'mcp-metrics-secret'
  delete process.env.REQUIRE_ADMIN
  await mongoose.connect(memory.getUri())
  await Promise.all([
    AgentTokenModel.syncIndexes(),
    AgentActionModel.syncIndexes(),
    PaymentModel.syncIndexes(),
    IqPaymentModel.syncIndexes(),
  ])
  const route = await import('@/app/api/mcp/route')
  client = mcpClient(route.POST as RouteHandler, 'http://localhost/api/mcp')
  tokenLib = await import('@/lib/mcp/token')
}, 120_000)

afterAll(async () => {
  await mongoose.disconnect()
  await memory.stop()
})

afterEach(async () => {
  deferred.length = 0
  vi.restoreAllMocks()
  await Promise.all(
    [
      AgentTokenModel,
      AgentActionModel,
      AttemptModel,
      PaymentModel,
      IqPaymentModel,
      PostEventModel,
      PostModel,
      RateLimitModel,
      SubscriberModel,
      TestEventModel,
    ].map(model => (model as typeof PostModel).deleteMany({}))
  )
})

type Scope = 'read' | 'write' | 'publish' | 'pii'
const token = async (scopes: Scope[]) =>
  (await tokenLib.createAgentToken('agent', scopes)).token

type SeededOrder = {
  _id: mongoose.Types.ObjectId
  orderCode: number
  amount: number
  attemptToken: string
  createdAt: Date
  paidAt?: Date | null
}

function payment(
  overrides: Record<string, unknown>,
  product: 'mbti' | 'iq' = 'mbti'
): Promise<SeededOrder> {
  const base = {
    orderCode: Math.floor(Math.random() * 1e12),
    attemptToken: `attempt-${Math.random().toString(36).slice(2)}`,
    email: EMAILS[0],
    amount: 49_000,
    status: 'paid',
    locale: 'vi',
    linkExpiresAt: new Date(NOW + 600_000),
    createdAt: daysAgo(1),
    paidAt: daysAgo(1),
    resultEmailedAt: daysAgo(1),
    expireAt: null,
  }
  // Loosely typed on purpose: the seed rows are shaped by `base`, and both models accept them.
  const model = (product === 'mbti'
    ? PaymentModel
    : IqPaymentModel) as unknown as {
    create(doc: Record<string, unknown>): Promise<SeededOrder>
  }
  return model.create(
    product === 'mbti'
      ? { ...base, ...overrides }
      : { ...base, certificateName: CERTIFICATE_NAMES[0], ...overrides }
  )
}

const views = (slug: string, days: number[]) =>
  PostEventModel.insertMany(
    days.map((ago, i) => ({
      _id: `${slug}:view:${ago}:${i}`,
      slug,
      kind: 'view',
      count: 7, // re-fires: must never be summed
      createdAt: daysAgo(ago),
      expireAt: daysAgo(-100),
    }))
  )

function funnel(product: string, event: string, date: Date, count: number) {
  return {
    _id: `${product}:funnel:${event}:${utcDay(date)}`,
    product,
    kind: 'funnel',
    event,
    count,
    createdAt: date,
    expireAt: daysAgo(-20),
  }
}

async function seedWeek() {
  await PostModel.create([
    {
      slug: 'hot',
      title: 'Hot post',
      kind: 'article',
      status: 'published',
      publishedAt: daysAgo(30),
    },
    {
      slug: 'warm',
      title: 'Warm post',
      kind: 'article',
      status: 'published',
      publishedAt: daysAgo(30),
    },
  ])
  await views('hot', [1, 2, 3, 4]) // this week
  await views('warm', [2, 9, 10]) // one this week, two last week
  await views('hot', [8]) // last week
  await PostEventModel.create({
    _id: 'share:1',
    slug: 'hot',
    kind: 'share',
    count: 3,
    createdAt: daysAgo(2),
    expireAt: daysAgo(-100),
  })
  await SubscriberModel.create([
    {
      email: EMAILS[2],
      token: 't1',
      status: 'confirmed',
      confirmedAt: daysAgo(2),
    },
    {
      email: 'old@example.com',
      token: 't2',
      status: 'confirmed',
      confirmedAt: daysAgo(9),
    },
    {
      email: 'gone@example.com',
      token: 't3',
      status: 'unsubscribed',
      confirmedAt: daysAgo(40),
      unsubscribedAt: daysAgo(3),
    },
  ])
  await payment({ amount: 49_000, paidAt: daysAgo(1), email: EMAILS[0] })
  await payment({ amount: 49_000, paidAt: daysAgo(10), email: EMAILS[1] })
  await payment({
    status: 'pending',
    paidAt: null,
    resultEmailedAt: null,
    expireAt: daysAgo(-7),
  })
  await payment(
    {
      amount: 99_000,
      paidAt: daysAgo(2),
      certificateName: CERTIFICATE_NAMES[1],
      email: EMAILS[1],
    },
    'iq'
  )
  await TestEventModel.insertMany([
    funnel('mbti', 'paywall-seen', daysAgo(1), 10),
    funnel('mbti', 'paid', daysAgo(1), 2),
    funnel('mbti', 'paywall-seen', daysAgo(8), 4),
    funnel('mbti', 'paid', daysAgo(8), 2),
  ])
}

const briefing = async (t: string, args: Record<string, unknown> = {}) =>
  JSON.parse((await client.callTool(t, 'get_briefing', args)).text)

describe('get_briefing', () => {
  it('a week against the week before, every section, documents not re-fire counts', async () => {
    await seedWeek()
    const t = await token(['read'])
    const week = await briefing(t)

    expect(week.days).toBe(7)
    expect(week.blog).toMatchObject({
      included: true,
      views: { current: 5, previous: 3, change: 2 },
      shares: { current: 1, previous: 0 },
    })
    expect(week.blog.topPosts).toEqual([
      { slug: 'hot', title: 'Hot post', views: 4, previousViews: 1 },
      { slug: 'warm', title: 'Warm post', views: 1, previousViews: 2 },
    ])
    expect(week.subscribers).toMatchObject({
      included: true,
      confirmed: { current: 1, previous: 1 },
      unsubscribed: { current: 1, previous: 0 },
      activeNow: 2,
    })
    expect(week.orders).toMatchObject({
      included: true,
      currency: 'VND',
      byProduct: {
        mbti: {
          paid: { current: 1, previous: 1 },
          revenue: { current: 49_000, previous: 49_000 },
        },
        iq: {
          paid: { current: 1, previous: 0 },
          revenue: { current: 99_000, previous: 0 },
        },
      },
      total: {
        paid: { current: 2, previous: 1 },
        revenue: { current: 148_000, previous: 49_000 },
      },
    })
    expect(week.testFunnel.included).toBe(true)
    expect(week.testFunnel.byProduct.mbti).toMatchObject({
      paywallSeen: { current: 10, previous: 4 },
      paid: { current: 2, previous: 2 },
      conversion: { current: 0.2, previous: 0.5 },
    })
    expect(week.testFunnel.byProduct.iq.conversion).toEqual({
      current: null,
      previous: null,
    })
  })

  it('a month leaves the test funnel out with a reason, never computed over expired data', async () => {
    await seedWeek()
    const month = await briefing(await token(['read']), { period: 'month' })
    expect(month.days).toBe(30)
    expect(month.blog.included).toBe(true)
    expect(month.testFunnel).toEqual({
      included: false,
      reason: expect.stringMatching(/deleted after 21 days.*10 days or fewer/),
    })
  })

  it('past 90 days the blog section is left out too; orders and subscribers still answer', async () => {
    const long = await briefing(await token(['read']), { days: 120 })
    expect(long.blog).toEqual({
      included: false,
      reason: expect.stringMatching(/kept 180 days.*90 days or fewer/),
    })
    expect(long.orders.included).toBe(true)
    expect(long.subscribers.included).toBe(true)
  })

  it('a quarter (90 days) still fits the blog window', async () => {
    expect(
      (await briefing(await token(['read']), { period: 'quarter' })).blog
        .included
    ).toBe(true)
  })
})

describe('find_order', () => {
  it('one order by code: status, dates, amount and whether the email went out - nothing personal', async () => {
    const order = await payment({
      email: EMAILS[0],
      resultEmailedAt: new Date('2026-09-20T10:00:00Z'),
    })
    const t = await token(['pii'])
    const { text, isError } = await client.callTool(t, 'find_order', {
      orderCode: order.orderCode,
    })
    expect(isError).toBe(false)
    const found = JSON.parse(text)
    expect(found).toEqual({
      product: 'mbti',
      orderCode: order.orderCode,
      amount: 49_000,
      currency: 'VND',
      status: 'paid',
      createdAt: order.createdAt.toISOString(),
      paidAt: order.paidAt!.toISOString(),
      resultEmail: 'sent at 2026-09-20T10:00:00.000Z',
    })
    expect(text).not.toContain(EMAILS[0])
    expect(text).not.toContain(order.attemptToken)
  })

  it('names an IQ order, an email that was not sent, one never recorded, and an unpaid one', async () => {
    const t = await token(['pii'])
    const iq = await payment({ resultEmailedAt: null }, 'iq')
    const legacy = await payment({})
    await PaymentModel.updateOne(
      { _id: legacy._id },
      { $unset: { resultEmailedAt: 1 } }
    )
    const pending = await payment({
      status: 'pending',
      paidAt: null,
      resultEmailedAt: null,
    })

    const read = async (code: number) =>
      JSON.parse(
        (await client.callTool(t, 'find_order', { orderCode: code })).text
      )
    const iqOrder = await read(iq.orderCode)
    expect(iqOrder.product).toBe('iq')
    expect(iqOrder.resultEmail).toMatch(/^not sent/)
    expect((await read(legacy.orderCode)).resultEmail).toMatch(/^not recorded/)
    expect((await read(pending.orderCode)).resultEmail).toMatch(
      /^not applicable/
    )
  })

  it('an unknown code is a plain not-found', async () => {
    const call = await client.callTool(await token(['pii']), 'find_order', {
      orderCode: 123,
    })
    expect(call).toMatchObject({
      isError: true,
      text: 'No order with code 123.',
    })
  })

  it('takes a code and nothing else: an email argument is refused', async () => {
    const call = await client.callTool(await token(['pii']), 'find_order', {
      email: EMAILS[0],
    })
    expect(call.isError).toBe(true)
    expect(call.text).toMatch(/orderCode/)
  })

  it('needs the pii scope: a read token does not list it, and a call is refused and audited', async () => {
    const t = await token(['read'])
    expect(await client.toolNames(t)).not.toContain('find_order')
    const order = await payment({})
    const call = await client.callTool(t, 'find_order', {
      orderCode: order.orderCode,
    })
    expect(call.isError).toBe(true)
    expect(call.text).toMatch(/needs the pii scope/)
    await flushAfter()
    expect(
      await AgentActionModel.find(
        {},
        { tool: 1, outcome: 1, reason: 1, _id: 0 }
      ).lean()
    ).toEqual([{ tool: 'find_order', outcome: 'refused', reason: 'scope' }])
  })

  it('every lookup leaves one audit row, with the code as its target', async () => {
    const order = await payment({})
    const t = await token(['pii'])
    await client.callTool(t, 'find_order', { orderCode: order.orderCode })
    await client.callTool(t, 'find_order', { orderCode: 42 })
    await flushAfter()
    const rows = await AgentActionModel.find({}).sort({ at: 1, _id: 1 }).lean()
    expect(rows.map(row => [row.outcome, row.target?.id])).toEqual([
      ['ok', String(order.orderCode)],
      ['refused', '42'],
    ])
  })
})

describe('personal data (premise 5)', () => {
  it('no tool answer contains a seeded customer email or certificate name', async () => {
    await seedWeek()
    const codes = [
      ...(await PaymentModel.find({}, { orderCode: 1 }).lean()),
      ...(await IqPaymentModel.find({}, { orderCode: 1 }).lean()),
    ].map(row => row.orderCode)

    const t = await token(['read', 'pii'])
    const answers: string[] = []
    for (const args of [
      {},
      { period: 'month' },
      { period: 'quarter' },
      { days: 1 },
      { days: 365 },
    ])
      answers.push((await client.callTool(t, 'get_briefing', args)).text)
    for (const orderCode of codes)
      answers.push((await client.callTool(t, 'find_order', { orderCode })).text)
    answers.push((await client.callTool(t, 'list_posts', {})).text)
    answers.push((await client.callTool(t, 'get_me', {})).text)

    await flushAfter()
    const audit = JSON.stringify(await AgentActionModel.find({}).lean())

    for (const secret of [...EMAILS, ...CERTIFICATE_NAMES]) {
      for (const answer of answers) expect(answer).not.toContain(secret)
      expect(audit).not.toContain(secret)
    }
  })
})

describe('the weekly-briefing prompt', () => {
  it('is rendered for the token: it asks for get_briefing, and for a whiteboard card only when it can add one', async () => {
    const t = await token(['read'])
    const reply = await client.rpc(t, 'prompts/get', {
      name: 'weekly-briefing',
      arguments: { period: 'month' },
    })
    const text = reply.body.result?.messages?.[0].content.text ?? ''
    expect(text).toContain('Call get_briefing with period "month"')
    expect(text).toContain('left out')
    expect(text).not.toContain('whiteboard_add_item')
  })
})

describe('D2: fulfilment records the result email', () => {
  async function attempt() {
    const axis = { a: 5, b: 3 }
    const created = await AttemptModel.create({
      _id: `att-${Math.random().toString(36).slice(2)}`,
      type: 'INTJ',
      scores: { EI: axis, SN: axis, TF: axis, JP: axis },
      answers: ['a'],
      locale: 'vi',
      expireAt: daysAgo(-21),
    })
    return String(created._id)
  }

  it('stamps resultEmailedAt when deliver succeeds, and leaves it null when it throws', async () => {
    const { fulfilMbtiPayment } = await import('@/lib/payos-fulfil')
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const delivered = await payment({
      status: 'pending',
      paidAt: null,
      resultEmailedAt: null,
      attemptToken: await attempt(),
    })
    const result = await fulfilMbtiPayment(
      { orderCode: delivered.orderCode, amount: delivered.amount },
      async () => {}
    )
    expect(result.outcome).toBe('fulfilled')
    expect(
      (await PaymentModel.findById(delivered._id).lean())?.resultEmailedAt
    ).toBeInstanceOf(Date)

    const failed = await payment({
      status: 'pending',
      paidAt: null,
      resultEmailedAt: null,
      attemptToken: await attempt(),
    })
    const failure = await fulfilMbtiPayment(
      { orderCode: failed.orderCode, amount: failed.amount },
      async () => {
        throw new Error('SMTP down')
      }
    )
    expect(failure.outcome).toBe('delivery-failed')
    expect(
      (await PaymentModel.findById(failed._id).lean())?.resultEmailedAt
    ).toBeNull()
  })
})
