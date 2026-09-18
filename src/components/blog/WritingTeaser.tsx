import { ArrowRight } from 'lucide-react'
import Link from 'next/link'

import { listPublishedPosts } from '@/lib/blog/post-data'

/**
 * Three recent post titles, for `/` and `/cv`.
 *
 * ## Why this is the highest-value link on the site, and not a nice-to-have
 *
 * Without it the blog is an orphan: reachable from the sitemap and from wherever a post was
 * cross-posted, and from nowhere on the site itself. Every review of this plan said the same
 * thing independently, and the reasoning is about who actually arrives.
 *
 * The realistic recruiter does not find a post and then discover the person. They already
 * have the name - from a CV, a referral, a LinkedIn message - and they open `/` and decide in
 * roughly twenty seconds. On that path, three post titles are not a navigation aid, they ARE
 * the payload: they are the only thing on the page that demonstrates the work rather than
 * asserting it. "Five things Next.js 16 did that its docs didn't say" does a job that a
 * skills list cannot.
 *
 * ## Titles, not cards
 *
 * No excerpts, no covers, no dates. This is a block inside somebody else's page and its job
 * is to be scanned in two seconds, not read. It also renders nothing at all when there are no
 * published posts - an empty "Writing" heading on the portfolio would advertise an abandoned
 * section, which is worse than no section, and it is the exact state the site is in between
 * this shipping and the first post going live.
 *
 * ## Why the query failing is not allowed to matter
 *
 * `/` is the most important page on the site and this is a footnote on it. A database blip
 * while loading three titles must not take the portfolio down, so the catch renders nothing
 * and logs. This is the opposite call from `/blog` itself, where an empty list is worth
 * failing loudly over because it IS the page.
 */
export default async function WritingTeaser({ limit = 3 }: { limit?: number }) {
  let posts: { slug: string; title: string }[] = []

  try {
    posts = (await listPublishedPosts()).slice(0, limit)
  } catch (error) {
    console.error('[blog] WritingTeaser could not load posts - rendering nothing', error)
    return null
  }

  if (posts.length === 0) return null

  return (
    <div className='rounded-panel border border-pp-line bg-[var(--pp-panel)] p-5'>
      <div className='flex items-baseline justify-between gap-4'>
        <h2 className='text-[11px] font-semibold uppercase tracking-[0.16em] text-pp-muted'>
          Writing
        </h2>
        <Link
          href='/blog'
          className='inline-flex items-center gap-1 text-xs font-semibold text-pp-blue no-underline hover:underline'
        >
          All posts
          <ArrowRight aria-hidden size={13} />
        </Link>
      </div>

      <ul className='mt-3 space-y-2'>
        {posts.map(post => (
          <li key={post.slug}>
            <Link
              href={`/blog/${post.slug}`}
              className='font-display text-sm font-semibold leading-snug text-pp-text no-underline hover:text-pp-blue'
            >
              {post.title}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
