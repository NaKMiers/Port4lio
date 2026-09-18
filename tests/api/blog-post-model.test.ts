import { MongoMemoryServer } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { isReservedSlug, PostModel } from '@/models/Post'

/**
 * `Post`'s schema and, more importantly, its indexes.
 *
 * The indexes are the reason this is an `api` test against a real mongod rather than a unit
 * test: two of the constraints here are cross-document and cannot be expressed in the
 * schema at all. "At most one pillar per series" is the headline case - no amount of
 * validator code holds it under concurrent writes, and the plan is explicit that a unit test
 * claiming to hold it would be a test that proves nothing.
 */

let memory: MongoMemoryServer

beforeAll(async () => {
  memory = await MongoMemoryServer.create()
  await mongoose.connect(memory.getUri())
  await PostModel.syncIndexes()
}, 120_000)

afterAll(async () => {
  await mongoose.disconnect()
  await memory.stop()
})

afterEach(async () => {
  await PostModel.deleteMany({})
})

const BASE = {
  title: 'Five things Next.js 16 did that its docs did not say',
  kind: 'note' as const,
}

async function builtIndexes() {
  return (await PostModel.collection.indexes()) as Record<string, unknown>[]
}

describe('slug rules', () => {
  it('accepts the documented charset', async () => {
    await expect(PostModel.create({ ...BASE, slug: 'a-real-slug-2026' })).resolves.toBeDefined()
  })

  it.each([
    ['an uppercase letter', 'Not-Lower'],
    ['a space', 'two words'],
    ['an underscore', 'snake_case'],
    ['a dot, which is why rss.xml is not on the denylist', 'rss.xml'],
    ['a slash', 'a/b'],
    ['empty', ''],
  ])('rejects %s', async (_label, slug) => {
    await expect(PostModel.create({ ...BASE, slug })).rejects.toThrow()
  })

  it('rejects every reserved slug, at the model and not only at the handler', async () => {
    for (const slug of ['page', 'feed', 'rss', 'privacy']) {
      expect(isReservedSlug(slug), `${slug} fell off the denylist`).toBe(true)
      await expect(PostModel.create({ ...BASE, slug }), slug).rejects.toThrow()
    }
  })

  it('holds slug uniqueness at the database', async () => {
    await PostModel.create({ ...BASE, slug: 'taken' })
    await expect(PostModel.create({ ...BASE, slug: 'taken' })).rejects.toThrow()
  })
})

describe('the pillar invariant', () => {
  it('refuses a second pillar in the same series', async () => {
    // F10. The index rejects it - there is no application code in this path at all.
    await PostModel.create({
      ...BASE,
      slug: 'first-pillar',
      series: 'measured-in-production',
      isPillar: true,
    })

    await expect(
      PostModel.create({
        ...BASE,
        slug: 'second-pillar',
        series: 'measured-in-production',
        isPillar: true,
      })
    ).rejects.toThrow(/E11000/)
  })

  it('allows one pillar per series across different series', async () => {
    await PostModel.create({
      ...BASE,
      slug: 'p1',
      series: 'measured-in-production',
      isPillar: true,
    })
    await expect(
      PostModel.create({ ...BASE, slug: 'p2', series: 'dev-career-vn', isPillar: true })
    ).resolves.toBeDefined()
  })

  it('allows many non-pillar posts in one series', async () => {
    // What the `isPillar: true` clause of the partial filter buys. Without it the unique
    // index would allow exactly one post per series, which is the opposite of a blog.
    await PostModel.create({ ...BASE, slug: 'n1', series: 'dev-career-vn' })
    await expect(
      PostModel.create({ ...BASE, slug: 'n2', series: 'dev-career-vn' })
    ).resolves.toBeDefined()
  })

  it('does NOT collide two seriesless pillars - the partial-vs-sparse lesson', async () => {
    /**
     * The case that cost a 500 on `/api/iq/start` to learn, arriving in a new model.
     *
     * `series` declares `default: null`, so it is present-and-null on every post without
     * one. A `sparse` unique index skips documents where the field is MISSING, not where it
     * is null - so under `sparse` the second seriesless pillar here would be rejected as a
     * duplicate key on `null`. The happy path passes and the second document ever created
     * fails, which is exactly how it presented last time.
     *
     * `$type: 'string'` is what makes the filter exclude them properly.
     */
    await PostModel.create({ ...BASE, slug: 'x1', isPillar: true })
    await expect(PostModel.create({ ...BASE, slug: 'x2', isPillar: true })).resolves.toBeDefined()
  })

  it('uses a PARTIAL filter with both clauses, not sparse', async () => {
    const pillar = (await builtIndexes()).find(index => {
      const key = index.key as Record<string, number> | undefined
      return key?.series !== undefined && index.unique === true
    })

    expect(pillar, 'the pillar unique index is missing').toBeDefined()
    expect(pillar?.sparse, 'sparse would collide on series:null - see the test above').toBeUndefined()
    expect(pillar?.partialFilterExpression).toEqual({
      isPillar: true,
      series: { $type: 'string' },
    })
  })
})

