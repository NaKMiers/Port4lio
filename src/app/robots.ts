import type { MetadataRoute } from 'next'

import { resolveSiteOrigin } from '@/lib/seo'

/**
 * Disallows the admin surfaces; canonical public slice is `/` with section anchors.
 *
 * The result and test paths are listed here as well as carrying `robots: noindex` in their
 * own metadata. The two do different jobs and both are wanted: `noindex` keeps a page out of
 * the index but only after it has been fetched, while a `Disallow` stops the fetch. For
 * result URLs that distinction is the point - the token IS the credential, so a crawler that
 * never requests one cannot leak it through a referrer log or a cache.
 *
 * ## The IQ rules were missing
 *
 * This file was written when MBTI was the only test and was never revisited when IQ
 * shipped, so it protected `/*&#47;mbti/result/` while leaving the four IQ paths that carry
 * the exact same tokens wide open to crawling. The reasoning above is not MBTI-specific:
 * an IQ result, certificate or verification URL IS its credential in precisely the same
 * way, and `sitemap.ts` already says so in its own exclusion notes.
 *
 * `/metrics` joins `/settings` and `/publish` for the same reason - it is an admin surface,
 * and it was the only one of the three without a rule.
 *
 * Kept as explicit per-product entries rather than collapsing to `/*&#47;iq/`: the IQ
 * landing, `/iq/method` and `/iq/privacy` are all in the sitemap and MUST stay crawlable,
 * so a prefix that broad would deindex the three pages this product needs found.
 */
export default function robots(): MetadataRoute.Robots {
  const origin = resolveSiteOrigin().replace(/\/$/, '')

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/settings',
        '/settings/',
        '/publish',
        '/publish/',
        '/metrics',
        '/metrics/',
        '/api/',
        // Every locale, without enumerating them: `/vi/mbti/result/...`, `/en/...`.
        '/*/mbti/result/',
        '/*/mbti/test',
        // The IQ counterparts. `certificate` and `verify` are included because both embed a
        // certificate id in the path, and a crawled URL is a published URL.
        '/*/iq/result/',
        '/*/iq/certificate/',
        '/*/iq/verify/',
        '/*/iq/test',
      ],
    },
    sitemap: `${origin}/sitemap.xml`,
  }
}
