import { MongoMemoryServer } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import { NextRequest } from 'next/server'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { ContactMessageModel } from '@/models/ContactMessage'
import { PostEventModel } from '@/models/PostEvent'
import { PostModel } from '@/models/Post'

/**
 * `DELETE /api/admin/blog/<id>?permanent=true`, against a real database.
 *
 * This endpoint is the only one in the blog that destroys a row, and it deliberately breaks
 * the invariant every other part of the feature is built on: a soft delete retains the slug
 * forever so that a future post cannot inherit the old one's contact attributions, and a
 * permanent delete releases it. So the tests here are not "does it delete" - they are the
 * guards that decide WHEN it is allowed to.
 *
 * Driving the handler through a real request rather than calling model methods, because the
 * things under test - the query-string parsing, the already-deleted precondition, the 409 that
 * carries a count - live in the handler and not in the data layer.
 *
 * The owner gate is NOT among them, and this file cannot test it: `REQUIRE_ADMIN=false` is set
 * below so every case here can reach the handler at all. The 401 lives in
 * `tests/e2e/blog-owner-gate.spec.ts`, which asserts it per handler against a real server with
 * no cookie - the only place that assertion means anything.
 */

/**
 * The one thing mocked here, and only because it cannot run outside a request.
 *
 * `revalidatePublishedPost` wraps Next's `revalidatePath`, which needs the static-generation
 * store that only exists inside a real request. Called from vitest it throws, the handler's
 * catch turns that into a 500, and every success path in this file fails for a reason that has
 * nothing to do with deleting. The 409 paths return before it, which is why those passed while
 * the 200s did not - a confusing signal worth naming.
 *
 * Mocked at OUR wrapper rather than at `next/cache`, so the mock boundary is a module this
 * repo owns and the assertion below can check the call rather than the framework's internals.
 */
vi.mock('@/lib/blog/revalidate', () => ({ revalidatePublishedPost: vi.fn() }))

let memory: MongoMemoryServer
let DELETE: (
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) => Promise<Response>

beforeAll(async () => {
  memory = await MongoMemoryServer.create()
  // Set before the import: the handler opens with `connectDatabase()`, which reads this at
  // call time, and `REQUIRE_ADMIN=false` is what lets `requireOwner` pass without a cookie.
  process.env.MONGODB_URI = memory.getUri()
  process.env.REQUIRE_ADMIN = 'false'
  await mongoose.connect(memory.getUri())
  ;({ DELETE } = await import('@/app/api/admin/blog/[id]/route'))
}, 120_000)

afterAll(async () => {
  await mongoose.disconnect()
  await memory.stop()
})

afterEach(async () => {
  await Promise.all([
    PostModel.deleteMany({}),
    PostEventModel.deleteMany({}),
    ContactMessageModel.deleteMany({}),
  ])
})

async function makePost(overrides: Record<string, unknown> = {}) {
  return PostModel.create({
    slug: 'a-post',
    title: 'A post',
    kind: 'article',
    status: 'deleted',
    ...overrides,
  })
}

/**
 * `NextRequest`, not `Request`.
 *
 * The handler reads `request.cookies` (through `requireOwner`) and `request.nextUrl`, and
 * neither exists on a plain `Request` - a bare one fails with
 * `Cannot read properties of undefined (reading 'get')` from inside the owner gate, which
 * looks like an auth bug rather than a test-harness one.
 */
function call(id: string, query = '') {
  const request = new NextRequest(`http://localhost/api/admin/blog/${id}${query}`, {
    method: 'DELETE',
  })
  return DELETE(request, { params: Promise.resolve({ id }) })
}

describe('the precondition: already soft-deleted', () => {
  it.each(['draft', 'published', 'archived'] as const)(
    'refuses to permanently delete a %s post',
    async status => {
      /*
        The actual lock on this feature, and the reason there is no typed confirmation phrase.
        A permanent delete cannot be reached in ONE call from any state a live post is in - not
        by a mistyped query string, not by a script, not by a stale tab holding a published
        post's id. Two separate deletions are always required.
      */
      const post = await makePost({ status, publishedAt: status === 'draft' ? null : new Date() })

      const response = await call(String(post._id), '?permanent=true')

      expect(response.status).toBe(409)
      expect(await PostModel.countDocuments({})).toBe(1)
    }
  )

  it('soft-deletes without the flag, leaving the document in place', async () => {
    // The default path is unchanged. `permanent` is opt-in, so an existing caller - or the
    // board's own row action - cannot become destructive by accident.
    const post = await makePost({ status: 'published', publishedAt: new Date() })

    const response = await call(String(post._id))

    expect(response.status).toBe(200)
    const after = await PostModel.findById(post._id)
    expect(after?.status).toBe('deleted')
  })
})