describe('the four indexes', () => {
  it('builds all of them', async () => {
    const keys = (await builtIndexes()).map(index => JSON.stringify(index.key))

    expect(keys).toContain(JSON.stringify({ slug: 1 }))
    expect(keys).toContain(JSON.stringify({ status: 1, publishedAt: -1 }))
    expect(keys).toContain(JSON.stringify({ series: 1, status: 1 }))
    expect(keys.filter(key => key === JSON.stringify({ series: 1 }))).toHaveLength(1)
  })

  it('has NO TTL index - a post is not a behavioural trace', async () => {
    // Asserted so nobody adds one by pattern-matching Attempt/TestEvent/IqAttempt, the same
    // reason ContactMessage asserts it. A post is published work, not stranger data.
    const ttl = (await builtIndexes()).find(index => index.expireAfterSeconds !== undefined)
    expect(ttl).toBeUndefined()
  })
})

describe('field constraints', () => {
  /**
   * This test used to assert the opposite, and the inversion is the point.
   *
   * `series` carried `enum: [...POST_SERIES, null]` while the series list was a build-time
   * constant. The list now lives in the `blog_series` collection so it can be managed without
   * a deploy, and a mongoose enum is fixed at module load - so keeping it would have meant
   * the database validating against whatever the list happened to be when the process
   * booted. A series created at 10:00 would be rejected by a server started at 09:00 until it
   * restarted: a validator that is wrong on a schedule is worse than no validator.
   *
   * So the guarantee moved rather than disappearing. It lives in
   * `PATCH /api/admin/blog/[id]`, which calls `seriesExists` and returns 400 - covered by
   * `tests/api/blog-series.test.ts`. This asserts the schema's half of that split honestly,
   * so nobody "restores" the enum without reading why it went.
   */
  it('accepts any string series - the enum moved to the write path, deliberately', async () => {
    await expect(
      PostModel.create({ ...BASE, slug: 's', series: 'made-up-series' })
    ).resolves.toBeDefined()
  })

  it('caps relatedSlugs at 5 and tags at 8', async () => {
    await expect(
      PostModel.create({ ...BASE, slug: 'r', relatedSlugs: ['a', 'b', 'c', 'd', 'e', 'f'] })
    ).rejects.toThrow()
    await expect(
      PostModel.create({ ...BASE, slug: 't', tags: Array.from({ length: 9 }, (_, i) => `t${i}`) })
    ).rejects.toThrow()
  })

  it('rejects a tag outside the charset', async () => {
    await expect(PostModel.create({ ...BASE, slug: 'tc', tags: ['Not Lower'] })).rejects.toThrow()
  })

  it('accepts a note with no excerpt and no cover image', async () => {
    // Criterion A2: the cheap tier has to actually be cheap, or only the expensive one gets
    // written and the blog goes quiet - which is what happened to 10 of the 27 sites
    // reviewed.
    const note = await PostModel.create({ ...BASE, slug: 'quick-note', kind: 'note' })

    expect(note.excerpt).toBe('')
    expect(note.coverImage).toBeNull()
  })

  it('defaults to a draft that has never been published', async () => {
    const post = await PostModel.create({ ...BASE, slug: 'fresh' })

    expect(post.status).toBe('draft')
    expect(post.publishedAt).toBeNull()
    expect(post.language).toBe('en')
  })

  it('excludes both bodies from a plain query', async () => {
    await PostModel.create({ ...BASE, slug: 'heavy', bodyMarkdown: '# hi', bodyHtml: '<h1>hi</h1>' })

    const listed = await PostModel.findOne({ slug: 'heavy' }).lean()
    expect(listed?.bodyMarkdown, 'select:false was lost - list queries now ship the body').toBeUndefined()
    expect(listed?.bodyHtml).toBeUndefined()

    // And are reachable when explicitly asked for, or the post page cannot render.
    const full = await PostModel.findOne({ slug: 'heavy' }).select('+bodyHtml').lean()
    expect(full?.bodyHtml).toBe('<h1>hi</h1>')
  })
})
