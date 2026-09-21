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

import { ContactMessageModel } from '@/models/ContactMessage'

/**
 * `/api/contact`, against a real server, exercising the handler itself.
 *
 * ```
 *   connect ──▶ rate limit ──▶ byte cap ──▶ parse ──▶ field caps ──▶ PERSIST ──▶ mail
 *                                                                      │          │
 *                                                            500 if this fails    │
 *                                                                                 │
 *                                                        200 EVEN IF THIS FAILS ──┘
 * ```
 *
 * The bug this file locks out: `sendMail` used to be the only write in the handler. There
 * was no `connectDatabase()` anywhere in it and no collection behind it, so a mail failure
 * *destroyed* the submission and returned a 500 asking the visitor to try again - from
 * nothing. Every assertion about ordering below is about that.
 *
 * ## Why this is a route-handler test when `tests/api/` had none
 *
 * `tests/api/` held only model-level tests before this, and the plan for this work noted
 * that any handler containing `revalidatePath` cannot be invoked directly under vitest -
 * it throws `Invariant: static generation store missing`. This handler contains no
 * `revalidatePath`, so direct invocation works, and it is the only way to assert on the
 * *ordering*, which is where the correctness lives.
 *
 * ## Two things are mocked, and only two
 *
 * `sendMail`, because the real one authenticates to Gmail - and because "mail failed" is a
 * case that has to be provoked rather than waited for. `MONGODB_URI` points at the
 * in-memory server so the handler's own `connectDatabase()` does the connecting, exactly as
 * it would in production; nothing here connects on the handler's behalf.
 *
 * ## Why most requests carry no `x-forwarded-for`
 *
 * `CONTACT_LIMIT` is 3 per hour per IP, and `checkRateLimit` skips the check entirely when
 * there is no client IP (it fails open, deliberately and with a comment saying so). Sending
 * no IP header therefore keeps these cases independent of one another instead of having the
 * fourth test in the file 429. The limiter gets its own test below, with an IP.
 */

const sendMail = vi.hoisted(() => vi.fn())
vi.mock('@/lib/mailer', () => ({ sendMail }))

let memory: MongoMemoryServer

beforeAll(async () => {
  memory = await MongoMemoryServer.create()
  process.env.MONGODB_URI = memory.getUri()
  process.env.MAIL_TO = 'owner@example.com'
}, 120_000)

afterAll(async () => {
  await mongoose.disconnect()
  await memory.stop()
})

afterEach(async () => {
  await ContactMessageModel.deleteMany({})
  await mongoose.connection.collection('mbtiRateLimits').deleteMany({})
  sendMail.mockReset()

  // The mail budget is module-level state in a single-process suite, so without this every
  // mail any test sends is charged to the same 20/hour ceiling and the file silently
  // couples to itself. The failure would not land on whoever broke it - it lands on
  // whoever adds the twenty-first mailing test, as unrelated cases going red with
  // `mailed: false` and nothing to point at.
  const { resetMailBudgetForTests } = await import('@/app/api/contact/route')
  resetMailBudgetForTests()
})