describe('the warning: a slug that is on real contact messages', () => {
  it('refuses the first press and returns the count', async () => {
    // The refusal IS the warning - the same shape the series delete guard uses. The owner is
    // not blocked, they are shown the number before being asked again.
    const post = await makePost()
    await ContactMessageModel.create([
      { email: 'a@b.c', firstname: 'A', lastname: 'B', subject: 's', message: 'm', sourceSlug: 'a-post' },
      { email: 'd@e.f', firstname: 'D', lastname: 'E', subject: 's', message: 'm', sourceSlug: 'a-post' },
    ])

    const response = await call(String(post._id), '?permanent=true')
    const body = (await response.json()) as { contactMessages?: number; error?: string }

    expect(response.status).toBe(409)
    expect(body.contactMessages).toBe(2)
    expect(await PostModel.countDocuments({})).toBe(1)
  })

  it('goes through once acknowledged', async () => {
    const post = await makePost()
    await ContactMessageModel.create({
      email: 'a@b.c', firstname: 'A', lastname: 'B', subject: 's', message: 'm', sourceSlug: 'a-post',
    })

    const response = await call(String(post._id), '?permanent=true&acknowledge=true')

    expect(response.status).toBe(200)
    expect(await PostModel.countDocuments({})).toBe(0)
  })

  it('never deletes the messages themselves, acknowledged or not', async () => {
    /*
      The line this feature does not cross. These are messages real people wrote to the owner,
      and the blog's kill criterion reads them. Deleting somebody's mail because a post was
      tidied up is a far worse outcome than a skewed metric - so the slug is released and the
      messages, `sourceSlug` and all, stay exactly where they are.
    */
    const post = await makePost()
    await ContactMessageModel.create({
      email: 'a@b.c', firstname: 'A', lastname: 'B', subject: 's', message: 'm', sourceSlug: 'a-post',
    })

    await call(String(post._id), '?permanent=true&acknowledge=true')

    const messages = await ContactMessageModel.find({})
    expect(messages).toHaveLength(1)
    expect(messages[0].sourceSlug).toBe('a-post')
  })

  it('does not count another post\'s messages', async () => {
    // `sourceSlug` is a plain string with no reference to a document, so the count has to be
    // filtered on the exact slug. A bug here would refuse every permanent delete forever.
    const post = await makePost()
    await ContactMessageModel.create({
      email: 'a@b.c', firstname: 'A', lastname: 'B', subject: 's', message: 'm', sourceSlug: 'other-post',
    })

    const response = await call(String(post._id), '?permanent=true')

    expect(response.status).toBe(200)
    expect(await PostModel.countDocuments({})).toBe(0)
  })
})

describe('what goes with the post', () => {
  it('removes the slug\'s PostEvent rows, and only that slug\'s', async () => {
    /*
      `PostEvent` is keyed by slug with no reference to the document, so leaving these behind
      means a future post taking the slug inherits its predecessor's read and share counts -
      the same misattribution the ContactMessage warning is about, one instrument down.
    */
    const post = await makePost()
    const expireAt = new Date(Date.now() + 86_400_000)
    await PostEventModel.create([
      { _id: 'blog:view:a-post:s1', kind: 'view', slug: 'a-post', createdAt: new Date(), expireAt },
      { _id: 'blog:share:a-post:s2', kind: 'share', slug: 'a-post', createdAt: new Date(), expireAt },
      { _id: 'blog:view:other:s3', kind: 'view', slug: 'other', createdAt: new Date(), expireAt },
    ])

    const response = await call(String(post._id), '?permanent=true')
    const body = (await response.json()) as { eventsRemoved?: number }

    expect(body.eventsRemoved).toBe(2)
    expect(await PostEventModel.countDocuments({})).toBe(1)
  })

  it('invalidates the path, because a permanently deleted post can still be cached as a 200', async () => {
    // The post was very likely published once. Removing the document does not remove the ISR
    // entry at its path, so the page would keep serving until the window expired.
    const { revalidatePublishedPost } = await import('@/lib/blog/revalidate')
    const post = await makePost()

    await call(String(post._id), '?permanent=true')

    expect(revalidatePublishedPost).toHaveBeenCalledWith('a-post')
  })

  it('frees the slug for a new post - which is the whole point, and the whole risk', async () => {
    // `{ slug: 1 }` is unique. While the post was soft-deleted this create would have failed
    // on a duplicate key; that refusal is exactly what a permanent delete gives up.
    const post = await makePost()
    await call(String(post._id), '?permanent=true')

    const replacement = await PostModel.create({ slug: 'a-post', title: 'New', kind: 'article' })

    expect(replacement.slug).toBe('a-post')
  })
})

