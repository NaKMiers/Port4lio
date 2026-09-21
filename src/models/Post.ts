import mongoose, { Schema } from 'mongoose'

import {
  isReservedSlug,
  MAX_IMAGE_PROMPTS,
  POST_STATUSES,
  SLUG_PATTERN,
  TAG_PATTERN,
} from '@/lib/blog/constants'
import type { PostKind, PostSeries, PostStatus } from '@/lib/blog/constants'
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
 * The value sets live in `lib/blog/constants.ts`, NOT here, and are re-exported.
 *
 * They started in this file, which broke the build: `BlogEditor.tsx` is a client component
 * that renders a `<select>` of series, so importing them from the model pulled mongoose -
 * and through it the whole mongodb driver - into the browser bundle. Duplicating them into
 * the component would build fine and then drift from the enums the database validates
 * against, so the editor would offer a series that saving rejects.
 *
 * Re-exported rather than leaving callers to know the split: `models/Post` is where a reader
 * looks for what a post's fields may contain, and that should keep working.
 */
export {
  POST_STATUSES,
  SLUG_PATTERN,
  TAG_PATTERN,
  RESERVED_SLUGS,
  isReservedSlug,
} from '@/lib/blog/constants'
export type { PostSeries, PostStatus, PostKind } from '@/lib/blog/constants'

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
  coverCaption: string
  /** A text-to-image prompt for the cover. Author working material, never public. */
  coverImagePrompt: string
  /** One prompt per `![image](imageN)` placeholder still in the body. Keyed by that `imageN`. */
  imagePrompts: { key: string; prompt: string }[]
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
    /*
      Vietnamese by default, which is a change and only applies to documents created after it.

      The default is what "Create draft" produces, and the generator's own default moved to `vi`
      at the same time (`LANGUAGE_OPTIONS`, and `resolveLanguage`'s fallback) - leaving this at
      `en` would mean the two creation paths disagreed about the blog's language, with the
      hand-made drafts being the ones that came out wrong.

      Existing documents are untouched: a mongoose default is applied at document creation, not
      at read, so every post already in the collection keeps the language it was stored with.
      There is no migration to run and no backfill wanted - an English post is still an English
      post and `<article lang>` should keep saying so.
    */
    language: { type: String, enum: ['vi', 'en'], default: 'vi' },
    title: { type: String, required: true, maxlength: 140 },
    excerpt: { type: String, default: '', maxlength: 300 },
    /*
      No `enum` and no `default`, for the reasons on `series` below plus one of its own.

      `default: 'note'` was how a new draft got a kind - `POST /api/admin/blog` never sets the
      field. A default baked into a schema cannot survive its value being deleted from an
      editable list: delete `note` and every subsequent draft is created pointing at a kind
      that does not exist, with no write path involved to notice. So the create route now asks
      `defaultKindSlug()` for the first kind by order, and this field is simply required.
    */
    kind: { type: String, required: true },
    /*
      No `enum`, deliberately - and this is the one field on the schema without one.

      A mongoose enum is baked at module load from a value known at build time, which is
      exactly what a runtime-editable list is not. Keeping it would mean the database
      validating against whatever the series list happened to be when the process started,
      so a series created at 10:00 would be rejected by a server booted at 09:00 until it
      restarted - the worst kind of bug, because it depends on deploy timing.

      Validation moved to the write path (`PATCH /api/admin/blog/[id]`), which can consult
      the collection. That is a real downgrade in guarantee: the schema no longer refuses a
      bad value written by some other caller. It is accepted because there is exactly one
      writer, it is gated, and the alternative is a validator that is wrong on a schedule.
    */
    series: { type: String, default: null },
    isPillar: { type: Boolean, default: false },
    // `select: false` on both bodies: the index page, the sitemap, RSS and
    // generateStaticParams all list many posts and none of them needs either field. A
    // default-excluded heavy field cannot be pulled into a list query by accident.
    bodyMarkdown: {
      type: String,
      default: '',
      maxlength: 200_000,
      select: false,
    },
    bodyHtml: { type: String, default: '', maxlength: 400_000, select: false },
    renderedWith: { type: String, default: '' },
    coverImage: { type: String, default: null },
    /**
     * Credit or context for `coverImage`, rendered as the `<figcaption>` under the thumbnail.
     *
     * Short by design - 140, the length of a credit line rather than a paragraph. It is the
     * only text on a card that is not the post's own words, so a caption long enough to
     * compete with the excerpt would be a caption in the wrong place.
     */
    coverCaption: { type: String, default: '', maxlength: 140 },
    /**
     * Prompts for pictures that do not exist yet, and the reason they live on the document.
     *
     * The blog's generator writes posts and cannot draw - the router behind it has no image
     * model - so what it produces instead is a brief: a cover prompt, plus one prompt per
     * `![image](imageN)` placeholder it left in the body. Those are the author's raw material
     * for whatever image tool they use, so they have to survive a reload, which rules out the
     * obvious alternative of keeping them in editor state.
     *
     * NEITHER field is public, and neither is `select: false` either. Every public read names
     * its fields explicitly (`LIST_FIELDS` in `post-data.ts`), so these cannot leak by
     * default the way a `select: true` heavy field could - and `select: false` would mean the
     * ADMIN read needed a `+` prefix to see them, which is a foot-gun pointed at the one
     * caller that does need them.
     *
     * `contentUpdatedAt` is deliberately NOT bumped when these change - see the PATCH
     * handler. A prompt is a note to the author about a picture; it is not text a reader ever
     * sees, so telling the sitemap the post changed would be the same cry-wolf failure that
     * separated `contentUpdatedAt` from `updatedAt` in the first place.
     */
    coverImagePrompt: { type: String, default: '', maxlength: 2000 },
    imagePrompts: {
      type: [
        {
          _id: false,
          key: { type: String, required: true },
          prompt: { type: String, default: '', maxlength: 2000 },
        },
      ],
      default: [],
      validate: {
        // The editor only ever renders keys that are still present in the body, so a stale
        // entry costs a row in this array and nothing on screen. This is the LAST line of
        // defence, not the first: every writer caps itself at `MAX_IMAGE_PROMPTS` first,
        // because failing here throws away a whole paid generation. See the constant.
        validator: (value: { key: string }[]) =>
          value.length <= MAX_IMAGE_PROMPTS,
        message: `imagePrompts is capped at ${MAX_IMAGE_PROMPTS} entries`,
      },
    },
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
    status: {
      type: String,
      enum: POST_STATUSES,
      required: true,
      default: 'draft',
    },
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
  if (error)
    console.error(
      '[Post] index build FAILED - slug uniqueness is not being enforced',
      error
    )
})

export const PostModel: mongoose.Model<PostDocument> = compileModel(
  'Post',
  postSchema
)