/** Imported lazily so the mailer mock and `MONGODB_URI` are both in place first. */
async function post(body: unknown, headers: Record<string, string> = {}) {
  const { POST } = await import('@/app/api/contact/route')
  const request = new Request('https://anhkhoa.info/api/contact', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
  // The handler's `NextRequest` use is limited to `request.cookies`-free header reads, so a
  // plain `Request` is a faithful stand-in and avoids constructing a Next runtime.
  return POST(request as never)
}

const VALID = {
  email: 'someone@example.com',
  firstname: 'Some',
  lastname: 'One',
  subject: 'Work',
  message: 'Hello, I would like to talk about a project.',
}

describe('POST /api/contact - the attribution fields are optional', () => {
  /**
   * MANDATORY REGRESSION. The portfolio form at `/` predates all three attribution fields
   * and must keep working untouched. A required field here would mean the existing form
   * submits a document that fails validation - the same data loss in a new costume.
   */
  it('still succeeds when all three attribution fields are blank', async () => {
    const response = await post(VALID)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })

    const saved = await ContactMessageModel.findOne({}).lean()
    expect(saved, 'nothing was persisted').not.toBeNull()
    expect(saved?.sourceSlug).toBeNull()
    expect(saved?.heardAbout).toBeNull()
    expect(saved?.message).toBe(VALID.message)
  })

  it('persists heardAbout when the visitor filled it in', async () => {
    await post({ ...VALID, heardAbout: 'A friend sent me the MBTI test' })

    const saved = await ContactMessageModel.findOne({}).lean()
    expect(saved?.heardAbout).toBe('A friend sent me the MBTI test')
  })

  it('persists a well-formed sourceSlug', async () => {
    await post({ ...VALID, sourceSlug: 'revalidate-tag-did-not-invalidate' })

    const saved = await ContactMessageModel.findOne({}).lean()
    expect(saved?.sourceSlug).toBe('revalidate-tag-did-not-invalidate')
  })

  it('drops a malformed sourceSlug but KEEPS the message', async () => {
    // The one asymmetry in the handler. Every other field is typed by the visitor, so a 400
    // naming it is actionable; this one is supplied by our own client and is invisible to
    // them. Rejecting it would destroy a real message to protect an analytics field.
    const response = await post({ ...VALID, sourceSlug: '../../etc/passwd' })

    expect(response.status).toBe(200)
    const saved = await ContactMessageModel.findOne({}).lean()
    expect(
      saved,
      'the message was thrown away with the bad slug'
    ).not.toBeNull()
    expect(saved?.sourceSlug).toBeNull()
  })
})

describe('POST /api/contact - persistence outranks mail', () => {
  it('returns 200 and keeps the message when mail fails', async () => {
    sendMail.mockRejectedValueOnce(
      new Error('Invalid login: 535 authentication failed')
    )

    const response = await post(VALID)

    // The deliberate behaviour change from the 500 this used to return. The visitor asked
    // to send a message and the message is stored; the thing that broke is not something
    // they can act on, and telling them it failed invites a duplicate or a giving-up.
    expect(response.status).toBe(200)

    const saved = await ContactMessageModel.findOne({}).lean()
    expect(
      saved,
      'THE BUG: a mail failure destroyed the submission'
    ).not.toBeNull()
    // How the owner finds the messages that never reached an inbox.
    expect(saved?.mailed).toBe(false)
  })

  it('marks the row mailed once mail succeeds', async () => {
    sendMail.mockResolvedValueOnce(undefined)

    await post(VALID)

    const saved = await ContactMessageModel.findOne({}).lean()
    expect(saved?.mailed).toBe(true)
  })

  it('sends the attribution fields on to the owner, escaped', async () => {
    sendMail.mockResolvedValueOnce(undefined)

    await post({
      ...VALID,
      sourceSlug: 'a-post',
      heardAbout: '<script>alert(1)</script> a friend',
    })

    expect(sendMail).toHaveBeenCalledTimes(1)
    const mail = sendMail.mock.calls[0][0] as { html: string; text: string }
    expect(mail.html).toContain('/blog/a-post')
    expect(mail.text).toContain(
      'Heard about me via: <script>alert(1)</script> a friend'
    )
    // The owner's mail client would run this if the renderer stopped escaping.
    expect(mail.html).not.toContain('<script>')
    expect(mail.html).toContain('&lt;script&gt;')
  })

  it('returns 500 and does not mail when the message cannot be persisted', async () => {
    const create = vi
      .spyOn(ContactMessageModel, 'create')
      .mockRejectedValueOnce(new Error('E11000 or a dropped connection'))

    const response = await post(VALID)

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('email me directly'),
    })
    // Nothing recorded it anywhere, so there is nothing to notify anyone about.
    expect(sendMail).not.toHaveBeenCalled()

    create.mockRestore()
  })
})

