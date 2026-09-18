import { connectDatabase } from '@/lib/mongodb'
import { PostModel, type PostDocument } from '@/models/Post'

/**
 * Every public read of a post, in one place.
 *
 * ```
 *   listPublishedPosts()   index, RSS, sitemap    ← never the bodies
 *   readPublishedPost()    the post page          ← bodyHtml explicitly selected
 *   listPublishedSlugs()   generateStaticParams   ← slug only
 *   resolveRelatedSlugs()  the post page's footer ← filtered to published
 * ```
 *
 * ## `status: 'published'` is the only filter any of these apply
 *
 * Not `status !== 'draft'`, not "anything with a publishedAt". Four states exist and three of
 * them are private for different reasons - a draft was never public, an archived post was
 * withdrawn deliberately, a deleted post is holding its slug against reuse. A public read
 * that enumerated what to exclude would have to be updated every time a state is added, and
 * the failure of forgetting is that private content serves. Naming the one state that IS
 * public fails the other way: a new state is invisible until somebody decides otherwise.
 *
 * ## No `unstable_cache` anywhere in this file
 *
 * D3 forbids it in the blog read path, and the reason is not performance. Freshness here is
 * route-segment ISR plus `revalidatePath` with a literal path, and that pair was verified end
 * to end. A second cache layer underneath it would be a second thing to invalidate, with its
 * own key derivation, and `revalidatePath` does not touch it - so a published post could
 * clear the ISR shell and still render from a stale data cache. One cache, one invalidation.
 */

/** The fields a list view needs. Both bodies are `select: false`, so they are absent anyway. */
export type PostListItem = Pick<
  PostDocument,
  | 'slug'
  | 'title'
  | 'excerpt'
  | 'kind'
  | 'series'
  | 'isPillar'
  | 'language'
  | 'coverImage'
  | 'tags'
  | 'publishedAt'
  | 'contentUpdatedAt'
>

const LIST_FIELDS =
  'slug title excerpt kind series isPillar language coverImage tags publishedAt contentUpdatedAt'

export async function listPublishedPosts(): Promise<PostListItem[]> {
  await connectDatabase()

  return PostModel.find({ status: 'published' })
    .select(LIST_FIELDS)
    .sort({ publishedAt: -1 })
    .lean<PostListItem[]>()
}

/**
 * One post, with its rendered HTML.
 *
 * `+bodyHtml` is the only place in the codebase that opts back into a `select: false` field,
 * and it is deliberately not `+bodyMarkdown`: the source is the author's working copy and has
 * no business in a public response. The page renders `bodyHtml`, which was sanitized and
 * highlighted at save time (D9).
 */
export async function readPublishedPost(slug: string) {
  await connectDatabase()

  return PostModel.findOne({ slug, status: 'published' })
    .select(`${LIST_FIELDS} +bodyHtml renderedWith`)
    .lean<(PostListItem & { bodyHtml: string; renderedWith: string }) | null>()
}

export async function listPublishedSlugs(): Promise<string[]> {
  await connectDatabase()

  const rows = await PostModel.find({ status: 'published' })
    .select('slug')
    .lean<{ slug: string }[]>()

  return rows.map(row => row.slug)
}

/**
 * Turn a post's `relatedSlugs` into the posts that actually exist and are actually public.
 *
 * **Resolved on read, never reconciled on write**, and that is the whole design. The
 * alternative - maintaining back-references, cleaning them up on delete, rewriting them when
 * a draft's slug changes - is three pieces of bookkeeping that each fail silently when
 * missed, and the thing they buy is avoiding one indexed `$in` query on a page that is
 * already ISR-cached for 300 seconds.
 *
 * Resolving on read makes three problems disappear rather than solving them. A related post
 * that is deleted renders no link, with no cleanup step. A related post that is archived
 * stops linking the moment it is archived and starts again if it is restored. And a draft
 * whose slug is edited after a published post referenced it simply resolves to nothing,
 * instead of leaving a dangling reference that 404s a reader.
 *
 * Misses are dropped, not reported. A missing related post is a link that is not drawn, which
 * is correct and invisible; the author sees it in the editor, where the list is theirs.
 */
export async function resolveRelatedSlugs(slugs: string[]): Promise<PostListItem[]> {
  if (slugs.length === 0) return []

  await connectDatabase()

  const found = await PostModel.find({ slug: { $in: slugs }, status: 'published' })
    .select(LIST_FIELDS)
    .lean<PostListItem[]>()

  // Returned in the author's stated order rather than the database's. The order is an
  // editorial decision - the first related link is the one most people click.
  const bySlug = new Map(found.map(post => [post.slug, post]))
  return slugs.map(slug => bySlug.get(slug)).filter((post): post is PostListItem => Boolean(post))
}
