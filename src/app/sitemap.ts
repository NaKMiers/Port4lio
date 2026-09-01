import type { MetadataRoute } from 'next'

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

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = resolveSiteOrigin().replace(/\/$/, '')
  const lm = await getPublicProfileUpdatedAt()

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
      // hreflang pairs in the sitemap as well as in each page's head. Google treats the
      // two as independent signals and a sitemap-level pair is the one that survives a
      // crawler that never fetches the alternate page.
      alternates: {
        languages: Object.fromEntries(LOCALES.map(l => [l, `${origin}/${l}/mbti`])),
      },
    },
    ...MBTI_TYPES.map(type => ({
      url: `${origin}/${lang}/mbti/${slugFromType(type)}`,
      lastModified: MBTI_CONTENT_UPDATED_AT,
      changeFrequency: 'monthly' as const,
      priority: 0.7,
      alternates: {
        languages: Object.fromEntries(
          LOCALES.map(l => [l, `${origin}/${l}/mbti/${slugFromType(type)}`])
        ),
      },
    })),
    {
      url: `${origin}/${lang}/mbti/privacy`,
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
    ...mbti,
  ]
}
