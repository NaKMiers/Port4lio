import { MongoMemoryServer } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { connectDatabase } from '@/lib/mongodb'
import {
  listPublishedPosts,
  listPublishedSlugs,
  listSeriesPeers,
  readPublishedPost,
  resolveRelatedSlugs,
} from '@/lib/blog/post-data'
import { PostModel, type PostStatus } from '@/models/Post'

/**
 * The public read boundary: every query a stranger's request can reach.
 *
 * ```
 *   listPublishedPosts()   /blog, RSS, sitemap      ← never a body
 *   readPublishedPost()    /blog/<slug>             ← bodyHtml, never bodyMarkdown
 *   listPublishedSlugs()   generateStaticParams     ← slug only
 *   listSeriesPeers()      "more in this series"    ← never the post you are on
 *   resolveRelatedSlugs()  the post footer          ← author's order, published only
 * ```
 *
 * ## Why this is an api test and why it is worth having at all
 *
 * The module is five short functions and every one of them is a mongoose query, so there is
 * nothing here a mock could check: mocking the query builder would assert that the code calls
 * `.select()` with a string, which is a restatement of the source rather than a test of it.
 * What matters is what a real server returns for a real document, and that is only observable
 * against a real mongod.
 *
 * Three failures are the reason it exists, and none of them raises an error when it happens:
 *
 * 1. **A private post serving.** Four statuses exist and exactly one is public. The filter is
 *    `status: 'published'` rather than an exclusion list precisely so a new state defaults to
 *    invisible - but nothing enforces that a future edit keeps it that way, and a draft that
 *    starts appearing on /blog looks exactly like a draft that was published.
 * 2. **`bodyMarkdown` in a public response.** It is the author's working copy, it is
 *    `select: false`, and one `+bodyMarkdown` in the wrong projection ships it to every reader
 *    with a 200.
 * 3. **`_id` coming back on a list item.** A lean `_id` is a BSON ObjectId, React refuses to
 *    serialise it across the server-to-client boundary, and the symptom is a console warning
 *    per post on a page that still renders.
 */

let memory: MongoMemoryServer

beforeAll(async () => {
  memory = await MongoMemoryServer.create()
  // `connectDatabase` rather than `mongoose.connect`: these functions call it themselves, and
  // letting it own the connection is what makes the cache in `lib/mongodb` behave here the way
  // it does in a running server.
  process.env.MONGODB_URI = memory.getUri()
  await connectDatabase()
  await PostModel.syncIndexes()
}, 120_000)

afterAll(async () => {
  await mongoose.disconnect()
  await memory.stop()
  globalThis.mongooseCache = undefined
})

afterEach(async () => {
  await PostModel.deleteMany({})
})

/** Every status except `published`. The list this file exists to keep invisible. */
const PRIVATE_STATUSES: PostStatus[] = ['draft', 'archived', 'deleted']

type PostSeed = {
  slug: string
  status?: PostStatus
  series?: string | null
  publishedAt?: Date | null
  isPillar?: boolean
  relatedSlugs?: string[]
}

async function seed({
  slug,
  status = 'published',
  series = null,
  publishedAt = new Date('2026-01-01'),
  isPillar = false,
  relatedSlugs = [],
}: PostSeed) {
  return PostModel.create({
    slug,
    title: `Post ${slug}`,
    excerpt: `Excerpt for ${slug}`,
    kind: 'article',
    series,
    isPillar,
    relatedSlugs,
    status,
    publishedAt,
    bodyMarkdown: `## ${slug}\n\nThe author's working copy.`,
    bodyHtml: `<h2>${slug}</h2><p>The rendered copy.</p>`,
    tags: ['nextjs'],
  })
}

