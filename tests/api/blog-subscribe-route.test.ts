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

import { SubscriberModel } from '@/models/Subscriber'

/**
 * The three public endpoints of the mailing list, which are one state machine with three doors.
 *
 * ```
 *   POST /api/blog/subscribe            ┌───────────┐  minted token, emailed
 *   ───────────────────────────────────▶│  pending  │  never receives a digest
 *                                       └───────────┘
 *                                             │ GET /subscribe/confirm?token=…
 *                                             ▼
 *                                       ┌───────────┐  confirmedAt stamped ONCE
 *                                       │ confirmed │
 *                                       └───────────┘
 *                                             │ GET /unsubscribe?token=…
 *                                             ▼
 *                                       ┌──────────────┐  TERMINAL. row retained.
 *                                       │ unsubscribed │
 *                                       └──────────────┘
 * ```
 *
 * ## The assertion this file mostly exists for: the endpoint is not an address oracle
 *
 * `POST /subscribe` returns the identical 202 and the identical message for a new address, an
 * address already pending, an address already confirmed, and an address that unsubscribed. If
 * any one of those answers differently, anybody can test whether a given person reads this
 * blog, one address at a time, and the 3/hour rate limit only slows it down.
 *
 * That property is invisible in the source - the handler looks like four branches that happen
 * to return the same constant - and it is exactly the kind of thing a later "helpful error
 * message" change destroys without anybody noticing. Hence a test per branch, all asserting
 * byte-identical output.
 *
 * ## Why the redirect handlers are tested through their Location header
 *
 * Both confirm and unsubscribe redirect to `/blog/subscribed?state=…` rather than rendering,
 * so the `state` parameter is their entire observable output. Everything the reader is told
 * is decided by which of five words ends up in that URL.
 *
 * ## What is mocked, and what is not
 *
 * `sendMail` only. It authenticates to Gmail in production, and "the confirmation email was
 * not sent" has to be provokable rather than waited for. `MONGODB_URI` points at the in-memory
 * server so each handler's own `connectDatabase()` does the connecting, exactly as in a
 * running server.
 */

const sendMail = vi.hoisted(() => vi.fn())
vi.mock('@/lib/mailer', () => ({ sendMail }))

let memory: MongoMemoryServer

beforeAll(async () => {
  memory = await MongoMemoryServer.create()
  process.env.MONGODB_URI = memory.getUri()
  process.env.NEXT_PUBLIC_SITE_URL = 'https://anhkhoa.info'
}, 120_000)

afterAll(async () => {
  await mongoose.disconnect()
  await memory.stop()
})

afterEach(async () => {
  await SubscriberModel.deleteMany({})
  await mongoose.connection.collection('mbtiRateLimits').deleteMany({})
  sendMail.mockReset()
})

/**
 * No `x-forwarded-for` by default.
 *
 * `SUBSCRIBE_LIMIT` is 3 per hour per IP and `checkRateLimit` skips the check entirely when
 * there is no client IP - it fails open, deliberately. Omitting the header keeps these cases
 * independent instead of having the fourth signup in the file 429 for reasons of its own.
 */
