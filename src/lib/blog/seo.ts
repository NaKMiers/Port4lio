import type { Metadata } from 'next'

import type { PostListItem } from '@/lib/blog/post-data'
import { readingDuration } from '@/lib/blog/reading'
import { collapseWhitespace, excerptText } from '@/lib/profile-copy'
import type { PublicProfile } from '@/lib/profile-public'
import {
  escapeJsonForInlineScript,
  personEntityId,
  websiteEntityId,
} from '@/lib/structured-data'

/**
 * Metadata and JSON-LD for the blog.
 *
 * ## `(blog)` inherits NOTHING from `(me)`, and this file is what that costs
 *
 * Route groups do not nest metadata across siblings. `(me)`'s layout is where
 * `title.template`, `siteName` and the default OG image are declared, and a page under
 * `(blog)` sees none of it. Every field below is therefore stated explicitly, including the
 * ones that look like they must surely have a default. Omit `siteName` and the OG card says
 * nothing about whose site it is; omit `images` and a shared link renders as a grey
 * rectangle, on the five posts that are being distributed by hand and matter most.
 *
 * ## The two character budgets are not the same number
 *
 * `title` is cut at 60 and `description` at 155. Both come from this repo's own measurements
 * in `lib/mbti/seo.ts`, which records that Google truncates descriptions around 155-160
 * "so anything after that is written for nobody". The stored fields are longer - 140 and 300 -
 * because the post page renders them in full and only the meta tags are budgeted.
 *
 * ## The graph shape, and why it is bigger than it was
 *
 * The MBTI and IQ sections each declare a typed entity (`Quiz`) that points at the site's
 * shared `Person` and `WebSite` nodes by `@id`, so everything on the domain consolidates into
 * one author's work rather than three unrelated properties. The blog emitted a Person, a
 * BlogPosting and a BreadcrumbList on post pages - and **nothing at all on `/blog`**, which
 * is the hub every post links back to and the page a cluster of posts is supposed to rank.
 *
 * What ships here is the same idiom, completed:
 *
 * ```
 *   /                  Person#person ─ WebSite#website          (structured-data.ts)
 *   /[lang]/mbti       Quiz ─────────┬─ publisher → #person     (lib/mbti/seo.ts)
 *   /[lang]/iq         Quiz ─────────┤
 *   /blog              Blog#blog ────┤   isPartOf → #website
 *     └─ /blog/<slug>  WebPage ── mainEntity ──▶ BlogPosting
 *                         └─ isPartOf → Blog#blog → #website
 * ```
 *
 * Every node carries a stable `@id`, so the partial `Blog` node emitted on a post page merges
 * with the full one on `/blog` rather than declaring a second blog. That is the same mechanism
 * `personEntityId` exists for, applied one level down.
 */

const AUTHOR_FALLBACK = 'Anh Khoa Nguyen'

/** The blog's own name, used as `siteName`, as the `Blog.name`, and in the title suffix. */
const BLOG_NAME = 'Writing'

/**
 * Longest a `<title>` may get before the brand suffix is dropped.
 *
 * Google renders roughly 60 characters and rewrites titles it finds unhelpful. A suffix is
 * worth having - it is what makes a result recognisable to somebody who has seen the site
 * before - but not at the price of truncating the part that says what the post is about. So
 * the suffix is appended only when the whole thing still fits, and silently skipped when it
 * does not. 65 rather than 60 because the ellipsis falls in the suffix, where it costs
 * nothing.
 */
const TITLE_BUDGET = 65

export function blogIndexUrl(origin: string): string {
  return `${origin}/blog`
}

export function postUrl(origin: string, slug: string): string {
  return `${origin}/blog/${slug}`
}

/**
 * The stable `@id` of the Blog entity.
 *
 * Same job as `personEntityId` and `websiteEntityId` one level down: `/blog` declares the
 * node in full, and every post page emits a stub carrying this `@id` so the two merge. A
 * post's `isPartOf` then resolves to a real Blog rather than to nothing.
 */
export function blogEntityId(origin: string): string {
  return `${blogIndexUrl(origin)}#blog`
}