describe('POST /api/contact - a malformed or oversized body is not a 500', () => {
  it('returns 400 on unparseable JSON', async () => {
    const response = await post('{"email": ')

    expect(response.status).toBe(400)
    // Never the parser's own text - `JSON.parse` echoes a slice of the input back.
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid JSON body',
    })
  })

  it('returns 413 on a body over the cap even with NO Content-Length to go by', async () => {
    /**
     * The point of S-13, and the reason the cap is not on the header.
     *
     * A `ReadableStream` body makes the request chunked: `Content-Length` is absent
     * entirely, so a handler that bounded on the header would have nothing to compare and
     * would accept this. The cap is on `Buffer.byteLength(await request.text())`, which is
     * the body as measured rather than as claimed.
     */
    const huge = JSON.stringify({ ...VALID, message: 'x'.repeat(64 * 1024) })
    const request = new Request('https://anhkhoa.info/api/contact', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(huge))
          controller.close()
        },
      }),
      // @ts-expect-error - undici requires this for a stream body; it is not in the DOM types.
      duplex: 'half',
    })
    expect(
      request.headers.get('content-length'),
      'chunked, so there is no header'
    ).toBeNull()

    const { POST } = await import('@/app/api/contact/route')
    const response = await POST(request as never)

    expect(response.status).toBe(413)
    expect(await ContactMessageModel.countDocuments({})).toBe(0)
  })

  it('returns 400 naming the field when one is too long', async () => {
    const response = await post({ ...VALID, message: 'x'.repeat(5001) })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('message'),
    })
  })

  it('returns 400 when a required field is missing', async () => {
    const response = await post({ email: 'a@b.co' })

    expect(response.status).toBe(400)
    expect(await ContactMessageModel.countDocuments({})).toBe(0)
  })

  it('accepts a message whose 5000 characters are multi-byte', async () => {
    // The field caps are in characters and the body cap is in bytes. Vietnamese is 2-3
    // bytes per character, so a legitimate maximum-length message is ~15KB on the wire -
    // this is the case a byte cap sized from the character counts would have rejected.
    sendMail.mockResolvedValueOnce(undefined)
    const response = await post({ ...VALID, message: 'à'.repeat(5000) })

    expect(response.status).toBe(200)
    expect(await ContactMessageModel.countDocuments({})).toBe(1)
  })
})

describe('POST /api/contact - the rate limit', () => {
  it('429s the fourth submission from one IP within the window', async () => {
    sendMail.mockResolvedValue(undefined)
    const ip = { 'x-forwarded-for': '203.0.113.7' }

    for (let i = 0; i < 3; i += 1)
      expect((await post(VALID, ip)).status, `submission ${i + 1}`).toBe(200)

    const fourth = await post(VALID, ip)
    expect(fourth.status).toBe(429)
    expect(fourth.headers.get('Retry-After')).toBeTruthy()
    // The limit protects a mailbox, so the refused one must not have mailed either.
    expect(sendMail).toHaveBeenCalledTimes(3)
    expect(await ContactMessageModel.countDocuments({})).toBe(3)
  })

  it('writes its counter to Mongo, which is why connect comes first', async () => {
    // `checkRateLimit` upserts a `RateLimit` document. If `connectDatabase()` ran after it
    // on a cold invocation, that write would throw, the limiter would catch it and fail
    // OPEN, and the route would look like it was throttling while throttling nothing. The
    // presence of this document is the evidence the limiter actually ran.
    await post(VALID, { 'x-forwarded-for': '203.0.113.9' })

    // `mbtiRateLimits` is the one collection every bucket shares - the name predates the
    // second product, and `rate-limit.ts` keys routes apart inside the `_id` instead:
    // `<route>:<ip>:<window>`. Read back and filtered here rather than queried with a
    // `$regex`, which the driver's filter types reject on an untyped collection.
    const rows = await mongoose.connection
      .collection('mbtiRateLimits')
      .find({})
      .toArray()
    const buckets = rows.filter(row =>
      String(row._id).startsWith('contact:203.0.113.9:')
    )

    expect(buckets, 'the limiter never wrote, so it never ran').toHaveLength(1)
    expect(buckets[0].count).toBe(1)
  })
})

