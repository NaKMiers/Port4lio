import mongoose, { Schema } from 'mongoose'

import { compileModel } from '@/lib/mongoose-model'

/**
 * One blog post, in one of four states.
 *
 * ```
 *                   create
 *                     │
 *                     ▼
 *               ┌──────────┐   slug editable
 *               │  draft   │   no public route at all
 *               └──────────┘   preview via POST /api/admin/blog/preview
 *                     │
 *             publish │  ── publishedAt stamped ONCE, never reset
 *                     ▼
 *               ┌──────────┐   public at /blog/<slug>
 *               │published │   in sitemap, RSS, generateStaticParams
 *               └──────────┘
 *                  │      ▲
 *        unpublish │      │ publish
 *                  ▼      │
 *               ┌──────────┐  404 publicly, retains publishedAt
 *               │ archived │  out of sitemap, RSS, static params
 *               └──────────┘
 *                     │
 *              delete │  ── SOFT. the slug is retained.
 *                     ▼
 *               ┌──────────┐
 *               │ deleted  │  invisible everywhere, holds its slug forever
 *               └──────────┘
 *
 *   archived ──▶ draft is FORBIDDEN (409), enforced in the PATCH handler.
 * ```
 *
 * ## The slug predicate is `publishedAt !== null`, and this is the part to not "simplify"
 *
 * A slug is editable while a post has never been public, and frozen forever after. The
 * obvious way to write that is `status !== 'draft'`, and it is wrong in a way that only
 * shows up on one transition: `archived → draft`. A post that was published, indexed, linked
 * and sitting in somebody's RSS reader gets archived, moved back to draft, and its slug
 * unlocks. Rename it and the old URL 404s permanently, with the inbound links pointing at
 * nothing.
 *
 * `publishedAt` is write-once, so it is the only field on this document that reliably
 * answers "was this URL ever public?" - which is the actual question. `status` answers
 * "where is it now", and those differ for exactly the case that matters.
 *
 * ## Delete is soft, and the reason is a metric rather than sentiment
 *
 * `{ slug: 1 }` is unique, so a hard delete frees the slug. A later post can then take it
 * and silently inherit the deleted post's contact attributions: `ContactMessage.sourceSlug`
 * stores the slug as a string, and the blog's kill criterion is "is there at least one
 * message carrying a slug". Reusing one corrupts the single number this whole feature is
 * measured by, in the direction of a false positive. So `status: 'deleted'` holds the slug
 * against reuse and everything public filters on `status: 'published'` anyway.
 *
 * ## `contentUpdatedAt` is not `updatedAt`
 *
 * `updatedAt` is a mongoose timestamp, so the editor's autosave bumps it on every debounce
 * tick. Sourcing the sitemap's `lastModified` from it would claim every post changed several
 * times a minute while somebody was typing - which is exactly the cry-wolf failure
 * `src/app/sitemap.ts` was rewritten to fix for the MBTI pages, arriving from a new
 * direction. Crawlers that learn a feed lies about freshness stop reading the field.
 *
 * `contentUpdatedAt` is bumped only when `title`, `excerpt`, `bodyMarkdown` or `coverImage`
 * actually changed value. Sitemap `lastModified` and JSON-LD `dateModified` both read it.
 */

/**
 * Exactly three, declared here rather than left a free string.
 *
 * A free-text series field produces `measured-in-production`, `Measured in production` and
 * `measured_in_prod` within a month, which turns the cluster pages into three pages with one
 * post each. The closed union makes a typo a validation error at save time instead.
 */
export const POST_SERIES = [
  'measured-in-production',
  'shipping-side-products',
  'dev-career-vn',
] as const
export type PostSeries = (typeof POST_SERIES)[number]

export const POST_STATUSES = ['draft', 'published', 'archived', 'deleted'] as const
export type PostStatus = (typeof POST_STATUSES)[number]

export const POST_KINDS = ['article', 'note'] as const
export type PostKind = (typeof POST_KINDS)[number]

export const SLUG_PATTERN = /^[a-z0-9-]{1,80}$/
export const TAG_PATTERN = /^[a-z0-9-]{1,32}$/

/**
 * Slugs a post may not take, enforced here AND at every write path.
 *
 * The justification is narrower than it first looks, and worth stating correctly because the
 * first version of this list was defended with an analysis that turned out to be false.
 *
 * `page` does NOT collide with a future `/blog/page/2` pagination route. That was the
 * original reasoning and it was tested and disproved: a post slugged `page` and a route at
 * `blog/page/[page-num]` coexist, both build, both return 200, because the pagination route
 * is one segment deeper and never competes. What `page` actually guards is a future bare
 * `blog/page/page.tsx`, which WOULD collide.
 *
 * `feed` and `rss` guard the RSS route at `/blog/rss.xml`. Note that `rss.xml` itself can
 * never match `SLUG_PATTERN` - the dot is not in the charset - so listing it would be dead
 * weight, and it is deliberately absent.
 *
 * `privacy` guards `/blog/privacy`. Kept short on purpose: every entry here is a word an
 * author cannot use, so the list earns its length one route at a time.
 */
