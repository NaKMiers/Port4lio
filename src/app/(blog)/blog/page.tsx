import type { Metadata } from 'next'
import Link from 'next/link'

import AvailabilityBlock from '@/components/blog/AvailabilityBlock'
import BlogIndexHeader from '@/components/blog/BlogIndexHeader'
import BlogIndexList from '@/components/blog/BlogIndexList'
import Breadcrumbs from '@/components/blog/Breadcrumbs'
import SubscribeForm from '@/components/blog/SubscribeForm'
import { listPublishedPosts } from '@/lib/blog/post-data'
import { buildBlogIndexJsonLd, buildBlogIndexMetadata } from '@/lib/blog/seo'
import { loadPublicProfileUncached } from '@/lib/profile-data'
import { resolveSiteOrigin } from '@/lib/seo'
import { kindPresentationMap } from '@/lib/blog/kind-data'
import { listSeries } from '@/lib/blog/series-data'

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

/**
 * ## The read here is guarded and `generateStaticParams`' is not
 *
 * `buildBlogIndexMetadata` derives `keywords` from the tags across published posts, so it
 * wants the list - but a database blip must not cost this page its title, canonical URL and
 * share card as well. The catch degrades to the keyword-free metadata, which is every field
 * that actually matters.
 */
export async function generateMetadata(): Promise<Metadata> {
  const origin = resolveSiteOrigin().replace(/\/$/, '')

  try {
    return buildBlogIndexMetadata(origin, await listPublishedPosts())
  } catch (error) {
    console.error(
      '[blog] index metadata degraded - posts unavailable for keywords',
      error
    )
    return buildBlogIndexMetadata(origin)
  }
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
  /*
    Two reads, not one, and they are independent - so `Promise.all` rather than sequential
    awaits. `listSeries` is what used to be the `POST_SERIES` constant plus the `SERIES_COPY`
    map that lived in this file; both moved into `blog_series` so the owner can manage them
    from the editor. See `models/Series.ts`.
  */
  const [posts, allSeries, kinds, profile] = await Promise.all([
    listPublishedPosts(),
    listSeries(),
    // One lookup for the whole page. A card resolving its own kind would be a query per
    // post, on a page whose entire job is to be fast for a stranger arriving from a
    // cross-post.
    kindPresentationMap(),
    // For the `Person` node in the graph below. The index had no structured data at all,
    // which made it the one page in a hub-and-spoke model that a crawler could learn nothing
    // about - every post pointed at a blog that was never described.
    loadPublicProfileUncached(),
  ])

  const origin = resolveSiteOrigin().replace(/\/$/, '')

  /**
   * The three most common tags, for the one-line "mostly X, Y, Z" in the header.
   *
   * Derived rather than written down: a hand-kept list describes what somebody hoped to
   * publish rather than what is actually here, and goes quietly wrong the first time the
   * blog's subject drifts. `seo.ts` derives its `keywords` from the same place for the same
   * reason.
   */
  const topics = Object.entries(
    posts
      .flatMap(post => post.tags)
      .reduce<Record<string, number>>((counts, tag) => {
        counts[tag] = (counts[tag] ?? 0) + 1
        return counts
      }, {})
  )
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([tag]) => tag)

  return (
    <>
      <script
        type="application/ld+json"
        // `JSON.stringify` output through `escapeJsonForInlineScript`, over stored fields
        // only - see `serializeGraph` in `lib/blog/seo.ts`.
        dangerouslySetInnerHTML={{
          __html: buildBlogIndexJsonLd(origin, profile, posts),
        }}
      />

      <div className="mx-auto w-full max-w-editorial flex-1 px-gutter py-12">
        {/*
          The trail this page's `BreadcrumbList` describes, rendered rather than only
          declared. Two levels is a short trail, and it is still the one Google prints in
          place of the raw URL in a result. See `components/blog/Breadcrumbs.tsx`.
        */}
        <Breadcrumbs
          trail={[
            { name: 'Home', href: '/' },
            { name: 'Writing', href: '/blog' },
          ]}
        />

        <BlogIndexHeader
          postCount={posts.length}
          topics={topics}
        />

        {posts.length === 0 ? (
          /*
            An explicit empty state rather than a bare blank page. This renders exactly once
            in the site's life - between the blog shipping and the first post - and a visitor
            who arrives then should see that the surface is new, not that it is broken.

            Rendered here rather than inside `BlogIndexList` so the search box is not offered
            over nothing at all.
          */
          <p className="mt-16 text-pp-muted">
            Nothing published yet. The first posts are in progress.
          </p>
        ) : (
          /*
            The grouping and the search both live in a client component, because search needs
            state. It still renders on the server for the initial HTML, so a crawler sees the
            full grouped list; only the input needs hydration. See `BlogIndexList`.

            `kinds` is handed over as entries rather than as the `Map` it is on the server: a
            `Map` does not survive serialisation across the server-to-client boundary.
          */
          <BlogIndexList
            posts={posts}
            series={allSeries}
            kinds={Array.from(kinds)}
          />
        )}

        {/*
          At the foot of the page and nowhere else. No modal, no scroll trigger, no article
          wall - interrupting a reader to harvest an address trades the only thing this
          surface has for a metric nobody is measured on.
        */}
        <SubscribeForm />
      </div>

      <AvailabilityBlock locale="en" />
    </>
  )
}
