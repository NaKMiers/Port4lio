import { MongoMemoryServer } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { PostEventModel } from '@/models/PostEvent'

/**
 * `POST /api/blog/event` - the only anonymous, unauthenticated Mongo write the blog has.
 *
 * ```
 *   connect ──▶ rate limit ──▶ byte cap ──▶ parse ──▶ kind ──▶ slug ──▶ sessionId ──▶ token
 *                                                                                      │
 *                                                                        recordPostEvent
 *                                                                                      │
 *                                                                          204, always ─┘
 * ```
 *
 * Every other blog route is behind the owner gate. This one is reachable from the open
 * internet by anybody with curl, it writes to a collection, and the value the caller supplies
 * ends up inside a document `_id`. That combination is why the handler has five guards where
 * a beacon endpoint would normally have two, and why it is worth a test file of its own rather
 * than being left to `blog-post-events.test.ts`, which covers the library underneath it.
 *
 * The two guards that are not obvious, and that a refactor would plausibly remove:
 *
 * 1. **`sessionId` is validated before it is used, not after.** It goes straight into the
 *    `_id`, so an unvalidated one lets a stranger choose a primary key in our database. The
 *    charset excludes `:` specifically because the id grammar is `blog:<kind>:<subject>` - a
 *    session containing a colon can forge a row belonging to a different kind - and the length
 *    bound is what stops somebody putting 10MB in an indexed field.
 * 2. **204 on a failed write, 4xx on a failed validation.** The caller is a `fetch` in a
 *    reader's browser that can do nothing useful with an error, and the reader is the one who
 *    arrived from a cross-post. A validation failure is our own client being wrong, which is
 *    worth hearing about; a Mongo blip is not worth console noise on their page.
 *
 * ## No `x-forwarded-for` on most requests, deliberately
 *
 * `BLOG_EVENT_LIMIT` is 60/minute/IP and `checkRateLimit` skips the check entirely when there
 * is no client IP. Sending no IP header keeps these cases independent instead of having the
 * sixty-first assertion in the file turn red for reasons that have nothing to do with it. The
 * limiter gets its own test, with an IP.
 */

let memory: MongoMemoryServer

beforeAll(async () => {
  memory = await MongoMemoryServer.create()
  process.env.MONGODB_URI = memory.getUri()
}, 120_000)

afterAll(async () => {
  await mongoose.disconnect()
  await memory.stop()
})

afterEach(async () => {
  await PostEventModel.deleteMany({})
  await mongoose.connection.collection('mbtiRateLimits').deleteMany({})
})

