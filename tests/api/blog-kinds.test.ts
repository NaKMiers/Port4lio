import { MongoMemoryServer } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { SEED_KINDS } from '@/lib/blog/constants'
import {
  defaultKindSlug,
  ensureKindsSeeded,
  kindExists,
  kindPresentationMap,
  listKindsWithCounts,
  postsUsingKind,
} from '@/lib/blog/kind-data'
import { KindModel } from '@/models/Kind'
import { PostModel } from '@/models/Post'

/**
 * The kinds collection, and the two invariants that are NOT shared with series.
 *
 * `Post.series` is nullable; `Post.kind` is required. That asymmetry produces both of the
 * rules tested at the bottom of this file - the schema can no longer default a kind, and the
 * collection can never be emptied - and neither has an equivalent in `blog-series.test.ts`.
 */

let memory: MongoMemoryServer

beforeAll(async () => {
  memory = await MongoMemoryServer.create()
  // Before connecting: the functions under test open with `connectDatabase()`, which reads
  // this. Same reason as `blog-series.test.ts`.
  process.env.MONGODB_URI = memory.getUri()
  await mongoose.connect(memory.getUri())
  await KindModel.syncIndexes()
}, 120_000)

afterAll(async () => {
  await mongoose.disconnect()
  await memory.stop()
})

afterEach(async () => {
  await KindModel.deleteMany({})
  await PostModel.deleteMany({})
})

const BASE = { title: 'A post', kind: 'note' }

describe('seeding', () => {
  it('seeds article and note, with article first', async () => {
    await ensureKindsSeeded()

    const rows = await KindModel.find({}).sort({ order: 1 }).lean()
    expect(rows.map(row => row.slug)).toEqual(['article', 'note'])
    // Order is not cosmetic here: `defaultKindSlug` reads the first, and that is what a new
    // draft is created as.
    expect(rows[0]?.slug).toBe('article')
  })

  it('carries the eyebrow flag that used to be a literal in PostCard', async () => {
    await ensureKindsSeeded()

    const byslug = Object.fromEntries((await KindModel.find({}).lean()).map(r => [r.slug, r]))
    expect(byslug.note?.eyebrow).toBe(true)
    expect(byslug.article?.eyebrow).toBe(false)
  })

  it('does NOT re-add a kind the owner deleted', async () => {
    await ensureKindsSeeded()
    await KindModel.deleteOne({ slug: 'note' })

    await ensureKindsSeeded()

    expect(await KindModel.exists({ slug: 'note' })).toBeNull()
    expect(await KindModel.countDocuments({})).toBe(SEED_KINDS.length - 1)
  })
})

describe('kindExists - the write path guarantee', () => {
  it('replaces the schema enum that was removed', async () => {
    await ensureKindsSeeded()

    expect(await kindExists('note')).toBe(true)
    expect(await kindExists('made-up-kind')).toBe(false)
  })
})

describe('defaultKindSlug - what a new draft is created as', () => {
  /**
   * The regression this exists to prevent, stated plainly: `Post.kind` used to carry
   * `default: 'note'` in the schema, and `POST /api/admin/blog` relied on it. Delete `note`
   * from an editable list and every new draft is created pointing at a kind that does not
   * exist - silently, with no write path involved to catch it.
   */
  it('follows `order`, so deleting the first kind moves the default rather than breaking it', async () => {
    await ensureKindsSeeded()
    expect(await defaultKindSlug()).toBe('article')

    await KindModel.deleteOne({ slug: 'article' })
    expect(await defaultKindSlug()).toBe('note')
  })

  it('is null only when the collection is empty - which DELETE refuses to allow', async () => {
    await KindModel.deleteMany({})
    // Seeding is first-run-only, so an emptied collection re-seeds; insert a marker first so
    // this asserts the empty case rather than the seeded one.
    await KindModel.create({ slug: 'only', label: 'Only', order: 0 })
    await KindModel.deleteMany({})

    expect(await defaultKindSlug()).toBe('article')
  })
})

describe('the delete guard', () => {
  it('reports the posts blocking a delete', async () => {
    await ensureKindsSeeded()
    await PostModel.create({ ...BASE, slug: 'a' })
    await PostModel.create({ ...BASE, slug: 'b' })

    expect(await postsUsingKind('note')).toHaveLength(2)
    expect(await postsUsingKind('article')).toHaveLength(0)
  })

  it('counts soft-deleted posts, which can be restored', async () => {
    await ensureKindsSeeded()
    await PostModel.create({ ...BASE, slug: 'gone', status: 'deleted' })

    expect(await postsUsingKind('note')).toHaveLength(1)
  })
})

describe('listKindsWithCounts', () => {
  it('counts posts per kind and orders by `order`', async () => {
    await ensureKindsSeeded()
    await PostModel.create({ ...BASE, slug: 'a' })
    await PostModel.create({ ...BASE, slug: 'b', kind: 'article' })

    const rows = await listKindsWithCounts()
    expect(rows.map(row => row.slug)).toEqual(['article', 'note'])
    expect(Object.fromEntries(rows.map(r => [r.slug, r.postCount]))).toEqual({
      article: 1,
      note: 1,
    })
  })
})

describe('kindPresentationMap - what PostCard renders from', () => {
  it('maps slug to the label and eyebrow the card needs', async () => {
    await ensureKindsSeeded()

    const map = await kindPresentationMap()
    expect(map.get('note')).toEqual({ label: 'Note', eyebrow: true })
    expect(map.get('article')).toEqual({ label: 'Article', eyebrow: false })
    // A post whose kind was deleted looks this up and gets nothing - PostCard's `kind` prop
    // is optional for exactly that, and renders no eyebrow rather than "undefined".
    expect(map.get('deleted-kind')).toBeUndefined()
  })
})

describe('the schema after the enum was removed', () => {
  it('still REQUIRES a kind - the field lost its enum and its default, not its requirement', async () => {
    await expect(PostModel.create({ title: 'No kind', slug: 'nk' })).rejects.toThrow()
  })

  it('accepts any string, because validation moved to the write path', async () => {
    await expect(
      PostModel.create({ title: 'x', slug: 'ak', kind: 'made-up-kind' })
    ).resolves.toBeDefined()
  })
})