describe('the last reference to the slug', () => {
  it("unlinks the slug from other posts' relatedSlugs", async () => {
    /*
      The reference that was missed when this handler's blast radius was first enumerated.
      `PostEvent.slug` and `ContactMessage.sourceSlug` were both accounted for; `relatedSlugs`
      on OTHER posts was not, and it is the same hazard one relation over. Those links resolve
      to nothing while the slug is unused - but a permanent delete RELEASES the slug, so a
      future post taking it silently inherits editorial "related" links pointing at whatever
      used to be there.
    */
    const post = await makePost()
    const neighbour = await PostModel.create({
      slug: 'still-here',
      title: 'Still here',
      kind: 'article',
      relatedSlugs: ['a-post', 'another-one'],
    })

    const response = await call(String(post._id), '?permanent=true')
    const body = (await response.json()) as { unlinkedFrom?: number }

    expect(body.unlinkedFrom).toBe(1)
    // The OTHER slug on that post is untouched - this is a `$pull` of one value, not a reset.
    expect((await PostModel.findById(neighbour._id))?.relatedSlugs).toEqual(['another-one'])
  })

  it('reports zero when nothing pointed at it', async () => {
    const post = await makePost()

    const body = (await (await call(String(post._id), '?permanent=true')).json()) as {
      unlinkedFrom?: number
    }

    expect(body.unlinkedFrom).toBe(0)
  })

  it('deletes the post before its events, so a partial failure cannot strand the post', async () => {
    /*
      Ordering, not a new capability. The reverse - events first - loses a post's metrics while
      the post survives if the second delete fails, and the catch reports that as "unable to
      delete the post right now", which reads as "nothing happened". Post-first means the only
      strandable leftovers are `PostEvent` rows for a slug with no document, which no read path
      joins on.
    */
    const post = await makePost()
    const expireAt = new Date(Date.now() + 86_400_000)
    await PostEventModel.create({
      _id: 'blog:view:a-post:s1',
      kind: 'view',
      slug: 'a-post',
      createdAt: new Date(),
      expireAt,
    })

    await call(String(post._id), '?permanent=true')

    expect(await PostModel.countDocuments({})).toBe(0)
    expect(await PostEventModel.countDocuments({})).toBe(0)
  })

  it('still reports success when revalidation fails, because the delete has committed', async () => {
    /*
      By the time revalidation runs the document is gone. Letting a `revalidatePath` throw fall
      into the catch would answer "unable to delete the post right now" for a delete that HAS
      happened - the author retries, gets a 404, and cannot tell which was true.
    */
    const { revalidatePublishedPost } = await import('@/lib/blog/revalidate')
    vi.mocked(revalidatePublishedPost).mockImplementationOnce(() => {
      throw new Error('no static generation store')
    })
    const post = await makePost()

    const response = await call(String(post._id), '?permanent=true')
    const body = (await response.json()) as { ok?: boolean; revalidated?: boolean }

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    // Reported rather than swallowed, so a stale page is visible as a stale page.
    expect(body.revalidated).toBe(false)
    expect(await PostModel.countDocuments({})).toBe(0)
  })
})

describe('the gate', () => {
  it('404s an id that is not an ObjectId', async () => {
    const response = await call('not-an-id', '?permanent=true')

    expect(response.status).toBe(404)
  })
})
