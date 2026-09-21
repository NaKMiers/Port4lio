import { ImageResponse } from 'next/og'

import { EMAIL_COLOR } from '@/components/email/theme'
import { isLocale, LOCALES } from '@/lib/i18n'
import { iqUi } from '@/lib/iq/content'
import { IQ_SEO } from '@/lib/iq/seo'

/**
 * Share card for the IQ landing page.
 *
 * Same reasoning as the MBTI landing card, and the same measured problem: `/vi/iq` and
 * `/en/iq` were serving no `og:image` at all, so every pasted link rendered as a bare grey
 * row. A test people send each other is a test whose preview has to carry itself.
 *
 * Deliberately NOT extended to the rest of `/[lang]/iq/*`. A colocated file applies to its
 * whole subtree, but `/iq/test`, `/iq/result/[id]`, `/iq/certificate/[id]` and
 * `/iq/verify/[id]` are all `noindex` and token-scoped - and `certificate` already owns a
 * purpose-built card carrying the score. This file sits at the `iq` segment, so those
 * deeper routes keep whatever their own segment defines.
 *
 * `landingLead` is the card's body rather than the SEO description, on purpose: the
 * description interpolates `{price}`, and the price is deliberately not disclosed before
 * someone finishes the test. `landingLead` states the shape of the test - question count,
 * time limit, no signup - which is what a recipient needs to decide whether to tap, and it
 * cannot go stale against a price change.
 *
 * Literal hex from the email palette: Satori resolves neither CSS custom properties nor
 * Tailwind classes.
 */

export const runtime = 'nodejs'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const alt = ''

/** Prerender both locales at build time; the landing route is already static. */
export function generateStaticParams() {
  return LOCALES.map(lang => ({ lang }))
}

export default async function IqLandingOpenGraphImage({
  params,
}: {
  params: Promise<{ lang: string }>
}) {
  const { lang } = await params

  // Satori cannot render a useful error, so an unexpected param produces a blank card
  // rather than failing the build.
  if (!isLocale(lang))
    return new ImageResponse(
      <div style={{ width: '100%', height: '100%' }} />,
      size
    )

  const copy = iqUi(lang)

  return new ImageResponse(
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
            background: EMAIL_COLOR.blue,
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
          {IQ_SEO[lang].name}
        </div>
      </div>

      <div
        style={{
          fontSize: '68px',
          fontWeight: 700,
          lineHeight: 1.12,
          letterSpacing: '-0.02em',
          marginTop: '38px',
          maxWidth: '1010px',
          display: 'flex',
        }}
      >
        {copy.landingTitle}
      </div>

      <div
        style={{
          fontSize: '30px',
          lineHeight: 1.45,
          color: EMAIL_COLOR.muted,
          marginTop: '30px',
          maxWidth: '950px',
          display: 'flex',
        }}
      >
        {copy.landingLead}
      </div>
    </div>,
    size
  )
}