/** Absolute URL for a stored image path. Cloudinary URLs are already absolute; a root-relative one is not. */
function absoluteImage(origin: string, value: string | null | undefined): string | undefined {
  const raw = collapseWhitespace(value ?? '')
  if (!raw || /\s/.test(raw)) return undefined
  if (/^https:\/\//i.test(raw)) return raw
  if (raw.startsWith('//')) return `https:${raw}`
  if (raw.startsWith('/')) return `${origin}${raw}`
  return undefined
}

/**
 * The share card a page falls back to when it has no cover of its own.
 *
 * `/opengraph-image` is the portfolio home's generated card, built from live profile data. A
 * post without a cover image previously shipped `openGraph.images: undefined`, and what a
 * reader sees when such a link is pasted into Slack or LinkedIn is a grey rectangle with a
 * hostname - on the `note`-tier posts, which by design carry no cover, and which are exactly
 * the ones distributed by hand.
 */
function fallbackShareImage(origin: string): string {
  return `${origin}/opengraph-image`
}

function authorName(profile: PublicProfile): string {
  return collapseWhitespace(profile.fullName) || AUTHOR_FALLBACK
}

/** `https://` socials, for `sameAs`. `link`, not `url` - `SocialLink` is { link, icon, name }. */
function sameAsLinks(profile: PublicProfile): string[] {
  return (profile.socials ?? [])
    .map(social => (typeof social?.link === 'string' ? social.link.trim() : ''))
    .filter(candidate => /^https:\/\//i.test(candidate))
    .slice(0, 20)
}

/**
 * The `@handle` for `twitter:creator`, read off the profile's own social links.
 *
 * Not a constant, and not a config value: the handle is already stored once, and a second
 * copy is a thing that goes stale silently the day it changes. `twitter:creator` is what puts
 * "by @handle" on the card and attributes the share in X's own analytics - the difference
 * between a link that circulates anonymously and one that credits the author.
 *
 * Returns `undefined` rather than guessing when no X link is present. A wrong handle credits
 * a stranger.
 */
function twitterHandle(profile: PublicProfile): string | undefined {
  for (const link of sameAsLinks(profile)) {
    let url: URL
    try {
      url = new URL(link)
    } catch {
      continue
    }

    if (url.hostname !== 'x.com' && url.hostname !== 'twitter.com') continue

    const handle = url.pathname.split('/').filter(Boolean)[0]
    // `/i/...`, `/home`, `/intent/tweet` - paths on the same host that are not profiles.
    if (!handle || !/^[A-Za-z0-9_]{1,15}$/.test(handle) || handle === 'i' || handle === 'home') {
      continue
    }

    return `@${handle}`
  }

  return undefined
}

/** `Title | Brand`, or just `Title` when the pair would be truncated. See {@link TITLE_BUDGET}. */
function titleWithBrand(title: string, brand: string): string {
  const suffix = ` | ${brand}`
  return title.length + suffix.length <= TITLE_BUDGET ? `${title}${suffix}` : title
}

// MARK: Metadata

export function buildBlogIndexMetadata(origin: string, posts: PostListItem[] = []): Metadata {
  const url = blogIndexUrl(origin)
  const title = 'Writing - notes from shipping Next.js side projects'
  const description =
    'Notes and write-ups on things I measured while shipping side projects - mostly Next.js, mostly the parts the docs did not say.'

  return {
    title,
    description,
    /*
      Keywords from the posts themselves rather than a hand-written list. Google has ignored
      `<meta name="keywords">` since 2009 and this is not there for Google - Bing and several
      feed and aggregator crawlers still read it, and deriving it means it describes what is
      actually published rather than what somebody hoped to publish a year ago. Empty until
      there are posts, which is the honest state of a new blog.
    */
    ...(topTags(posts).length ? { keywords: topTags(posts) } : {}),
    alternates: { canonical: url },
    openGraph: {
      type: 'website',
      url,
      siteName: AUTHOR_FALLBACK,
      title,
      description,
      locale: 'en_US',
      images: [{ url: fallbackShareImage(origin) }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [fallbackShareImage(origin)],
    },
  }
}

/**
 * The tags used most across published posts, most-used first.
 *
 * Capped at 12: a keywords list long enough to include every tag on the blog is a list that
 * says nothing about any of them.
 */
function topTags(posts: PostListItem[]): string[] {
  const counts = new Map<string, number>()
  for (const post of posts) {
    for (const tag of post.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 12)
    .map(([tag]) => tag)
}

export function buildPostMetadata(
  post: PostListItem,
  origin: string,
  profile: PublicProfile
): Metadata {
  const url = postUrl(origin, post.slug)
  const name = authorName(profile)
  const headline = excerptText(post.title, 60)
  const description = excerptText(post.excerpt || post.title, 155)
  const cover = absoluteImage(origin, post.coverImage)
  const shareImage = cover ?? fallbackShareImage(origin)
  const creator = twitterHandle(profile)

  /*
    The caption describes the COVER, so it is only the right `alt` when the cover is what is
    being shown. A post with a caption and no cover image - which the editor permits, because
    the two fields are independent - would otherwise ship the site's generic share card
    labelled "The probe build output". The post title is the honest description of a card that
    is about the post rather than about a picture.
  */
  const shareImageAlt = cover && post.coverCaption ? post.coverCaption : post.title

  return {
    title: titleWithBrand(headline, name),
    description,
    // Not a substitute for the tags being visible on the page, which they now are - this is
    // the machine-readable copy of a fact a reader can also see.
    ...(post.tags.length ? { keywords: post.tags } : {}),
    alternates: { canonical: url },
    // No `alternates.languages`. Under D7 the blog is English-only and the Vietnamese
    // version of a post is a NATIVE Viblo post, not a translation of this URL - so there is
    // no pair to declare, and declaring one would point hreflang at a page we do not own.
    authors: [{ name, url: `${origin}/cv` }],
    creator: name,
    publisher: name,
    openGraph: {
      type: 'article',
      url,
      siteName: name,
      title: headline,
      description,
      locale: post.language === 'vi' ? 'vi_VN' : 'en_US',
      publishedTime: post.publishedAt?.toISOString(),
      modifiedTime: post.contentUpdatedAt?.toISOString(),
      authors: [name],
      tags: post.tags,
      ...(post.series ? { section: post.series } : {}),
      // Explicit `openGraph.images`, and deliberately NOT also an `opengraph-image.tsx` file
      // in this segment. Both mechanisms work and running both means two URLs claiming to be
      // the card, with the file convention silently winning - so the cover image an author
      // actually chose would lose to a generated one.
      //
      // `alt` matters here beyond accessibility: X and LinkedIn surface it, and a card whose
      // image has no description is one a screen reader announces as "image".
      images: [{ url: shareImage, alt: shareImageAlt }],
    },
    twitter: {
      card: 'summary_large_image',
      title: headline,
      description,
      images: [shareImage],
      ...(creator ? { creator, site: creator } : {}),
    },
  }
}

// MARK: JSON-LD

type JsonLdThing = Record<string, unknown>

/**
 * The author, in full.
 *
 * ## Why the Person node is inline and not a bare `@id` reference
 *
 * The tempting version is `author: { '@id': personEntityId(origin) }`, which is how the rest
 * of this site links to the Person and reads like the correct, DRY thing to do. It is wrong
 * here, and the reason is a fact about where the node lives rather than about JSON-LD:
 *
 * `personEntityId()` returns **a string**. The Person node carrying `name`, `sameAs` and
 * `image` is constructed in `buildPortfolioJsonLdGraph` and rendered only on pages under
 * `(me)`. A reference merges with a node in the same graph, or on a page a crawler has
 * already fetched - it does not reach across to a different URL and pull one in. So a post
 * emitting only the reference emits an `author` that resolves to nothing, with no `name`,
 * and `name` is required on `author`.
 *
 * The `@id` is still `personEntityId(origin)`, so the node MERGES with the one on `/` rather
 * than declaring a second, unrelated person. Same entity, stated in full in both places.
 */
function personNode(origin: string, profile: PublicProfile): JsonLdThing {
  const sameAs = sameAsLinks(profile)
  const avatar = absoluteImage(origin, profile.avatar)

  return {
    '@type': 'Person',
    '@id': personEntityId(origin),
    name: authorName(profile),
    url: `${origin}/`,
    ...(avatar ? { image: avatar } : {}),
    ...(sameAs.length ? { sameAs } : {}),
  }
}

/**
 * The Blog itself.
 *
 * Emitted on `/blog` with its post list, and on every post page without one. Both carry the
 * same `@id`, so a crawler that has seen either knows a post belongs to a named blog with a
 * named author that is part of a named site - which is the chain that makes a new post
 * inherit anything at all from the domain's existing authority.
 */
function blogNode(
  origin: string,
  profile: PublicProfile,
  posts?: PostListItem[]
): JsonLdThing {
  const person = { '@id': personEntityId(origin) }

  return {
    '@type': 'Blog',
    '@id': blogEntityId(origin),
    name: `${authorName(profile)} - ${BLOG_NAME}`,
    description:
      'Notes and write-ups on things I measured while shipping side projects - mostly Next.js.',
    url: blogIndexUrl(origin),
    inLanguage: 'en',
    author: person,
    publisher: person,
    isPartOf: { '@id': websiteEntityId(origin) },
    /*
      `blogPost`, and deliberately not an `ItemList` alongside it.

      `ItemList` is what `lib/mbti/seo.ts` uses for the 16 type pages, and it is the right
      choice there because those pages are a fixed enumerated set. `blogPost` is the property
      schema.org defines *on Blog* for exactly this, so a crawler reading the Blog node finds
      the posts where it looks for them. Emitting both would be two machine-readable
      representations of one list, which earns nothing and doubles the payload on the page
      whose job is to be fast for a stranger arriving from a cross-post.
    */
    ...(posts?.length
      ? {
          blogPost: posts.map(post => ({
            '@type': 'BlogPosting',
            '@id': `${postUrl(origin, post.slug)}#post`,
            headline: excerptText(post.title, 110),
            url: postUrl(origin, post.slug),
            ...(post.publishedAt ? { datePublished: post.publishedAt.toISOString() } : {}),
            author: person,
          })),
        }
      : {}),
  }
}

function breadcrumbNode(id: string, trail: { name: string; url: string }[]): JsonLdThing {
  return {
    '@type': 'BreadcrumbList',
    '@id': id,
    itemListElement: trail.map((crumb, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: crumb.name,
      item: crumb.url,
    })),
  }
}

/**
 * The `@graph` for `/blog`: Person, Blog (with its posts), BreadcrumbList.
 *
 * The index had no structured data at all, which meant the hub of a hub-and-spoke content
 * model was the one page in it a crawler could learn nothing about. Every post pointed at a
 * blog that was never described.
 */
export function buildBlogIndexJsonLd(
  origin: string,
  profile: PublicProfile,
  posts: PostListItem[]
): string {
  const graph: JsonLdThing[] = [
    personNode(origin, profile),
    blogNode(origin, profile, posts),
    breadcrumbNode(`${blogIndexUrl(origin)}#breadcrumb`, [
      { name: 'Home', url: `${origin}/` },
      { name: BLOG_NAME, url: blogIndexUrl(origin) },
    ]),
  ]

  return serializeGraph(graph)
}

export type PostJsonLdInput = {
  post: PostListItem
  origin: string
  profile: PublicProfile
  /** The series' human title, not its slug - `articleSection` is read by people. */
  seriesTitle?: string | null
  /** Posts linked from the page, as `relatedLink` on the WebPage node. */
  relatedUrls?: string[]
  /** Words of prose in the body. Omitted rather than guessed when the body is unavailable. */
  wordCount?: number
  /** Minutes, matching what the byline shows a reader. */
  readingMinutes?: number
}

/**
 * The `@graph` for one post: Person, Blog, WebPage, BlogPosting, BreadcrumbList.
 *
 * ## Why a WebPage node as well as a BlogPosting
 *
 * They are different things and the distinction is load-bearing for two properties. The
 * BlogPosting is the *article* - it has a word count, a language, an author and a reading
 * time, and it could be syndicated to Viblo without any of that changing. The WebPage is
 * *this URL* - it has a breadcrumb trail, a primary image and links to other pages, none of
 * which belong to the article.
 *
 * Collapsing them, which is what the previous version did, meant `breadcrumb` and
 * `relatedLink` had nowhere valid to live. `mainEntityOfPage` on the article and `mainEntity`
 * on the page point at each other, which is the pairing schema.org defines for exactly this.
 *
 * ## What is deliberately absent
 *
 * `speakable` - Google restricts it to news publishers and it would be decoration here.
 * `aggregateRating` and `review` - there is nothing to count, and a fabricated rating is the
 * one SEO mistake that is also a lie to every reader who sees it; `lib/mbti/seo.ts` records
 * the same decision for the same reason.
 * `articleBody` - it would duplicate the entire post into the head of the document, doubling
 * the transfer of the page for a property no search engine uses to rank anything.
 * Image `width`/`height` - we do not measure the upload, and a guessed dimension is a claim
 * that can be checked and found wrong.
 */
export function buildPostJsonLd({
  post,
  origin,
  profile,
  seriesTitle,
  relatedUrls = [],
  wordCount,
  readingMinutes,
}: PostJsonLdInput): string {
  const url = postUrl(origin, post.slug)
  const personRef = { '@id': personEntityId(origin) }
  const cover = absoluteImage(origin, post.coverImage)
  const breadcrumbId = `${url}#breadcrumb`

  const image: JsonLdThing | undefined = cover
    ? {
        '@type': 'ImageObject',
        url: cover,
        ...(post.coverCaption ? { caption: post.coverCaption } : {}),
      }
    : undefined

  const webPage: JsonLdThing = {
    '@type': 'WebPage',
    '@id': url,
    url,
    name: excerptText(post.title, 110),
    description: excerptText(post.excerpt || post.title, 155),
    inLanguage: post.language,
    isPartOf: { '@id': blogEntityId(origin) },
    breadcrumb: { '@id': breadcrumbId },
    mainEntity: { '@id': `${url}#post` },
    ...(post.publishedAt ? { datePublished: post.publishedAt.toISOString() } : {}),
    ...(post.contentUpdatedAt ? { dateModified: post.contentUpdatedAt.toISOString() } : {}),
    ...(image ? { primaryImageOfPage: image } : {}),
    // The related posts an author chose, which are real links rendered on the page. This is
    // the internal-linking signal made explicit rather than left for a crawler to infer from
    // anchor placement.
    ...(relatedUrls.length ? { relatedLink: relatedUrls } : {}),
  }

  const blogPosting: JsonLdThing = {
    '@type': 'BlogPosting',
    '@id': `${url}#post`,
    headline: excerptText(post.title, 110),
    description: excerptText(post.excerpt || post.title, 155),
    url,
    mainEntityOfPage: { '@id': url },
    ...(post.publishedAt ? { datePublished: post.publishedAt.toISOString() } : {}),
    ...(post.contentUpdatedAt ? { dateModified: post.contentUpdatedAt.toISOString() } : {}),
    inLanguage: post.language,
    ...(image ? { image } : {}),
    ...(seriesTitle || post.series ? { articleSection: seriesTitle || post.series } : {}),
    ...(post.tags.length ? { keywords: post.tags.join(', ') } : {}),
    /*
      `about` as well as `keywords`, from the same tags. They are not redundant: `keywords` is
      a string of labels, while `about` claims the post is *concerned with* named things, which
      is the property an entity-based index reads. Both are true of a tag, and stating only the
      weaker one is leaving the signal on the floor.
    */
    ...(post.tags.length
      ? { about: post.tags.slice(0, 8).map(tag => ({ '@type': 'Thing', name: tag })) }
      : {}),
    ...(typeof wordCount === 'number' && wordCount > 0 ? { wordCount } : {}),
    ...(typeof readingMinutes === 'number' && readingMinutes > 0
      ? { timeRequired: readingDuration(readingMinutes) }
      : {}),
    // Stated rather than assumed. Every post here is free to read with no wall of any kind,
    // and `isAccessibleForFree` is the property Google reads to decide whether a page needs
    // paywall markup - its absence is not the same as a `true`.
    isAccessibleForFree: true,
    author: personRef,
    publisher: personRef,
    isPartOf: { '@id': blogEntityId(origin) },
  }

  const graph: JsonLdThing[] = [
    personNode(origin, profile),
    blogNode(origin, profile),
    webPage,
    blogPosting,
    breadcrumbNode(breadcrumbId, [
      { name: 'Home', url: `${origin}/` },
      { name: BLOG_NAME, url: blogIndexUrl(origin) },
      { name: post.title, url },
    ]),
  ]

  return serializeGraph(graph)
}

/**
 * `@graph` to a string safe to drop into a `<script>` element.
 *
 * `escapeJsonForInlineScript` is shared with `structured-data.ts`, and using it is not
 * cosmetic here. Everything that module serialises is compiled-in content or server config;
 * this one serialises `post.title`, `post.excerpt` and `post.coverCaption`, which are stored
 * fields somebody types into an editor. A title containing `</script>` would otherwise close
 * the tag early and turn the remainder of the payload into live markup on a public page.
 */
function serializeGraph(graph: JsonLdThing[]): string {
  return escapeJsonForInlineScript(
    JSON.stringify({ '@context': 'https://schema.org', '@graph': graph })
  )
}
