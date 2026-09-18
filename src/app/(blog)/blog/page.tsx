import type { Metadata } from 'next'
import Link from 'next/link'

import AvailabilityBlock from '@/components/blog/AvailabilityBlock'
import PostCard from '@/components/blog/PostCard'
import SubscribeForm from '@/components/blog/SubscribeForm'
import { listPublishedPosts, type PostListItem } from '@/lib/blog/post-data'
import { buildBlogIndexMetadata } from '@/lib/blog/seo'
import { resolveSiteOrigin } from '@/lib/seo'
import { POST_SERIES, type PostSeries } from '@/lib/blog/constants'

/**
 * `/blog` - the index, and the hub the clusters hang off.
 *
 * ```
 *   revalidate = 300     same window as a post. revalidatePublishedPost clears both.
 *        │
 *        ├─ pillars      one per series, the entry points
 *        ├─ by series    measured-in-production · shipping-side-products · dev-career-vn
 *        └─ everything else, newest first
 * ```
 *
 * ## No language filter, and no bilingual index (D7)
 *
 * The blog is English-only. The Vietnamese version of a post is written as a *native* Viblo
 * post - a different piece of writing for a different audience - not a translation of this
 * URL. So there is no language switch here, no `hreflang`, and no mixed-language list to
 * partition. `Post.language` still exists and defaults to `'en'`; it drives `<article lang>`
 * and `og:locale` for the rare post that is not.
 *
 * ## Why this queries once and groups in memory
 *
 * Three series plus an ungrouped remainder is four queries if you ask the database, and it
 * is one query and a `reduce` if you do not. The success criterion for this whole feature is
 * five posts in six weeks, so the list this groups is measured in tens of documents - and
 * both bodies are `select: false`, so what comes back is titles and dates.
 *
 * Pagination is deliberately absent until the index passes 30 posts. What ships now is only
 * the irreversible half of that decision: `page` is on the reserved-slug denylist, so the
 * route stays available whenever it is wanted.
 */

export const revalidate = 300

export async function generateMetadata(): Promise<Metadata> {
  return buildBlogIndexMetadata(resolveSiteOrigin().replace(/\/$/, ''))
}

const SERIES_COPY: Record<PostSeries, { title: string; blurb: string }> = {
  'measured-in-production': {
    title: 'Measured in production',
    blurb: 'Things I tested against a real build, where the result contradicted the docs.',
  },
  'shipping-side-products': {
    title: 'Shipping side products',
    blurb: 'Two personality tests with real traffic, and what that traffic did and did not do.',
  },
  'dev-career-vn': {
    title: 'A developer career, from Vietnam',
    blurb: 'How the work actually gets found, through one lens rather than general advice.',
  },
}

export default async function BlogIndexPage() {
  /**
   * NOT wrapped in try/catch, unlike `generateStaticParams`.
   *
   * The asymmetry is deliberate and the difference is blast radius. A throw in
   * `generateStaticParams` fails the whole deploy, taking `/` and every test page with it,
   * so it has to degrade. A throw here fails this one request and renders the error boundary
   * - which is the honest outcome, because an index that swallowed the error would render as
   * an empty blog and tell a reader there is nothing to read.
   */
  const posts = await listPublishedPosts()

  const pillars = posts.filter(post => post.isPillar)
  const bySeries = new Map<PostSeries, PostListItem[]>()
  for (const series of POST_SERIES) bySeries.set(series, [])
  const unclustered: PostListItem[] = []

  for (const post of posts) {
    if (post.isPillar) continue
    if (post.series) bySeries.get(post.series)?.push(post)
    else unclustered.push(post)
  }

  return (
    <>
      <div className='mx-auto w-full max-w-editorial px-gutter py-12'>
        <header>
          <p className='text-[11px] font-semibold uppercase tracking-[0.16em] text-pp-muted'>
            Writing
          </p>
          <h1 className='mt-2 font-display text-3xl font-semibold text-pp-text sm:text-4xl'>
            Things I measured while shipping
          </h1>
          <p className='mt-4 max-w-[60ch] text-lg leading-relaxed text-pp-muted'>
            Mostly Next.js, mostly the parts the documentation did not say. Every post here
            has a number in it or a failure with a name.
          </p>
          <div className='mt-5 flex flex-wrap gap-4 text-sm'>
            <Link href='/' className='text-pp-muted no-underline hover:text-pp-text'>
              Portfolio
            </Link>
            <Link href='/cv' className='text-pp-muted no-underline hover:text-pp-text'>
              CV
            </Link>
            <Link href='/blog/rss.xml' className='text-pp-muted no-underline hover:text-pp-text'>
              RSS
            </Link>
          </div>
        </header>

        {posts.length === 0 ? (
          /*
            An explicit empty state rather than a bare blank page. This renders exactly once
            in the site's life - between the blog shipping and the first post - and a visitor
            who arrives then should see that the surface is new, not that it is broken.
          */
          <p className='mt-16 text-pp-muted'>Nothing published yet. The first posts are in progress.</p>
        ) : null}

        {pillars.length > 0 ? (
          <section className='mt-14'>
            <h2 className='font-display text-sm font-semibold uppercase tracking-[0.14em] text-pp-muted'>
              Start here
            </h2>
            <div className='mt-5 grid gap-5 sm:grid-cols-2'>
              {pillars.map(post => (
                <PostCard key={post.slug} post={post} featured />
              ))}
            </div>
          </section>
        ) : null}

        {POST_SERIES.map(series => {
          const items = bySeries.get(series) ?? []
          if (items.length === 0) return null

          return (
            <section key={series} className='mt-14'>
              <h2 className='font-display text-xl font-semibold text-pp-text'>
                {SERIES_COPY[series].title}
              </h2>
              <p className='mt-1 max-w-[60ch] text-sm text-pp-muted'>{SERIES_COPY[series].blurb}</p>
              <div className='mt-5 grid gap-5 sm:grid-cols-2'>
                {items.map(post => (
                  <PostCard key={post.slug} post={post} />
                ))}
              </div>
            </section>
          )
        })}

        {unclustered.length > 0 ? (
          <section className='mt-14'>
            <h2 className='font-display text-xl font-semibold text-pp-text'>Everything else</h2>
            <div className='mt-5 grid gap-5 sm:grid-cols-2'>
              {unclustered.map(post => (
                <PostCard key={post.slug} post={post} />
              ))}
            </div>
          </section>
        ) : null}
        {/*
          At the foot of the page and nowhere else. No modal, no scroll trigger, no article
          wall - interrupting a reader to harvest an address trades the only thing this
          surface has for a metric nobody is measured on.
        */}
        <SubscribeForm />
      </div>

      <AvailabilityBlock locale='en' />
    </>
  )
}
