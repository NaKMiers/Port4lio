import type { MetadataRoute } from 'next'

import { resolveSiteOrigin } from '@/lib/seo'

/**
 * Disallows the admin surfaces; canonical public slice is `/` with section anchors.
 *
 * The MBTI result and test paths are listed here as well as carrying `robots: noindex` in
 * their own metadata. The two do different jobs and both are wanted: `noindex` keeps a page
 * out of the index but only after it has been fetched, while a `Disallow` stops the fetch.
 * For result URLs that distinction is the point - the token IS the credential, so a crawler
 * that never requests one cannot leak it through a referrer log or a cache.
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
        '/api/',
        // Every locale, without enumerating them: `/vi/mbti/result/...`, `/en/...`.
        '/*/mbti/result/',
        '/*/mbti/test',
      ],
    },
    sitemap: `${origin}/sitemap.xml`,
  }
}