async function subscribe(body: unknown, headers: Record<string, string> = {}) {
  const { POST } = await import('@/app/api/blog/subscribe/route')
  const request = new Request('https://anhkhoa.info/api/blog/subscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

  return POST(request as never)
}

async function confirm(token: string) {
  const { GET } = await import('@/app/api/blog/subscribe/confirm/route')
  return GET(
    new NextRequest(
      `https://anhkhoa.info/api/blog/subscribe/confirm?token=${token}`
    )
  )
}

async function unsubscribe(token: string) {
  const { GET } = await import('@/app/api/blog/unsubscribe/route')
  return GET(
    new NextRequest(`https://anhkhoa.info/api/blog/unsubscribe?token=${token}`)
  )
}

/** The `state` a redirect handler put in the URL. Their whole observable output. */
function stateOf(response: Response): string | null {
  const location = response.headers.get('location')
  return location ? new URL(location).searchParams.get('state') : null
}

async function seedSubscriber(
  status: 'pending' | 'confirmed' | 'unsubscribed',
  email = 'reader@example.com',
  token = 'seeded-token'
) {
  return SubscriberModel.create({
    email,
    token,
    status,
    confirmedAt: status === 'confirmed' ? new Date('2026-01-01') : null,
  })
}

describe('signing up', () => {
  it('writes a pending row and emails a confirmation link', async () => {
    const response = await subscribe({ email: 'reader@example.com' })

    expect(response.status).toBe(202)

    const row = await SubscriberModel.findOne({
      email: 'reader@example.com',
    }).lean()

    expect(row?.status).toBe('pending')
    expect(row?.confirmedAt).toBeNull()
    expect(sendMail).toHaveBeenCalledTimes(1)
    expect(sendMail.mock.calls[0][0].to).toBe('reader@example.com')
    expect(sendMail.mock.calls[0][0].html).toContain(row?.token)
  })

  it('lowercases the address, so one person cannot become two rows', async () => {
    // Two rows means two confirmation emails and, later, two copies of every digest.
    await subscribe({ email: 'Reader@Example.COM' })
    await subscribe({ email: 'reader@example.com' })

    await expect(SubscriberModel.countDocuments({})).resolves.toBe(1)
  })

  it('trims surrounding whitespace rather than rejecting it', async () => {
    // Pasted from a password manager or a mail client, this is the common shape.
    const response = await subscribe({ email: '  reader@example.com  ' })

    expect(response.status).toBe(202)
    await expect(
      SubscriberModel.countDocuments({ email: 'reader@example.com' })
    ).resolves.toBe(1)
  })

  it('re-sends to a pending address without minting a second token', async () => {
    // The lost-email case. A new token would invalidate the link in the first message, so
    // somebody who clicks the older of two emails would be told their token is invalid.
    const seeded = await seedSubscriber('pending')

    await subscribe({ email: 'reader@example.com' })

    const row = await SubscriberModel.findOne({
      email: 'reader@example.com',
    }).lean()

    expect(row?.token).toBe(seeded.token)
    expect(sendMail).toHaveBeenCalledTimes(1)
  })
})

describe('the address oracle, which this endpoint must not be', () => {
  /**
   * Captured once from a fresh signup, then every other state is compared against it byte for
   * byte. Comparing to a literal would let the message and the test drift together.
   */
  async function bodyFor(
    status: 'fresh' | 'pending' | 'confirmed' | 'unsubscribed'
  ) {
    if (status !== 'fresh') await seedSubscriber(status)
    const response = await subscribe({ email: 'reader@example.com' })
    return { status: response.status, body: await response.text() }
  }

  it('answers identically for every state an address can be in', async () => {
    const fresh = await bodyFor('fresh')
    await SubscriberModel.deleteMany({})

    for (const status of ['pending', 'confirmed', 'unsubscribed'] as const) {
      const answer = await bodyFor(status)

      expect(answer, status).toEqual(fresh)

      await SubscriberModel.deleteMany({})
      sendMail.mockReset()
    }
  })

  it('does not email an address that already confirmed', async () => {
    // The response says "check your inbox" either way. Actually sending is what would turn the
    // endpoint into a way to mail somebody repeatedly without their involvement.
    await seedSubscriber('confirmed')

    await subscribe({ email: 'reader@example.com' })

    expect(sendMail).not.toHaveBeenCalled()
  })

  it('does not email, or resurrect, an address that unsubscribed', async () => {
    await seedSubscriber('unsubscribed')

    await subscribe({ email: 'reader@example.com' })

    const row = await SubscriberModel.findOne({
      email: 'reader@example.com',
    }).lean()

    expect(row?.status).toBe('unsubscribed')
    expect(sendMail).not.toHaveBeenCalled()
  })
})

describe('what signing up refuses', () => {
  it.each([
    ['no email at all', {}],
    ['an empty string', { email: '' }],
    ['whitespace only', { email: '   ' }],
    ['no at sign', { email: 'reader.example.com' }],
    ['no domain dot', { email: 'reader@example' }],
    ['a one-character tld', { email: 'reader@example.c' }],
    ['a space inside', { email: 'read er@example.com' }],
    ['a non-string', { email: 42 }],
  ])('400s on %s', async (_label, body) => {
    const response = await subscribe(body)

    expect(response.status).toBe(400)
    await expect(SubscriberModel.countDocuments({})).resolves.toBe(0)
    expect(sendMail).not.toHaveBeenCalled()
  })

  it('400s past the 254-character address limit', async () => {
    const response = await subscribe({
      email: `${'a'.repeat(250)}@example.com`,
    })

    expect(response.status).toBe(400)
  })

  it('413s on a body past the byte cap', async () => {
    const response = await subscribe({ email: `${'a'.repeat(4000)}@b.com` })

    expect(response.status).toBe(413)
  })

  it('400s on a body that is not JSON', async () => {
    expect((await subscribe('{ not json')).status).toBe(400)
  })

  it('throttles at three signups an hour from one connection', async () => {
    const headers = { 'x-forwarded-for': '203.0.113.20' }

    for (let index = 0; index < 3; index += 1)
      await subscribe({ email: `reader${index}@example.com` }, headers)

    const response = await subscribe({ email: 'reader4@example.com' }, headers)

    expect(response.status).toBe(429)
    expect(Number(response.headers.get('Retry-After'))).toBeGreaterThan(0)
  })
})

describe('mail that does not send', () => {
  it('still returns 202 and leaves the row pending', async () => {
    // The row is written first and the mail is a notification about something already recorded.
    // `pending` is read by no digest, so nothing ends up on a list it should not be on - the
    // only loss is the signup, and the person can try again.
    sendMail.mockRejectedValueOnce(new Error('smtp is down'))

    const response = await subscribe({ email: 'reader@example.com' })

    expect(response.status).toBe(202)
    await expect(
      SubscriberModel.findOne({ email: 'reader@example.com' }).lean()
    ).resolves.toMatchObject({ status: 'pending' })
  })
})

describe('confirming', () => {
  it('moves a pending row to confirmed and stamps the consent time', async () => {
    await seedSubscriber('pending')

    const response = await confirm('seeded-token')

    expect(response.status).toBe(303)
    expect(stateOf(response)).toBe('confirmed')

    const row = await SubscriberModel.findOne({ token: 'seeded-token' }).lean()

    expect(row?.status).toBe('confirmed')
    expect(row?.confirmedAt).toBeInstanceOf(Date)
  })

  it('stamps confirmedAt once, however many times the link is clicked', async () => {
    /*
      Write-once, the same reasoning as `Post.publishedAt`. This field is a consent record - the
      answer to "when did this person agree" - and a mail client that prefetches links, or a
      reader who clicks twice, must not be able to rewrite it to today.
    */
    await seedSubscriber('pending')

    await confirm('seeded-token')
    const first = await SubscriberModel.findOne({
      token: 'seeded-token',
    }).lean()

    await confirm('seeded-token')
    const second = await SubscriberModel.findOne({
      token: 'seeded-token',
    }).lean()

    expect(second?.confirmedAt).toEqual(first?.confirmedAt)
    expect(stateOf(await confirm('seeded-token'))).toBe('confirmed')
  })

  it('refuses to resurrect somebody who unsubscribed', async () => {
    // An old confirm link, clicked after leaving, must not put them back on the list.
    await seedSubscriber('unsubscribed')

    expect(stateOf(await confirm('seeded-token'))).toBe('unsubscribed')

    await expect(
      SubscriberModel.findOne({ token: 'seeded-token' }).lean()
    ).resolves.toMatchObject({ status: 'unsubscribed' })
  })

  it('sends an unknown or missing token to a page rather than a JSON dead end', async () => {
    // Far more likely to be an expired bookmark or a link mangled by a mail client than an
    // attack, and the person on the other end was trying to subscribe.
    expect(stateOf(await confirm('no-such-token'))).toBe('invalid')
    expect(stateOf(await confirm(''))).toBe('invalid')
  })

  it('redirects with 303, so a refresh does not re-issue the request', async () => {
    await seedSubscriber('pending')

    expect((await confirm('seeded-token')).status).toBe(303)
  })
})

describe('unsubscribing', () => {
  it('marks the row terminal and records when', async () => {
    await seedSubscriber('confirmed')

    const response = await unsubscribe('seeded-token')

    expect(stateOf(response)).toBe('unsubscribed')

    const row = await SubscriberModel.findOne({ token: 'seeded-token' }).lean()

    expect(row?.status).toBe('unsubscribed')
    expect(row?.unsubscribedAt).toBeInstanceOf(Date)
  })

  it('retains the row instead of deleting it', async () => {
    /*
      Deleting frees the unique email index, and then any later form submission re-adds the
      address as `pending` - so somebody who deliberately left starts receiving confirmation
      emails again. The retained row is what makes `unsubscribed` terminal.
    */
    await seedSubscriber('confirmed')

    await unsubscribe('seeded-token')

    await expect(SubscriberModel.countDocuments({})).resolves.toBe(1)
  })

  it('works on a pending row too', async () => {
    // Somebody who signed up, got the confirmation mail, and decided against it.
    await seedSubscriber('pending')

    await unsubscribe('seeded-token')

    await expect(
      SubscriberModel.findOne({ token: 'seeded-token' }).lean()
    ).resolves.toMatchObject({ status: 'unsubscribed' })
  })

  it('does not move unsubscribedAt on a second click', async () => {
    await seedSubscriber('confirmed')

    await unsubscribe('seeded-token')
    const first = await SubscriberModel.findOne({
      token: 'seeded-token',
    }).lean()

    await unsubscribe('seeded-token')
    const second = await SubscriberModel.findOne({
      token: 'seeded-token',
    }).lean()

    expect(second?.unsubscribedAt).toEqual(first?.unsubscribedAt)
  })

  it('reports success for a token that does not exist', async () => {
    /*
      Two reasons, and both matter. The person clicking wants to stop receiving email: an error
      page tells them they failed at something they cannot fix, and the next thing they reach
      for is the spam button, which costs the sending domain rather than one subscriber. And
      distinguishing a real token from an invented one here would let somebody probe which
      tokens exist.
    */
    expect(stateOf(await unsubscribe('no-such-token'))).toBe('unsubscribed')
    expect(stateOf(await unsubscribe(''))).toBe('unsubscribed')
  })
})
