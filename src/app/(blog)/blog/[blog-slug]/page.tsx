import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import AvailabilityBlock from '@/components/blog/AvailabilityBlock'
import Breadcrumbs from '@/components/blog/Breadcrumbs'
import PostByline from '@/components/blog/PostByline'
import PostToc from '@/components/blog/PostToc'
import PostTracker from '@/components/blog/PostTracker'
import {
  listPublishedSlugs,
  listSeriesPeers,
  readPublishedPost,
  resolveRelatedSlugs,
} from '@/lib/blog/post-data'
import { countProseWords, readingMinutes } from '@/lib/blog/reading'
import { buildPostJsonLd, buildPostMetadata, postUrl } from '@/lib/blog/seo'
import { listSeries } from '@/lib/blog/series-data'
import { extractToc, TOC_MIN_ENTRIES } from '@/lib/blog/toc'
import { loadPublicProfileUncached } from '@/lib/profile-data'
import { collapseWhitespace } from '@/lib/profile-copy'
import { resolveSiteOrigin } from '@/lib/seo'

/**
 * One post.
 *
 * ```
 *   revalidate = 300           ISR shell, invalidated on demand by revalidatePublishedPost
 *   dynamicParams = true       a slug not in the list below renders on first request
 *   generateStaticParams       try/catch → []   ← MANDATORY. see below.
 * ```
 *
 * ## `generateStaticParams` must never throw, and this is not defensive programming
 *
 * It calls `connectDatabase()`, which throws on any Atlas hiccup, and Vercel build machines
 * have no stable egress IP - so an IP allowlist, a brief cluster failover or a cold Atlas
 * instance all present here as a thrown connection error at build time.
 *
 * A throw out of this function does not fail this route. It fails **the entire build**:
 * `Failed to collect page data for /blog/[blog-slug]`, non-zero exit, deploy aborted. That
 * takes down `/`, `/cv`, all 35 MBTI and IQ pages and the sitemap - the whole site offline
 * because the blog could not reach its database for a second. Verified by making it throw.
 *
 * Returning `[]` is completely correct rather than merely safe, and that is what
 * `dynamicParams = true` buys: with no params prerendered, every post renders on its first
 * request and is cached from then on. The cost of a build-time database blip becomes a
 * slightly slower first hit per post. The cost of not catching is the site.
 *
 * ## No `layout.tsx` in this segment
 *
 * `<article lang>` below is why somebody would add one, and it cannot work: only the root
 * layout may render `<html>`, and `src/app/layout.tsx` hardcodes `lang='en'`. A nested
 * layout also cannot read its page's data, so it would need a second query for the same
 * document to learn the language. `lang` on the wrapping element is this repo's existing
 * answer - `TestChrome.tsx` does exactly this - and it is what assistive tech and Google
 * both read for a subtree.
 *
 * ## What this page does for search, beyond the metadata
 *
 * Five things, and each is a signal that only exists if it is rendered rather than declared:
 *
 * ```
 *   Breadcrumbs        visible trail matching the BreadcrumbList JSON-LD
 *   PostToc            in-page anchors, which is what "jump to" links in results need
 *   cover <figure>     the primaryImageOfPage, actually on the page it claims to illustrate
 *   series peers       every post in a cluster reachable from every other one
 *   tags               the `keywords` and `about` values, visible to a reader too
 * ```
 *
 * Structured data that describes things a visitor cannot see is the mismatch Google's
 * guidelines name explicitly, so none of this is decoration around the JSON-LD - it is the
 * half that makes the JSON-LD true.
 */

export const revalidate = 300
export const dynamicParams = true

type PageProps = { params: Promise<{ 'blog-slug': string }> }