describe('what is public, and what is exactly one status', () => {
  it('lists only published posts', async () => {
    await seed({ slug: 'live' })
    for (const status of PRIVATE_STATUSES) await seed({ slug: status, status })

    const posts = await listPublishedPosts()

    expect(posts.map(post => post.slug)).toEqual(['live'])
  })

  it('refuses to read a post in any private status by slug', async () => {
    // Each of the three is private for a different reason - never public, withdrawn
    // deliberately, holding its slug against reuse - and all three must 404 the same way.
    for (const status of PRIVATE_STATUSES) {
      await seed({ slug: 'private-post', status })

      await expect(readPublishedPost('private-post')).resolves.toBeNull()

      await PostModel.deleteMany({})
    }
  })

  it('reads a published post by slug', async () => {
    await seed({ slug: 'live' })

    const post = await readPublishedPost('live')

    expect(post?.slug).toBe('live')
  })

  it('returns null for a slug that does not exist at all', async () => {
    await expect(readPublishedPost('never-existed')).resolves.toBeNull()
  })

  it('hands generateStaticParams published slugs only', async () => {
    // A slug that reaches this list gets a route prerendered for it. An archived post in here
    // is a withdrawn post with a build-time HTML shell sitting in front of its own 404.
    await seed({ slug: 'live' })
    await seed({ slug: 'gone', status: 'archived' })

    await expect(listPublishedSlugs()).resolves.toEqual(['live'])
  })

  it('keeps private posts out of the series peers list', async () => {
    await seed({ slug: 'anchor', series: 'measured-in-production' })
    await seed({
      slug: 'draft-peer',
      series: 'measured-in-production',
      status: 'draft',
    })

    await expect(
      listSeriesPeers('measured-in-production', 'anchor')
    ).resolves.toEqual([])
  })

  it('drops a related slug whose post is not published', async () => {
    // The whole point of resolving on read: a post that is archived stops linking the moment it
    // is archived, with no back-reference to clean up and no dangling link to a 404.
    await seed({ slug: 'still-live' })
    await seed({ slug: 'withdrawn', status: 'archived' })

    const related = await resolveRelatedSlugs(['still-live', 'withdrawn'])

    expect(related.map(post => post.slug)).toEqual(['still-live'])
  })
})

describe('what a public response may contain', () => {
  it('never carries bodyMarkdown on a list item', async () => {
    await seed({ slug: 'live' })

    const [post] = await listPublishedPosts()

    expect(post).not.toHaveProperty('bodyMarkdown')
    expect(post).not.toHaveProperty('bodyHtml')
  })

  it('gives the post page bodyHtml and still withholds the markdown', async () => {
    // `+bodyHtml` is the one opt-back-in to a `select: false` field in the codebase, and it is
    // deliberately not `+bodyMarkdown`. The HTML was sanitized and highlighted at save; the
    // markdown is the author's source and has no business in a public response.
    const post = await seed({ slug: 'live' }).then(() =>
      readPublishedPost('live')
    )

    expect(post?.bodyHtml).toContain('<h2>live</h2>')
    expect(post).not.toHaveProperty('bodyMarkdown')
  })

  it('excludes _id, which React refuses to serialise to a client component', async () => {
    // Not tidiness. `/blog` hands this array straight to `BlogIndexList`, which is a client
    // component, and a lean `_id` is an ObjectId carrying a `toJSON` - one
    // "Only plain objects can be passed to Client Components" warning per post.
    await seed({ slug: 'live' })

    const [post] = await listPublishedPosts()

    expect(post).not.toHaveProperty('_id')
  })

  it('excludes _id from every list-shaped read, not just the index', async () => {
    // Same projection, three more callers. A peer list and a related list are rendered by the
    // same cards, so one of them keeping `_id` produces the identical warning somewhere else.
    await seed({ slug: 'anchor', series: 'shipping-side-products' })
    await seed({ slug: 'peer', series: 'shipping-side-products' })

    const peers = await listSeriesPeers('shipping-side-products', 'anchor')
    const related = await resolveRelatedSlugs(['peer'])

    expect(peers[0]).not.toHaveProperty('_id')
    expect(related[0]).not.toHaveProperty('_id')
  })

  it('carries every field a card renders', async () => {
    // The projection is a hand-written string, so a field dropped from it fails as a card that
    // renders blank rather than as a type error.
    await seed({ slug: 'live', series: 'dev-career-vn', isPillar: true })

    const [post] = await listPublishedPosts()

    expect(Object.keys(post).sort()).toEqual(
      [
        'contentUpdatedAt',
        'coverCaption',
        'coverImage',
        'excerpt',
        'isPillar',
        'kind',
        'language',
        'publishedAt',
        'series',
        'slug',
        'tags',
        'title',
      ].sort()
    )
  })
})

