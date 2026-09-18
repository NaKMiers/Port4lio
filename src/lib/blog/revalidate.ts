import { revalidatePath } from 'next/cache'

/**
 * Invalidate every cached surface that can show a post.
 *
 * ```
 *   revalidatePublishedPost('my-slug')
 *        ├─ /blog              the index lists it
 *        ├─ /blog/my-slug      the post itself
 *        ├─ /sitemap.xml       lists it with a lastModified
 *        └─ /blog/rss.xml      lists it with a pubDate
 * ```
 *
 * ## The literal path is not a mistake to be "corrected"
 *
 * `revalidatePath('/blog/my-slug')` - the concrete, expanded path - is what works. Next's own
 * documentation points at the pattern form for dynamic segments:
 *
 * ```js
 *   revalidatePath('/blog/[blog-slug]', 'page')   // ← MEASURED AS A COMPLETE NO-OP
 * ```
 *
 * and on 16.2.6, against this repo's exact `node_modules`, that form invalidated nothing:
 * not build-time prerenders, not on-demand entries. It fails silently, so the symptom is not
 * an error, it is a post the author published being invisible for up to `revalidate` seconds
 * and a sitemap that keeps serving the old date. The literal form was verified end to end,
 * including the case that matters most - clearing a cached 404 for a slug that 404'd before
 * it was published, which is every new post.
 *
 * If a future reader "fixes" this to the documented form, publishing breaks with no error
 * anywhere. That is why the wrong version is written out above rather than just warned about.
 *
 * ## Never wrap these in try/catch
 *
 * Tempting, because `revalidatePath` throws `Invariant: static generation store missing`
 * outside a Next request context - which is why the handlers containing it cannot be
 * unit-tested by direct invocation, and why the falsification test is Playwright against a
 * production server instead.
 *
 * Catching it here would convert "invalidation failed" into "invalidation appeared to
 * succeed". That is precisely the failure `src/lib/ccaf/progress-data.ts` already recorded
 * once on this site: a swallowed cache error that presented as stale data with a green
 * response, and cost real debugging time because every layer reported success. A throw here
 * surfaces as a 500 on a mutating admin request, which the owner sees immediately and can
 * retry - infinitely better than a post that quietly never goes live.
 *
 * ## Called from every mutating handler, not just publish
 *
 * PATCH and DELETE too. Wiring this to status transitions alone was the first draft's plan,
 * and a control run proved the gap: after a delete, `/blog/second` still served its full HTML
 * and the sitemap still listed it. A content edit has the same shape - the post is live, the
 * text changed, and nothing tells the cache.
 */
export function revalidatePublishedPost(slug: string) {
  // Logged before the calls, because if one of them throws this line is the only record of
  // which slug was mid-flight. The board's Force revalidate button exists so the owner can
  // re-run this by hand, and these logs are how they tell an ISR window from a failure.
  console.info(`[blog] revalidating /blog, /blog/${slug}, /sitemap.xml, /blog/rss.xml`)

  revalidatePath('/blog')
  revalidatePath(`/blog/${slug}`)
  revalidatePath('/sitemap.xml')
  revalidatePath('/blog/rss.xml')
}
