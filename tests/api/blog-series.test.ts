import { MongoMemoryServer } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { SEED_SERIES } from '@/lib/blog/constants'
import {
  ensureSeriesSeeded,
  listSeriesWithCounts,
  postsUsingSeries,
  seriesExists,
} from '@/lib/blog/series-data'
import { PostModel } from '@/models/Post'
import { SeriesModel } from '@/models/Series'

/**
 * The series collection, and the guarantee that moved into it.
 *
 * `Post.series` lost its schema enum when the series list became editable - see the inverted
 * test in `blog-post-model.test.ts`. Everything that enum used to hold is now held by these
 * functions plus the write path that calls them, so this is where that coverage lives.
 *
 * An `api` test against a real mongod rather than a unit test, for the same reason the post
 * model's is: the seed guard reads a document count, the delete guard reads across two
 * collections, and neither means anything against a mock.
 */

let memory: MongoMemoryServer

beforeAll(async () => {
  memory = await MongoMemoryServer.create()
  /*
    Set BEFORE connecting, unlike the sibling suites.
    
    Those drive the models directly, so `mongoose.connect` is all they need. The functions
    under test here are the real read path, and it opens with `connectDatabase()` - which
    reads `MONGODB_URI` and throws without it. Pointing the env var at the memory server is
    what makes `connectDatabase` a no-op against the connection this already holds, rather
    than mocking out the one line that proves these run against a real server.
  */
  process.env.MONGODB_URI = memory.getUri()
  await mongoose.connect(memory.getUri())
  await SeriesModel.syncIndexes()
}, 120_000)

afterAll(async () => {
  await mongoose.disconnect()
  await memory.stop()
})

afterEach(async () => {
  await SeriesModel.deleteMany({})
  await PostModel.deleteMany({})
})

const BASE = { title: 'A post', kind: 'note' as const }

describe('seeding', () => {
  it('puts the original three in an empty collection, in order', async () => {
    await ensureSeriesSeeded()

    const rows = await SeriesModel.find({}).sort({ order: 1 }).lean()
    expect(rows.map(row => row.slug)).toEqual(SEED_SERIES.map(series => series.slug))
    // The copy comes with them. A seeded series with no title renders a headless cluster.
    expect(rows[0]?.title).toBe(SEED_SERIES[0].title)
    expect(rows[0]?.blurb).not.toBe('')
  })

  /**
   * The failure this guards is specific and would be invisible: an upsert-per-slug seed
   * looks equivalent and silently resurrects a deleted series on every index revalidate.
   * Seeding is a first-run action, not a reconciliation.
   */
  it('does NOT re-add a series the owner deleted', async () => {
    await ensureSeriesSeeded()
    await SeriesModel.deleteOne({ slug: 'dev-career-vn' })

    await ensureSeriesSeeded()

    expect(await SeriesModel.exists({ slug: 'dev-career-vn' })).toBeNull()
    expect(await SeriesModel.estimatedDocumentCount()).toBe(SEED_SERIES.length - 1)
  })

  it('is idempotent', async () => {
    await ensureSeriesSeeded()
    await ensureSeriesSeeded()
    await ensureSeriesSeeded()

    expect(await SeriesModel.countDocuments({})).toBe(SEED_SERIES.length)
  })
})

describe('slug uniqueness', () => {
  it('refuses a duplicate slug at the index, not just in the route', async () => {
    await SeriesModel.create({ slug: 'dupe', title: 'One' })
    await expect(SeriesModel.create({ slug: 'dupe', title: 'Two' })).rejects.toThrow()
  })
})

describe('seriesExists - the write path guarantee', () => {
  it('is true for a real slug and false for a made-up one', async () => {
    await ensureSeriesSeeded()

    expect(await seriesExists('dev-career-vn')).toBe(true)
    expect(await seriesExists('made-up-series')).toBe(false)
  })

  /**
   * The regression that motivates the whole check: a series deleted while an editor tab is
   * open. Before the write path consulted the collection, that tab could save the stale slug
   * and the field would silently keep whatever it had.
   */
  it('goes false the moment a series is deleted', async () => {
    await ensureSeriesSeeded()
    expect(await seriesExists('dev-career-vn')).toBe(true)

    await SeriesModel.deleteOne({ slug: 'dev-career-vn' })
    expect(await seriesExists('dev-career-vn')).toBe(false)
  })
})

describe('the delete guard', () => {
  it('reports the posts blocking a delete', async () => {
    await ensureSeriesSeeded()
    await PostModel.create({ ...BASE, slug: 'a', series: 'dev-career-vn' })
    await PostModel.create({ ...BASE, slug: 'b', series: 'dev-career-vn' })

    const blocking = await postsUsingSeries('dev-career-vn')
    expect(blocking).toHaveLength(2)
    expect(blocking[0]?.title).toBe('A post')
  })

  it('reports nothing for an unused series', async () => {
    await ensureSeriesSeeded()
    expect(await postsUsingSeries('dev-career-vn')).toHaveLength(0)
  })

  /**
   * A soft-deleted post still holds its series reference and can be restored, so it MUST
   * block the delete. Counting only live posts would let a series be removed out from under a
   * document that comes back pointing at nothing.
   */
  it('counts soft-deleted posts as still using the series', async () => {
    await ensureSeriesSeeded()
    await PostModel.create({ ...BASE, slug: 'gone', series: 'dev-career-vn', status: 'deleted' })

    expect(await postsUsingSeries('dev-career-vn')).toHaveLength(1)
  })
})

describe('listSeriesWithCounts', () => {
  it('counts posts per series and leaves unused ones at zero', async () => {
    await ensureSeriesSeeded()
    await PostModel.create({ ...BASE, slug: 'a', series: 'dev-career-vn' })
    await PostModel.create({ ...BASE, slug: 'b', series: 'dev-career-vn' })
    await PostModel.create({ ...BASE, slug: 'c', series: 'measured-in-production' })
    // A post with no series must not be attributed to one.
    await PostModel.create({ ...BASE, slug: 'd' })

    const rows = await listSeriesWithCounts()
    const bySlug = Object.fromEntries(rows.map(row => [row.slug, row.postCount]))

    expect(bySlug['dev-career-vn']).toBe(2)
    expect(bySlug['measured-in-production']).toBe(1)
    expect(bySlug['shipping-side-products']).toBe(0)
  })

  it('returns them in `order`, which is what /blog renders', async () => {
    await SeriesModel.create({ slug: 'third', title: 'Third', order: 2 })
    await SeriesModel.create({ slug: 'first', title: 'First', order: 0 })
    await SeriesModel.create({ slug: 'second', title: 'Second', order: 1 })

    const rows = await listSeriesWithCounts()
    expect(rows.map(row => row.slug)).toEqual(['first', 'second', 'third'])
  })
})