describe('ordering and limits', () => {
  it('lists newest first', async () => {
    await seed({ slug: 'older', publishedAt: new Date('2026-01-01') })
    await seed({ slug: 'newest', publishedAt: new Date('2026-03-01') })
    await seed({ slug: 'middle', publishedAt: new Date('2026-02-01') })

    const posts = await listPublishedPosts()

    expect(posts.map(post => post.slug)).toEqual(['newest', 'middle', 'older'])
  })

  it('orders series peers newest first as well', async () => {
    await seed({ slug: 'anchor', series: 'dev-career-vn' })
    await seed({
      slug: 'old-peer',
      series: 'dev-career-vn',
      publishedAt: new Date('2026-01-02'),
    })
    await seed({
      slug: 'new-peer',
      series: 'dev-career-vn',
      publishedAt: new Date('2026-05-01'),
    })

    const peers = await listSeriesPeers('dev-career-vn', 'anchor')

    expect(peers.map(post => post.slug)).toEqual(['new-peer', 'old-peer'])
  })

  it('never lists the post you are already reading', async () => {
    // A "more in this series" list that links back to the current page reads as a bug to the
    // one person guaranteed to see it.
    await seed({ slug: 'anchor', series: 'dev-career-vn' })
    await seed({ slug: 'peer', series: 'dev-career-vn' })

    const peers = await listSeriesPeers('dev-career-vn', 'anchor')

    expect(peers.map(post => post.slug)).toEqual(['peer'])
  })

  it('caps peers at six by default', async () => {
    // Two rows of three. A series that works would otherwise put a wall of links under a post,
    // directly above the availability block it must not compete with.
    await seed({ slug: 'anchor', series: 'dev-career-vn' })
    for (let index = 0; index < 9; index += 1)
      await seed({ slug: `peer-${index}`, series: 'dev-career-vn' })

    await expect(
      listSeriesPeers('dev-career-vn', 'anchor')
    ).resolves.toHaveLength(6)
  })

  it('honours a caller-supplied limit', async () => {
    await seed({ slug: 'anchor', series: 'dev-career-vn' })
    for (let index = 0; index < 4; index += 1)
      await seed({ slug: `peer-${index}`, series: 'dev-career-vn' })

    await expect(
      listSeriesPeers('dev-career-vn', 'anchor', 2)
    ).resolves.toHaveLength(2)
  })

  it('returns the related posts in the order the author listed them', async () => {
    // Editorial, not the database's. The first related link is the one most people click, so a
    // list that came back in insertion order would silently overrule the author.
    await seed({ slug: 'first' })
    await seed({ slug: 'second' })
    await seed({ slug: 'third' })

    const related = await resolveRelatedSlugs(['third', 'first', 'second'])

    expect(related.map(post => post.slug)).toEqual(['third', 'first', 'second'])
  })
})

describe('the queries that must not be run at all', () => {
  it('returns nothing for a post with no series, without asking the database', async () => {
    // `null` is the common case - most posts are in no series - so the guard is what keeps a
    // pointless query off every post page that is not in a cluster.
    await expect(listSeriesPeers(null, 'anything')).resolves.toEqual([])
    await expect(listSeriesPeers(undefined, 'anything')).resolves.toEqual([])
    await expect(listSeriesPeers('', 'anything')).resolves.toEqual([])
  })

  it('returns nothing for an empty related list', async () => {
    await expect(resolveRelatedSlugs([])).resolves.toEqual([])
  })

  it('drops a related slug that matches no document at all', async () => {
    // The dangling-reference case: a draft whose slug was edited after a published post
    // referenced it. It resolves to nothing rather than 404ing a reader.
    await seed({ slug: 'real' })

    const related = await resolveRelatedSlugs(['real', 'renamed-away'])

    expect(related.map(post => post.slug)).toEqual(['real'])
  })
})
