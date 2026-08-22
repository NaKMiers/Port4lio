import type { MetadataRoute } from 'next'

import { resolveSiteOrigin } from '@/lib/seo'

/** Disallows admin settings; canonical public slice is `/` with section anchors. */
export default function robots(): MetadataRoute.Robots {
  const origin = resolveSiteOrigin().replace(/\/$/, '')

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/settings', '/settings/'],
    },
    sitemap: `${origin}/sitemap.xml`,
  }
}