describe('POST /api/contact - the process-local mail budget', () => {
  /**
   * The second door on the mail path, and until now the only control in this handler that
   * nothing asserted.
   *
   * It exists because `CONTACT_LIMIT` fails open on a missing client IP and on a Mongo
   * error - the two conditions that make a relayed spam run likely are the two that switch
   * the first door off. So this ceiling has to hold when the limiter does not, which is
   * precisely the state these tests run in: `post()` sends no `x-forwarded-for`, so
   * `checkRateLimit` skips the check entirely and the budget is the only thing left.
   */
  it('stops mailing after 20 in a window, and STILL persists every message', async () => {
    sendMail.mockResolvedValue(undefined)

    for (let i = 0; i < 20; i += 1)
      expect((await post(VALID)).status, `submission ${i + 1}`).toBe(200)

    expect(
      sendMail,
      'the budget refused a mail it should have allowed'
    ).toHaveBeenCalledTimes(20)

    const overBudget = await post(VALID)

    // The whole point: what the ceiling drops is a NOTIFICATION, never a message. A 4xx
    // here would mean the abuse control had started destroying correspondence, which is the
    // bug this entire file exists to keep out of the handler.
    expect(overBudget.status).toBe(200)
    expect(sendMail, 'the 21st mail escaped the ceiling').toHaveBeenCalledTimes(
      20
    )
    expect(await ContactMessageModel.countDocuments({})).toBe(21)

    const unmailed = await ContactMessageModel.countDocuments({ mailed: false })
    expect(
      unmailed,
      'the dropped notification is not discoverable from the rows'
    ).toBe(1)
  })

  it('refuses nothing once the window rolls', async () => {
    // Guards the guard. A ceiling that never reset would look identical to a working one in
    // the test above, and would then silently stop mailing this site forever after the
    // twentieth message of its life.
    sendMail.mockResolvedValue(undefined)

    for (let i = 0; i < 20; i += 1) await post(VALID)
    expect(sendMail).toHaveBeenCalledTimes(20)

    const { resetMailBudgetForTests } = await import('@/app/api/contact/route')
    resetMailBudgetForTests()

    expect((await post(VALID)).status).toBe(200)
    expect(sendMail).toHaveBeenCalledTimes(21)
  })
})

describe('POST /api/contact - a failed mailed-flag write is not reported as a failed send', () => {
  /**
   * The row cannot tell these apart and never will: if the `mailed: true` write is what
   * failed, the row keeps `mailed: false` whatever we do about it. So the log is the only
   * thing carrying the distinction, and an operator acting on the wrong one re-sends a
   * message the recipient already has.
   */
  it('logs that the mail WAS sent when only the flag write fails', async () => {
    sendMail.mockResolvedValueOnce(undefined)
    const updateOne = vi
      .spyOn(ContactMessageModel, 'updateOne')
      .mockRejectedValueOnce(new Error('connection dropped mid-write'))
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})

    const response = await post(VALID)

    expect(response.status).toBe(200)
    expect(sendMail, 'the mail really did go out').toHaveBeenCalledTimes(1)

    const lines = logged.mock.calls.map(call => String(call[0]))
    expect(
      lines.some(line => line.includes('WAS emailed')),
      'the operator is not told the message was delivered'
    ).toBe(true)
    expect(
      lines.some(line => line.includes('mail failed')),
      'THE BUG: a failed flag write was reported as a failed send, so the owner re-sends'
    ).toBe(false)

    updateOne.mockRestore()
    logged.mockRestore()
  })
})

describe('ContactMessage retention', () => {
  /**
   * NON-NEGOTIABLE, asserted deliberately so nobody adds one by pattern-matching.
   *
   * Every other collection holding stranger data has a TTL index, and
   * `tests/api/retention.test.ts` exists because a TTL index that fails to build is silent.
   * So the absence of one here looks exactly like the omission those tests were written to
   * catch, and a future reader would "fix" it in good faith.
   *
   * It is not an omission. A contact message is correspondence - somebody wrote to a person
   * and is waiting for a reply - and expiring it would delete the owner's inbox on a timer.
   * See the model's doc comment for what makes that defensible rather than negligent.
   */
  it('has NO TTL index, deliberately', async () => {
    await ContactMessageModel.syncIndexes()
    const indexes = (await ContactMessageModel.collection.indexes()) as Record<
      string,
      unknown
    >[]

    const ttl = indexes.find(index => index.expireAfterSeconds !== undefined)
    expect(
      ttl,
      'a TTL index appeared on ContactMessage - it expires the owner\'s own correspondence. Read the model doc comment before "restoring" symmetry with Attempt/TestEvent.'
    ).toBeUndefined()
  })

  it('indexes createdAt, which is the only order the owner board reads', async () => {
    await ContactMessageModel.syncIndexes()
    const indexes = (await ContactMessageModel.collection.indexes()) as Record<
      string,
      unknown
    >[]

    const byDate = indexes.find(index => {
      const key = index.key as Record<string, number> | undefined
      return key?.createdAt !== undefined
    })
    expect(byDate).toBeDefined()
  })
})