export const RESERVED_SLUGS = new Set(['page', 'feed', 'rss', 'privacy'])

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug)
}

export type PostDocument = {
  slug: string
  language: 'vi' | 'en'
  title: string
  excerpt: string
  kind: PostKind
  series: PostSeries | null
  isPillar: boolean
  bodyMarkdown: string
  bodyHtml: string
  /** Which pipeline version produced `bodyHtml`. Changing the renderer strands old posts. */
  renderedWith: string
  coverImage: string | null
  tags: string[]
  relatedSlugs: string[]
  status: PostStatus
  /** Write-once. The slug-immutability predicate - see the header. */
  publishedAt: Date | null
  /** NOT `updatedAt`. Bumped only on real content change. */
  contentUpdatedAt: Date
  createdAt: Date
  updatedAt: Date
}

const postSchema = new Schema<PostDocument>(
  {
    slug: {
      type: String,
      required: true,
      match: SLUG_PATTERN,
      validate: {
        validator: (value: string) => !isReservedSlug(value),
        message: props => `"${props.value}" is a reserved slug`,
      },
    },
    language: { type: String, enum: ['vi', 'en'], default: 'en' },
    title: { type: String, required: true, maxlength: 140 },
    excerpt: { type: String, default: '', maxlength: 300 },
    kind: { type: String, enum: POST_KINDS, required: true, default: 'note' },
    series: { type: String, enum: [...POST_SERIES, null], default: null },
    isPillar: { type: Boolean, default: false },
    // `select: false` on both bodies: the index page, the sitemap, RSS and
    // generateStaticParams all list many posts and none of them needs either field. A
    // default-excluded heavy field cannot be pulled into a list query by accident.
    bodyMarkdown: { type: String, default: '', maxlength: 200_000, select: false },
    bodyHtml: { type: String, default: '', maxlength: 400_000, select: false },
    renderedWith: { type: String, default: '' },
    coverImage: { type: String, default: null },
    tags: {
      type: [String],
      default: [],
      validate: {
        validator: (value: string[]) =>
          value.length <= 8 && value.every(tag => TAG_PATTERN.test(tag)),
        message: 'tags must be at most 8 entries matching ^[a-z0-9-]{1,32}$',
      },
    },
    relatedSlugs: {
      type: [String],
      default: [],
      validate: {
        validator: (value: string[]) => value.length <= 5,
        message: 'relatedSlugs is capped at 5',
      },
    },
    status: { type: String, enum: POST_STATUSES, required: true, default: 'draft' },
    publishedAt: { type: Date, default: null },
    contentUpdatedAt: { type: Date, default: Date.now },
  },
  {
    collection: 'posts',
    timestamps: true,
    versionKey: false,
  }
)

/** Identity, and the `$in` lookup that resolves `relatedSlugs`. */
postSchema.index({ slug: 1 }, { unique: true })

/** The index page, the sitemap, RSS and `generateStaticParams` all ask this exact question. */
postSchema.index({ status: 1, publishedAt: -1 })

/** Cluster pages: every post in a series, newest first. */
postSchema.index({ series: 1, status: 1 })

/**
 * At most one pillar per series, held by the database rather than by a convention.
 *
 * A unit test cannot hold this invariant. It is a cross-document constraint, so the only
 * thing that can enforce it under concurrent writes is an index, and the failure it prevents
 * is two hub pages competing for the same cluster's internal links.
 *
 * **Both clauses of the partial filter are required, and the second one is a lesson this
 * repo already paid for.** `isPillar: true` so that ordinary posts do not collide with each
 * other on a shared series. `series: { $type: 'string' }` so that posts with `series: null`
 * do not either - and note that `sparse: true` would NOT work here, because `sparse` skips
 * documents where the field is *missing* and this schema declares `default: null`, making it
 * present-and-null on every post without a series. `IqAttempt.certificateId` is the same
 * present-and-null shape and `tests/api/retention.test.ts` records that getting this wrong
 * "cost a 500 on /api/iq/start to learn": the second document ever created was rejected as a
 * duplicate key on `null`. The happy path passed; the second visitor did not.
 */
postSchema.index(
  { series: 1 },
  {
    unique: true,
    partialFilterExpression: { isPillar: true, series: { $type: 'string' } },
  }
)

/**
 * Index builds report failure through an event, not a rejected promise, so without this a
 * failed build is silent. Here the stakes are the slug uniqueness constraint and the pillar
 * invariant: if `{ slug: 1 }` unique fails to build, two posts can take one URL and the
 * soft-delete reasoning above stops holding.
 */
postSchema.on('index', (error: unknown) => {
  if (error) {
    console.error('[Post] index build FAILED - slug uniqueness is not being enforced', error)
  }
})

export const PostModel: mongoose.Model<PostDocument> = compileModel('Post', postSchema)
