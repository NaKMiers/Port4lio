import { ImageResponse } from 'next/og'

import { EMAIL_COLOR } from '@/components/email/theme'
import { isLocale, LOCALES } from '@/lib/i18n'
import { SEO, landingTitle, priceForSeo } from '@/lib/mbti/seo'

/**
 * Share card for the MBTI landing page.
 *
 * ## Why this file has to exist
 *
 * The landing page declares `openGraph` in its metadata but never set `images`. In Next
 * that combination does not fall back to the site-wide card at `app/opengraph-image.tsx`
 * - it suppresses it. The measurable result was `og:image` missing entirely from
 * `/vi/mbti` and `/en/mbti`, while `/vi/mbti/privacy`, which declares no `openGraph` at
 * all, correctly inherited the portfolio card.
 *
 * That is the worst possible page to lose a preview on. `proxy.ts` states the premise
 * plainly: "this product's entire growth mechanic is one person sending another a link."
 * A pasted link with no image renders as a bare grey row in Messenger, Zalo, iMessage and
 * Slack, and it is competing in the feed against posts that all have one.
 *
 * A per-product card rather than reusing the portfolio's: someone sharing the MBTI test is
 * not sharing a developer portfolio, and a preview showing the wrong subject loses the
 * reason the recipient would have tapped.
 *
 * `[type]/opengraph-image.tsx` still wins for the 32 type pages - a colocated file in a
 * deeper segment overrides this one - so "I'm an INFJ" keeps its own card.
 *
 * Literal hex from the email palette, not tokens: Satori resolves neither CSS custom
 * properties nor Tailwind classes. Same constraint, and the same single resolved copy, as
 * the type card and the result email.
 */

export const runtime = 'nodejs'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
/**
 * Read out by screen readers on platforms that surface `og:image:alt`, and used as the
 * fallback when an image fails to load. Empty is right for a decorative card; this one
 * carries the product name, so it says so.
 */
export const alt = 'MBTI personality test'

/** Prerender both locales at build time; the landing route is already static. */
export function generateStaticParams() {
  return LOCALES.map(lang => ({ lang }))
}

/** The four axes, in the order they are scored - same order as the landing page chips. */
const AXES = [
  { pair: 'E / I', color: EMAIL_COLOR.orange },
  { pair: 'S / N', color: EMAIL_COLOR.blue },
  { pair: 'T / F', color: EMAIL_COLOR.green },
  { pair: 'J / P', color: EMAIL_COLOR.violet },
] as const

export default async function MbtiLandingOpenGraphImage({
  params,
}: {
  params: Promise<{ lang: string }>
}) {
  const { lang } = await params

  // Satori cannot render a useful error, so an unexpected param produces a blank card
  // rather than failing the build.
  if (!isLocale(lang)) {
    return new ImageResponse(<div style={{ width: '100%', height: '100%' }} />, size)
  }

  // Title from the same builder the `<title>` uses, so the card and the tab never disagree
  // about the question count.
  const title = landingTitle(lang, priceForSeo())

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
              background: EMAIL_COLOR.violet,
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
            fontSize: '76px',
            fontWeight: 700,
            lineHeight: 1.1,
            letterSpacing: '-0.02em',
            marginTop: '40px',
            maxWidth: '1000px',
            display: 'flex',
          }}
        >
          {title}
        </div>

        <div style={{ display: 'flex', gap: '20px', marginTop: '52px' }}>
          {AXES.map(axis => (
            <div
              key={axis.pair}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '14px 26px',
                borderRadius: '999px',
                background: '#ffffff',
                border: `1px solid ${EMAIL_COLOR.line}`,
              }}
            >
              <div
                style={{
                  width: '14px',
                  height: '14px',
                  borderRadius: '999px',
                  background: axis.color,
                  display: 'flex',
                }}
              />
              <div style={{ fontSize: '30px', fontWeight: 600, display: 'flex' }}>{axis.pair}</div>
            </div>
          ))}
        </div>
      </div>
    ),
    size
  )
}
