/**
 * The blog's value sets, with no mongoose attached.
 *
 * ## Why these are not in `models/Post.ts`, where they started
 *
 * They were, and it broke the build the moment the editor needed them. `BlogEditor.tsx` is a
 * client component and it renders a `<select>` of series, so it imported `POST_SERIES` from
 * the model - which imports `mongoose`, which imports `mongodb`, which reaches
 * `client-side-encryption/mongocryptd_manager.js`. The whole driver was pulled into the
 * browser bundle:
 *
 * ```
 *   BlogEditor.tsx  →  models/Post.ts  →  mongoose  →  mongodb  →  ...
 *   [Client Component Browser]
 * ```
 *
 * The failure is loud - `next build` refuses - which is the good case. The bad version of
 * the same mistake is a constant duplicated into the component "just for the dropdown",
 * which builds fine and then drifts from the enum the database actually validates against,
 * so the editor offers a series that saving rejects.
 *
 * So the values live here, in a module with no imports at all, and `models/Post.ts` imports
 * them to build its schema enums. One source of truth, reachable from both sides.
 *
 * ## Why `series` is a closed set, and why it is no longer a union
 *
 * A free-text field produces `measured-in-production`, `Measured in production` and
 * `measured_in_prod` inside a month, and the cluster pages become three pages with one post
 * each. The set stays closed for that reason - a series a post references must exist - but
 * the list moved to the `blog_series` collection so it can be managed from the editor
 * without a deploy. See `models/Series.ts`.
 *
 * What is left here is the SEED, not the source of truth. `ensureSeriesSeeded` upserts these
 * three on first read so an existing database - where every post already references one of
 * them by slug - keeps rendering. Nothing else should import them: a new caller wanting "the
 * list of series" wants the collection, and one reading this tuple would be reading a
 * snapshot from before the feature existed.
 *
 * `PostSeries` is now `string` rather than a union of these three. That is a real loss of
 * compile-time safety and it is the unavoidable price of a runtime-editable list: a value
 * only known at runtime cannot narrow a type at build time. Validation moved to the write
 * path, which is where it can consult the collection.
 */

export const SEED_SERIES = [
  {
    slug: 'measured-in-production',
    title: 'Measured in production',
    blurb: 'Things I tested against a real build, where the result contradicted the docs.',
  },
  {
    slug: 'shipping-side-products',
    title: 'Shipping side products',
    blurb: 'Two personality tests with real traffic, and what that traffic did and did not do.',
  },
  {
    slug: 'dev-career-vn',
    title: 'A developer career, from Vietnam',
    blurb: 'How the work actually gets found, through one lens rather than general advice.',
  },
] as const

/** A series slug is a URL-ish identifier, same charset as a post slug but shorter. */
export const SERIES_SLUG_PATTERN = /^[a-z0-9-]{1,48}$/

export type PostSeries = string

export const POST_STATUSES = ['draft', 'published', 'archived', 'deleted'] as const
export type PostStatus = (typeof POST_STATUSES)[number]

/**
 * The seed for `blog_kinds`, and - like `SEED_SERIES` - no longer the source of truth.
 *
 * `eyebrow` is the one thing `kind` has ever changed on screen: `PostCard` printed "Note"
 * above the title for notes and nothing for articles. See `models/Kind.ts`.
 *
 * `article` comes first so it is what `POST /api/admin/blog` picks for a new draft. The
 * schema's old `default: 'note'` used to decide that, and a default baked into a schema
 * cannot survive its value being deleted from an editable list.
 */
export const SEED_KINDS = [
  { slug: 'article', label: 'Article', eyebrow: false },
  { slug: 'note', label: 'Note', eyebrow: true },
] as const

/** Same charset as a series slug. A kind is an identifier, not a sentence. */
export const KIND_SLUG_PATTERN = /^[a-z0-9-]{1,48}$/

export type PostKind = string

export const SLUG_PATTERN = /^[a-z0-9-]{1,80}$/
export const TAG_PATTERN = /^[a-z0-9-]{1,32}$/

/**
 * Slugs a post may not take, enforced at the model AND at every write path.
 *
 * The justification is narrower than it looks, and worth stating correctly because the first
 * version of this list was defended with an analysis that turned out to be false.
 *
 * `page` does NOT collide with a future `/blog/page/2` pagination route. That was the
 * original reasoning and it was tested and disproved: a post slugged `page` and a route at
 * `blog/page/[page-num]` coexist, both build, and both return 200, because the pagination
 * route is one segment deeper and never competes. What `page` actually guards is a future
 * bare `blog/page/page.tsx`, which would collide.
 *
 * `feed` and `rss` guard the RSS route. Note that `rss.xml` itself can never match
 * `SLUG_PATTERN` - the dot is not in the charset - so listing it would be dead weight, and
 * it is deliberately absent.
 *
 * `privacy` guards `/blog/privacy`, which exists. Kept short on purpose: every entry is a
 * word an author cannot use, so the list earns its length one real route at a time.
 */
export const RESERVED_SLUGS = new Set(['page', 'feed', 'rss', 'privacy'])

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug)
}
