import { ImageResponse } from 'next/og'

import { EMAIL_COLOR } from '@/components/email/theme'
import { isLocale, LOCALES } from '@/lib/i18n'
import { getTypeContent } from '@/lib/mbti/content'
import { SEO } from '@/lib/mbti/seo'
import { groupOfType, MBTI_TYPES, slugFromType, typeFromSlug } from '@/lib/mbti/types'

/**
 * Share card for one type page.
 *
 * Generated per type rather than reusing the site-wide card, because these are the pages
 * people actually send each other ("I'm an INFJ") and a generic portfolio image in the
 * preview loses the entire reason someone clicked.
 *
 * Colours come from `components/email/theme.ts` for the same reason the email does: Satori
 * resolves neither CSS custom properties nor Tailwind classes, so it needs literal hex.
 * Reusing the email palette keeps one resolved copy rather than a third.
 */

export const runtime = 'nodejs'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
/** See the landing card: a text-bearing share image gets a real alt. */
export const alt = 'MBTI personality type'

/** Prerender all 32 cards at build time; these routes are already `dynamicParams: false`. */
export function generateStaticParams() {
  return LOCALES.flatMap(lang => MBTI_TYPES.map(type => ({ lang, type: slugFromType(type) })))
}

const GROUP_COLOR = {
  NT: EMAIL_COLOR.violet,
  NF: '#f38fd1',
  SJ: EMAIL_COLOR.blue,
  SP: EMAIL_COLOR.green,
} as const

export default async function TypeOpenGraphImage({
  params,
}: {
  params: Promise<{ lang: string; type: string }>
}) {
  const { lang, type: slug } = await params
  const mbtiType = typeFromSlug(slug)

  // Satori cannot throw a useful error into an image, so an unexpected param renders a
  // plain card rather than failing the build.
  if (!isLocale(lang) || !mbtiType) {
    return new ImageResponse(<div style={{ width: '100%', height: '100%' }} />, size)
  }

  const content = getTypeContent(lang, mbtiType)
  const accent = GROUP_COLOR[groupOfType(mbtiType)]

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '80px',
          background: EMAIL_COLOR.page,
          color: EMAIL_COLOR.text,
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div
            style={{
              width: '20px',
              height: '20px',
              borderRadius: '999px',
              background: accent,
              display: 'flex',
            }}
          />
          <div
            style={{
              fontSize: '26px',
              fontWeight: 600,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: EMAIL_COLOR.muted,
              display: 'flex',
            }}
          >
            {SEO[lang].siteName}
          </div>
        </div>

        <div
          style={{
            fontSize: '180px',
            fontWeight: 700,
            lineHeight: 1,
            letterSpacing: '-0.03em',
            marginTop: '36px',
            display: 'flex',
          }}
        >
          {mbtiType}
        </div>

        <div
          style={{ fontSize: '58px', fontWeight: 600, color: accent, marginTop: '12px', display: 'flex' }}
        >
          {content.nickname}
        </div>

        <div
          style={{
            fontSize: '30px',
            lineHeight: 1.45,
            color: EMAIL_COLOR.muted,
            marginTop: '28px',
            display: 'flex',
            maxWidth: '900px',
          }}
        >
          {content.tagline}
        </div>
      </div>
    ),
    size
  )
}