/** Imported lazily so `MONGODB_URI` is in place before the route module is evaluated. */
async function post(body: unknown, headers: Record<string, string> = {}) {
  const { POST } = await import('@/app/api/blog/event/route')
  const request = new Request('https://anhkhoa.info/api/blog/event', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

  return POST(request as never)
}

const VIEW = {
  kind: 'view',
  slug: 'revalidatepath-did-nothing',
  sessionId: 'abc123_session-id',
}

describe('the happy path', () => {
  it('accepts a view and answers 204 with no body', async () => {
    const response = await post(VIEW)

    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')
  })

  it('writes one document, keyed by the post and the reader', async () => {
    await post(VIEW)

    const events = await PostEventModel.find({}).lean()

    expect(events).toHaveLength(1)
    expect(events[0]._id).toBe(
      'blog:view:revalidatepath-did-nothing:abc123_session-id'
    )
    expect(events[0].slug).toBe('revalidatepath-did-nothing')
  })

  it('counts one reader refreshing five times as one reader', async () => {
    /*
      The metric is DOCUMENTS, never a sum of `count`, and this is the behaviour that makes that
      rule work: the subject is inside the `_id`, so a re-fire updates the row instead of adding
      a sibling. Without it a single reader with a twitchy finger is five readers on the board.
    */
    for (let index = 0; index < 5; index += 1) await post(VIEW)

    const events = await PostEventModel.find({}).lean()

    expect(events).toHaveLength(1)
    expect(events[0].count).toBe(5)
  })

  it('keeps two readers of one post apart', async () => {
    await post(VIEW)
    await post({ ...VIEW, sessionId: 'a-different-session' })

    await expect(PostEventModel.countDocuments({})).resolves.toBe(2)
  })

  it('keeps one reader of two posts apart', async () => {
    await post(VIEW)
    await post({ ...VIEW, slug: 'another-post' })

    await expect(PostEventModel.countDocuments({})).resolves.toBe(2)
  })
})

describe('the subject grammar, which differs per kind on purpose', () => {
  it('keys a share by the token alone, so one link is one row however often it is clicked', async () => {
    await post({
      kind: 'share',
      slug: 'a-post',
      sessionId: 'sharer-session',
      token: 'tok_abc',
    })

    const [event] = await PostEventModel.find({}).lean()

    expect(event._id).toBe('blog:share:tok_abc')
  })

  it('keys an attribution by token AND arriving session', async () => {
    // Ten people arriving from one shared link is ten documents; one of them refreshing is
    // none extra. Keying on the token alone would collapse the ten into one.
    await post({
      kind: 'attribute',
      slug: 'a-post',
      sessionId: 'arriver-one',
      token: 'tok_abc',
    })
    await post({
      kind: 'attribute',
      slug: 'a-post',
      sessionId: 'arriver-two',
      token: 'tok_abc',
    })

    const ids = (await PostEventModel.find({}).lean()).map(event => event._id)

    expect(ids.sort()).toEqual([
      'blog:attribute:tok_abc:arriver-one',
      'blog:attribute:tok_abc:arriver-two',
    ])
  })
})

describe('what the handler refuses', () => {
  it.each([
    ['an unknown kind', { ...VIEW, kind: 'delete' }, 'Unknown event kind.'],
    [
      'a missing kind',
      { slug: 'a-post', sessionId: 'abc' },
      'Unknown event kind.',
    ],
    ['a non-string kind', { ...VIEW, kind: 7 }, 'Unknown event kind.'],
    ['a slug with a slash', { ...VIEW, slug: 'a/b' }, 'Invalid slug.'],
    ['a slug with a dot', { ...VIEW, slug: 'rss.xml' }, 'Invalid slug.'],
    ['an uppercase slug', { ...VIEW, slug: 'A-Post' }, 'Invalid slug.'],
    ['an empty slug', { ...VIEW, slug: '' }, 'Invalid slug.'],
    [
      'a missing session',
      { kind: 'view', slug: 'a-post' },
      'Invalid session id.',
    ],
    ['an empty session', { ...VIEW, sessionId: '' }, 'Invalid session id.'],
  ])('400s on %s', async (_label, body, message) => {
    const response = await post(body)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: message })

    // The important half: nothing reached the collection.
    await expect(PostEventModel.countDocuments({})).resolves.toBe(0)
  })

  it('rejects a session id containing the id separator', async () => {
    /*
      The forgery vector, and the reason the charset is a whitelist rather than "no whitespace".
      The id grammar is `blog:<kind>:<subject>`. A session of `x:y` on a `view` produces
      `blog:view:slug:x:y`, and a caller who can put colons in the subject can craft an `_id`
      that reads as a different kind's row - so a share can be manufactured out of a page view.
    */
    const response = await post({ ...VIEW, sessionId: 'forged:share' })

    expect(response.status).toBe(400)
    await expect(PostEventModel.countDocuments({})).resolves.toBe(0)
  })

  it('rejects a session id past the length bound', async () => {
    // Unbounded, this lands in an indexed `_id`. 64 is the ceiling; 65 is the test.
    const response = await post({ ...VIEW, sessionId: 'a'.repeat(65) })

    expect(response.status).toBe(400)
  })

  it('accepts a session id exactly at the bound', async () => {
    // The other half of the previous one - an off-by-one here silently drops real events.
    const response = await post({ ...VIEW, sessionId: 'a'.repeat(64) })

    expect(response.status).toBe(204)
  })

  it('requires a token for a share and for an attribution', async () => {
    for (const kind of ['share', 'attribute']) {
      const response = await post({ ...VIEW, kind })

      expect(response.status, kind).toBe(400)
      await expect(response.json()).resolves.toMatchObject({
        error: 'Invalid share token.',
      })
    }
  })

  it('does not require a token for a view', async () => {
    // A view is the overwhelming majority of traffic and has no token to carry. Requiring one
    // here would drop every genuine page view on the site.
    await expect(post(VIEW).then(response => response.status)).resolves.toBe(
      204
    )
  })

  it('applies the same charset to a token as to a session', async () => {
    const response = await post({
      ...VIEW,
      kind: 'share',
      token: 'forged:kind',
    })

    expect(response.status).toBe(400)
  })

  it('400s on a body that is not JSON', async () => {
    const response = await post('{ not json')

    expect(response.status).toBe(400)
  })

  it('413s on a body past the byte cap', async () => {
    // Measured on the real body, never on `Content-Length` - that header is client-supplied and
    // absent entirely on a chunked request.
    const response = await post({ ...VIEW, slug: 'a'.repeat(4 * 1024) })

    expect(response.status).toBe(413)
    await expect(PostEventModel.countDocuments({})).resolves.toBe(0)
  })
})

describe('the rate limit', () => {
  it('throttles a single connection and says how long to wait', async () => {
    /*
      60 per minute per IP. Slow-ish as a test, and worth it: this is the only throttle standing
      between the open internet and an unauthenticated Mongo write, and the way it breaks is by
      being reordered above `connectDatabase()` - where `checkRateLimit` fails open on a cold
      invocation and waves everything through while looking identical from outside.

      A test that mocked the limiter could not see that. This one sends real requests.
    */
    const headers = { 'x-forwarded-for': '203.0.113.9' }

    for (let index = 0; index < 60; index += 1)
      await post({ ...VIEW, sessionId: `session-${index}` }, headers)

    const response = await post({ ...VIEW, sessionId: 'one-too-many' }, headers)

    expect(response.status).toBe(429)
    expect(Number(response.headers.get('Retry-After'))).toBeGreaterThan(0)
  }, 60_000)

  it('counts per IP, so one noisy reader does not throttle everybody', async () => {
    for (let index = 0; index < 60; index += 1)
      await post(
        { ...VIEW, sessionId: `session-${index}` },
        { 'x-forwarded-for': '203.0.113.10' }
      )

    const other = await post(VIEW, { 'x-forwarded-for': '203.0.113.11' })

    expect(other.status).toBe(204)
  }, 60_000)
})
