import type { MetadataRoute } from 'next'

import { listPublishedPosts } from '@/lib/blog/post-data'
import { LOCALES } from '@/lib/i18n'
import { MBTI_TYPES, slugFromType } from '@/lib/mbti/types'
import { getPublicProfileUpdatedAt } from '@/lib/profile-data'
import { resolveSiteOrigin } from '@/lib/seo'

export const revalidate = 60

/**
 * When the MBTI content last actually changed. Bump this by hand when questions or type
 * descriptions are edited.
 *
 * A literal date, not `new Date()`. With `revalidate = 60` the previous version stamped
 * every MBTI URL with the current time, so the sitemap claimed all 35 pages changed every
 * minute. Crawlers use `lastModified` to decide what is worth re-fetching, and a feed that
 * cries wolf on every URL gets the field ignored - which is the opposite of the freshness
 * signal it is there to provide.
 */
const MBTI_CONTENT_UPDATED_AT = new Date('2026-09-02T00:00:00.000Z')

/**
 * ## Why there are no `alternates` here, even though hreflang matters
 *
 * Next renders `alternates.languages` as `<xhtml:link>` elements and declares
 * `xmlns:xhtml` on `<urlset>`. That is valid sitemap XML and crawlers read it fine - but
 * Chrome's built-in XML tree viewer refuses to engage on any document containing
 * XHTML-namespace elements, because those are potentially renderable HTML. The viewer
 * falls back to default XML styling, where unknown elements are `display: inline` and
 * carry no tag decoration, so `/sitemap.xml` renders as one unreadable paragraph of run
 * together URLs and dates instead of the familiar collapsible tree.
 *
 * Measured on this exact feed, same server and same `application/xml` response, changing
 * nothing but these elements:
 *
 * ```
 *   with <xhtml:link>   documentElement = urlset   viewer off   height  800px  (flat text)
 *   without             documentElement = html     viewer on    height 4083px  (tree)
 * ```
 *
 * The signal is not lost for the pages that have one. Every *localized* page emits its own
 * hreflang set in `<head>` via `alternates.languages` in its `generateMetadata`, and that set
 * additionally carries `x-default`, which the sitemap entries never did. Page-level hreflang
 * is the form Google documents first; the sitemap pair was a redundant second copy.
 *
 * Amended when the blog entered this feed: "every page" stopped being true. Blog posts emit
 * NO hreflang at all, and that is correct rather than an omission - under D7 the blog is
 * English-only and the Vietnamese version of a post is a native Viblo post, a different piece
 * of writing for a different audience, not a translation of this URL. There is no pair to
 * declare, and declaring one would point hreflang at a page on someone else's domain.
 *
 * So this trades a duplicate machine-readable hint for a feed a human can actually read
 * while debugging. If sitemap-level hreflang is ever wanted back, re-adding `alternates`
 * to these entries is all it takes - and the tree view will disappear again.
 */

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = resolveSiteOrigin().replace(/\/$/, '')
  const lm = await getPublicProfileUpdatedAt()

  /**
   * `/blog` and every published post.
   *
   * ## `lastModified` reads `contentUpdatedAt`, never `updatedAt`
   *
   * `updatedAt` is a mongoose timestamp, so the editor's autosave bumps it on every debounce
   * tick. Sourcing this from it would announce that a post changed several times a minute
   * while somebody was typing - which is the cry-wolf failure the `MBTI_CONTENT_UPDATED_AT`
   * constant above exists to fix, arriving from a new direction. A crawler that learns this
   * field lies stops reading it, and then the post that genuinely changed is ignored too.
   *
   * Unlike the MBTI pages, a live per-URL date IS correct here: posts genuinely do change,
   * individually, at times worth telling a crawler about. The hand-maintained constant above
   * is the right answer for content that changes on deploy; this is the right answer for
   * content that changes on save.
   *
   * ## Why the read is guarded and the MBTI list is not
   *
   * The MBTI entries are computed from compiled-in constants and cannot fail. This one hits
   * the database, and `sitemap.ts` is generated at build time as well as revalidated at
   * runtime - so an Atlas blip during a Vercel build would otherwise fail the deploy and take
   * `/`, `/cv` and all 35 test pages down with the blog. Same reasoning as
   * `generateStaticParams`, same resolution: log it, serve the rest of the feed.
   */
  let blog: MetadataRoute.Sitemap = []
  try {
    const posts = await listPublishedPosts()
    blog = [
      {
        url: `${origin}/blog`,
        lastModified: posts[0]?.contentUpdatedAt ?? lm ?? new Date(),
        changeFrequency: 'weekly',
        priority: 0.8,
      },
      ...posts.map(post => ({
        url: `${origin}/blog/${post.slug}`,
        lastModified: post.contentUpdatedAt,
        changeFrequency: 'monthly' as const,
        priority: 0.7,
        ...(post.coverImage ? { images: [post.coverImage] } : {}),
      })),
    ]
  } catch (error) {
    console.error('[sitemap] blog posts unavailable - serving the rest of the feed', error)
  }

  /**
   * MBTI landing + the 16 type pages, per locale. Every entry here is statically
   * generated and safe to index.
   *
   * Deliberately absent: `/[lang]/mbti/test` and `/[lang]/mbti/result/[id]`. The test
   * page competes with the type pages for the same queries and gives a searcher a worse
   * landing experience; result URLs are capability tokens, so an indexed one is a leaked
   * one. Both also carry `robots: noindex` in their own metadata - this is the second
   * lock on the same door.
   */
  const mbti: MetadataRoute.Sitemap = LOCALES.flatMap(lang => [
    {
      url: `${origin}/${lang}/mbti`,
      lastModified: MBTI_CONTENT_UPDATED_AT,
      changeFrequency: 'monthly' as const,
      priority: 0.9,
    },
    ...MBTI_TYPES.map(type => ({
      url: `${origin}/${lang}/mbti/${slugFromType(type)}`,
      lastModified: MBTI_CONTENT_UPDATED_AT,
      changeFrequency: 'monthly' as const,
      priority: 0.7,
    })),
    {
      url: `${origin}/${lang}/mbti/privacy`,
      lastModified: MBTI_CONTENT_UPDATED_AT,
      changeFrequency: 'yearly' as const,
      priority: 0.2,
    },
  ])

  /**
   * IQ. Only the three pages that are genuinely public and static.
   *
   * Deliberately absent, and each for its own reason:
   *   /iq/test              a shell with no content, and a crawl would start a real attempt
   *   /iq/result/[id]       the URL IS the credential; an indexed one is a leaked one
   *   /iq/certificate/[id]  public, but unbounded and per-buyer - it belongs in an unfurl,
   *                         not a sitemap, and nobody searches for a stranger's certificate
   *   /iq/verify/[id]       same, and it only means anything to someone holding the id
   *
   * `/iq/method` gets a real priority rather than a token one: "how is this scored" is a
   * genuine search, and it is the page carrying the honesty commitment, so it is worth
   * being findable independently of the landing page.
   */
  const iq: MetadataRoute.Sitemap = LOCALES.flatMap(lang => [
    {
      url: `${origin}/${lang}/iq`,
      lastModified: MBTI_CONTENT_UPDATED_AT,
      changeFrequency: 'monthly' as const,
      priority: 0.9,
    },
    {
      url: `${origin}/${lang}/iq/method`,
      lastModified: MBTI_CONTENT_UPDATED_AT,
      changeFrequency: 'monthly' as const,
      priority: 0.6,
    },
    {
      url: `${origin}/${lang}/iq/privacy`,
      lastModified: MBTI_CONTENT_UPDATED_AT,
      changeFrequency: 'yearly' as const,
      priority: 0.2,
    },
  ])

  return [
    {
      // No trailing slash, matching the canonical tag the homepage renders. The two forms
      // are equivalent for the root, so this is consistency rather than a fix - but two
      // signals about the same page disagreeing is a question nobody should have to ask.
      url: origin,
      lastModified: lm ?? new Date(),
      changeFrequency: 'weekly',
      priority: 1,
      // Points crawlers at the share card, which is what Google Images and Discover pick
      // up. The portfolio home is the only page whose OG image is generated from live
      // profile data, so it is the one worth listing.
      images: [`${origin}/opengraph-image`],
    },
    {
      // Was missing entirely: `/cv` is a real indexable page linked from the hero, so
      // leaving it out of the sitemap meant relying on crawlers finding it by link alone.
      url: `${origin}/cv`,
      lastModified: lm ?? new Date(),
      changeFrequency: 'monthly',
      priority: 0.7,
    },
    // Deliberately absent, in the style of the MBTI and IQ notes below: `/admin/ccaf` and
    // `/admin/ccaf/en`. They were listed here while the study plan was a public page. It is an
    // owner-only surface now, and since D6 every owner surface lives under `/admin` - none
    // of which has ever been listed here.
    ...mbti,
    ...iq,
    ...blog,
  ]
}