export async function generateStaticParams() {
  try {
    const slugs = await listPublishedSlugs()
    return slugs.map(slug => ({ 'blog-slug': slug }))
  } catch (error) {
    // Logged loudly because the symptom - every post suddenly rendering on demand - is
    // invisible in a successful build otherwise.
    console.error(
      '[blog] generateStaticParams failed, falling back to on-demand rendering. The build is CORRECT but nothing is prerendered; dynamicParams=true covers it.',
      error
    )
    return []
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { 'blog-slug': slug } = await params
  const post = await readPublishedPost(slug)
  if (!post) return {}

  const origin = resolveSiteOrigin().replace(/\/$/, '')
  const profile = await loadPublicProfileUncached()

  return buildPostMetadata(post, origin, profile)
}

export default async function BlogPostPage({ params }: PageProps) {
  const { 'blog-slug': slug } = await params
  const post = await readPublishedPost(slug)

  // `readPublishedPost` filters on `status: 'published'`, so drafts, archived and
  // soft-deleted posts all land here identically - a 404, with no hint that the slug exists.
  if (!post) notFound()

  const origin = resolveSiteOrigin().replace(/\/$/, '')

  /*
    Four independent reads, so `Promise.all` rather than four awaits. None depends on another,
    and this page is the one a stranger arriving from a cross-post lands on - the difference
    between one round trip and four is the difference between a fast page and a page that
    feels like it is thinking.

    `listSeries` is a whole-collection read of a list measured in single digits, and it is here
    for one field: the series' human TITLE. `post.series` is a slug, and `articleSection:
    'measured-in-production'` in the JSON-LD is a label written for nobody.
  */
  const [profile, related, seriesPeers, allSeries] = await Promise.all([
    loadPublicProfileUncached(),
    resolveRelatedSlugs(post.relatedSlugs ?? []),
    listSeriesPeers(post.series, post.slug),
    listSeries(),
  ])

  const series = post.series ? allSeries.find(entry => entry.slug === post.series) : undefined

  /*
    A post the author hand-picked as related is very often also in the same series, and
    printing it under both headings reads as a bug. `related` wins because it is the editorial
    choice; the series list is what fills in around it.
  */
  const relatedSlugSet = new Set(related.map(item => item.slug))
  const seriesOnly = seriesPeers.filter(item => !relatedSlugSet.has(item.slug))
  const words = countProseWords(post.bodyHtml)
  const minutes = readingMinutes(words)

  /*
    A contents list is worth the space above the fold only on a post with real structure, and
    a post still stored as `blog-md-1` has no heading ids at all - see BLOG_PIPELINE_VERSION.
    Both cases resolve to the same thing here: no list, rather than a stub of one.
  */
  const toc = extractToc(post.bodyHtml)
  const showToc = toc.length >= TOC_MIN_ENTRIES

  const authorName = collapseWhitespace(profile.fullName) || 'Anh Khoa Nguyen'

  /*
    Deduped, because the two lists overlap by design: an author naming a post from the same
    series in `relatedSlugs` is the normal case, not an edge one, and `relatedLink` listing
    one URL twice is a self-evidently sloppy graph.
  */
  const relatedUrls = Array.from(
    new Set([...related, ...seriesOnly].map(item => postUrl(origin, item.slug)))
  )

  return (
    <>
      <script
        type='application/ld+json'
        // The only `dangerouslySetInnerHTML` allowed to take a non-post string, and its
        // input is `JSON.stringify` output run through `escapeJsonForInlineScript` - never
        // author markdown. See `serializeGraph` in `lib/blog/seo.ts`.
        dangerouslySetInnerHTML={{
          __html: buildPostJsonLd({
            post,
            origin,
            profile,
            seriesTitle: series?.title ?? null,
            // Only the links the page actually renders. `relatedLink` describing a link that
            // is not there is the same mismatch as a breadcrumb trail nobody can see.
            relatedUrls,
            wordCount: words,
            readingMinutes: minutes,
          }),
        }}
      />

      <div className='mx-auto w-full max-w-editorial flex-1 px-gutter py-10'>
        <Breadcrumbs
          trail={[
            { name: 'Home', href: '/' },
            { name: 'Writing', href: '/blog' },
            { name: post.title, href: `/blog/${post.slug}` },
          ]}
        />

        {/*
          `lang` on the article, not the document. See the header - only the root layout can
          render `<html>`. This is the element a screen reader switches voice on and the
          subtree Google reads a language from, so it belongs on the content and not on a
          wrapper further out that also contains English navigation.
        */}
        <article lang={post.language}>
          <header className='mb-8'>
            {series ? (
              /*
                The series, above the title, linking to its section on the index. This is the
                cluster's hub link on every post in it - the "up" edge of a hub-and-spoke
                model, which previously existed only as a heading on `/blog` with no way back
                to it from a post.
              */
              <p className='text-[11px] font-semibold uppercase tracking-[0.16em] text-pp-muted'>
                <Link
                  href={`/blog#${series.slug}`}
                  className='text-pp-muted no-underline hover:text-pp-text'
                >
                  {series.title}
                </Link>
              </p>
            ) : null}
            <h1 className='mt-2 font-display text-3xl font-semibold leading-tight text-pp-text sm:text-4xl'>
              {post.title}
            </h1>
            {post.excerpt ? (
              <p className='mt-4 max-w-[62ch] text-lg leading-relaxed text-pp-muted'>
                {post.excerpt}
              </p>
            ) : null}
            <PostByline
              authorName={authorName}
              publishedAt={post.publishedAt}
              contentUpdatedAt={post.contentUpdatedAt}
              readingMinutes={minutes}
            />
          </header>

          {/*
            The cover, on the page rather than only in the share card.

            It was previously referenced by `openGraph.images` and by `image` in the JSON-LD
            and rendered nowhere, so both were claiming an illustration the page did not have -
            and `image` on a BlogPosting is meant to be an image OF the article.

            `fetchPriority='high'` with no `loading='lazy'`: this is the LCP element on any
            post that has one, and lazy-loading the largest above-the-fold image is the single
            most common way a page loses Largest Contentful Paint. The explicit `width`/
            `height` are the authored share-card ratio, and they are here to reserve the box
            before the bytes arrive - without them the text below it jumps when the image
            loads, which is Cumulative Layout Shift, the other Core Web Vital this page can
            fail. Both are ranking inputs, and both are free to get right.

            `<figure>` only when there is a caption, matching `PostCard`: an uncaptioned cover
            is decoration that the `h1` above already describes, so `alt=''` keeps a screen
            reader from reading the post twice.
          */}
          {post.coverImage ? (
            post.coverCaption ? (
              <figure className='mb-8'>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={post.coverImage}
                  alt=''
                  width={1200}
                  height={630}
                  fetchPriority='high'
                  className='aspect-[1200/630] w-full rounded-[0.9rem] border border-pp-line object-cover'
                />
                <figcaption className='mt-2 text-xs leading-relaxed text-pp-muted'>
                  {post.coverCaption}
                </figcaption>
              </figure>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={post.coverImage}
                alt=''
                aria-hidden
                width={1200}
                height={630}
                fetchPriority='high'
                className='mb-8 aspect-[1200/630] w-full rounded-[0.9rem] border border-pp-line object-cover'
              />
            )
          ) : null}

          {showToc ? <PostToc entries={toc} /> : null}

          {/*
            `bodyHtml` was sanitized and highlighted at SAVE time (D9), by the pipeline in
            `lib/blog/markdown.ts`: raw HTML dropped at remark-rehype, everything else through
            `rehype-sanitize`, image hosts restricted to our own Cloudinary, heading ids added
            from a whitelist transform, and only then Shiki. Nothing is rendered here that did
            not go through that, and nothing renders markdown in a request path - Shiki's
            ~5.5s per-process bootstrap is the reason.
          */}
          <div
            className='blog-prose'
            dangerouslySetInnerHTML={{ __html: post.bodyHtml }}
          />

          {/*
            The tags, visible at last. They were already three machine-readable claims -
            `keywords` in the metadata, `keywords` and `about` in the JSON-LD - about a page
            that showed a reader none of them. Rendered as plain text rather than as links,
            deliberately: a tag link needs a `/blog/tag/<tag>` route, and on a blog with five
            posts every one of those is a near-empty page competing with the posts it lists.
            That is thin content, and it is a trade worth making only once the tag has enough
            behind it to be a destination.
          */}
          {post.tags.length > 0 ? (
            <ul
              aria-label='Tags'
              className='mt-10 flex flex-wrap gap-2 border-t border-pp-line pt-6'
            >
              {post.tags.map(tag => (
                <li
                  key={tag}
                  className='rounded-full border border-pp-line px-2.5 py-0.5 text-[11px] text-pp-muted'
                >
                  {tag}
                </li>
              ))}
            </ul>
          ) : null}
        </article>

        {/*
          The view beacon and the share button. A client island, and it has to be: the share
          token is minted ON THE CLICK. Minting it server-side during this render would bake
          one token into the ISR-cached HTML and serve it to every reader for 300 seconds,
          collapsing blog:share:<token> to a single document forever while attributions kept
          growing - a silently, permanently wrong ratio that looks plausible.
        */}
        <div className='mt-10 flex items-center gap-3 border-t border-pp-line pt-6'>
          <PostTracker slug={post.slug} />
          <span className='text-xs text-pp-muted'>
            Sharing this link lets me see the post reached somebody.
          </span>
        </div>

        {seriesOnly.length > 0 && series ? (
          <aside className='mt-14 border-t border-pp-line pt-8'>
            <h2 className='font-display text-sm font-semibold uppercase tracking-[0.14em] text-pp-muted'>
              More in {series.title}
            </h2>
            <ul className='mt-4 space-y-3'>
              {seriesOnly.map(item => (
                <li key={item.slug}>
                  <Link
                    href={`/blog/${item.slug}`}
                    className='font-display text-base font-semibold text-pp-text no-underline hover:text-pp-blue'
                  >
                    {item.title}
                  </Link>
                  {item.excerpt ? (
                    <p className='mt-1 max-w-[62ch] text-sm text-pp-muted'>
                      {/* One line, because this is a nudge and not a second index. */}
                      {item.excerpt}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </aside>
        ) : null}

        {related.length > 0 ? (
          <aside className='mt-14 border-t border-pp-line pt-8'>
            <h2 className='font-display text-sm font-semibold uppercase tracking-[0.14em] text-pp-muted'>
              Related
            </h2>
            <ul className='mt-4 space-y-3'>
              {related.map(item => (
                <li key={item.slug}>
                  <Link
                    href={`/blog/${item.slug}`}
                    className='font-display text-base font-semibold text-pp-text no-underline hover:text-pp-blue'
                  >
                    {item.title}
                  </Link>
                </li>
              ))}
            </ul>
          </aside>
        ) : null}
      </div>

      <AvailabilityBlock locale='en' />
    </>
  )
}
