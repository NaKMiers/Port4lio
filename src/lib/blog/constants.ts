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
 * ## Why `series` is a closed union at all
 *
 * A free-text field produces `measured-in-production`, `Measured in production` and
 * `measured_in_prod` inside a month, and the cluster pages become three pages with one post
 * each. The union makes a typo a validation error at save time rather than a silent split.
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
