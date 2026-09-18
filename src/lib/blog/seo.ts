import type { Metadata } from 'next'

import type { PostListItem } from '@/lib/blog/post-data'
import { collapseWhitespace, excerptText } from '@/lib/profile-copy'
import type { PublicProfile } from '@/lib/profile-public'
import { personEntityId, websiteEntityId } from '@/lib/structured-data'

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
 */

const AUTHOR_FALLBACK = 'Anh Khoa Nguyen'

export function blogIndexUrl(origin: string): string {
  return `${origin}/blog`
}

export function postUrl(origin: string, slug: string): string {
  return `${origin}/blog/${slug}`
}

export function buildBlogIndexMetadata(origin: string): Metadata {
  const title = 'Writing'
  const description =
    'Notes and write-ups on things I measured while shipping side projects - mostly Next.js, mostly the parts the docs did not say.'

  return {
    title,
    description,
    alternates: { canonical: blogIndexUrl(origin) },
    openGraph: {
      type: 'website',
      url: blogIndexUrl(origin),
      siteName: AUTHOR_FALLBACK,
      title,
      description,
      locale: 'en_US',
    },
    twitter: { card: 'summary_large_image', title, description },
  }
}

export function buildPostMetadata(
  post: PostListItem,
  origin: string,
  authorName: string
): Metadata {
  const url = postUrl(origin, post.slug)
  const title = excerptText(post.title, 60)
  const description = excerptText(post.excerpt || post.title, 155)

  return {
    title,
    description,
    alternates: { canonical: url },
    // No `alternates.languages`. Under D7 the blog is English-only and the Vietnamese
    // version of a post is a NATIVE Viblo post, not a translation of this URL - so there is
    // no pair to declare, and declaring one would point hreflang at a page we do not own.
    authors: [{ name: authorName, url: `${origin}/cv` }],
    openGraph: {
      type: 'article',
      url,
      siteName: authorName,
      title,
      description,
      locale: post.language === 'vi' ? 'vi_VN' : 'en_US',
      publishedTime: post.publishedAt?.toISOString(),
      modifiedTime: post.contentUpdatedAt?.toISOString(),
      authors: [authorName],
      tags: post.tags,
      ...(post.series ? { section: post.series } : {}),
      // Explicit `openGraph.images`, and deliberately NOT also an `opengraph-image.tsx` file
      // in this segment. Both mechanisms work and running both means two URLs claiming to be
      // the card, with the file convention silently winning - so the cover image an author
      // actually chose would lose to a generated one.
      ...(post.coverImage ? { images: [{ url: post.coverImage }] } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      ...(post.coverImage ? { images: [post.coverImage] } : {}),
    },
  }
}

type JsonLdThing = Record<string, unknown>

/**
 * The `@graph` for one post: Person, BlogPosting, BreadcrumbList.
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
export function buildPostJsonLd(
  post: PostListItem & { bodyHtml?: string },
  origin: string,
  profile: PublicProfile
): string {
  const url = postUrl(origin, post.slug)
  const personUri = personEntityId(origin)
  const authorName = collapseWhitespace(profile.fullName) || AUTHOR_FALLBACK

  const sameAs = (profile.socials ?? [])
    // `link`, not `url` - `SocialLink` is { link, icon, name }. `structured-data.ts`
    // reads the same field for the Person node on `/`, which is the node this merges with.
    .map(social => (typeof social?.link === 'string' ? social.link.trim() : ''))
    .filter(candidate => /^https:\/\//i.test(candidate))
    .slice(0, 20)

  const avatar =
    typeof profile.avatar === 'string' && /^https:\/\//i.test(profile.avatar)
      ? profile.avatar
      : undefined

  const person: JsonLdThing = {
    '@type': 'Person',
    '@id': personUri,
    name: authorName,
    url: `${origin}/`,
    ...(avatar ? { image: avatar } : {}),
    ...(sameAs.length ? { sameAs } : {}),
  }

  const blogPosting: JsonLdThing = {
    '@type': 'BlogPosting',
    '@id': `${url}#post`,
    headline: excerptText(post.title, 110),
    description: excerptText(post.excerpt || post.title, 155),
    url,
    mainEntityOfPage: url,
    datePublished: post.publishedAt?.toISOString(),
    dateModified: post.contentUpdatedAt?.toISOString(),
    inLanguage: post.language,
    ...(post.coverImage ? { image: post.coverImage } : {}),
    ...(post.series ? { articleSection: post.series } : {}),
    ...(post.tags.length ? { keywords: post.tags.join(', ') } : {}),
    author: { '@id': personUri },
    publisher: { '@id': personUri },
    // Matches how `lib/iq/seo.ts` ties its pages to the site entity, so the blog reads as
    // part of one site rather than a fourth unrelated property on the same domain.
    isPartOf: { '@id': websiteEntityId(origin) },
  }

  const breadcrumbs: JsonLdThing = {
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${origin}/` },
      { '@type': 'ListItem', position: 2, name: 'Writing', item: blogIndexUrl(origin) },
      { '@type': 'ListItem', position: 3, name: post.title, item: url },
    ],
  }

  return JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [person, blogPosting, breadcrumbs],
  })
}
