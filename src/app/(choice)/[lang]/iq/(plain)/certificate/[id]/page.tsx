import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { EditorialPanel } from '@/components/portfolio/primitives/EditorialPanel'
import { SectionFrame } from '@/components/portfolio/primitives/SectionFrame'
import { isLocale } from '@/lib/i18n'
import { BAND_LABELS, fill, iqUi } from '@/lib/iq/content'
import { connectDatabase } from '@/lib/mongodb'
import { isTokenShaped } from '@/lib/tokens'
import { IqAttemptModel } from '@/models/IqAttempt'

/**
 * A public IQ certificate.
 *
 * ```
 *   attempt token  ──▶ /iq/result/<token>          PRIVATE   noindex   credential
 *   certificate id ──▶ /iq/certificate/<pubId>     PUBLIC    indexed   no credential
 *                  └─▶ /iq/verify/<pubId>          PUBLIC    indexed   no credential
 * ```
 *
 * ## The id in this URL is deliberately not the attempt token
 *
 * This page exists to be posted into a group chat, unfurled by Zalo and Facebook, and
 * opened by strangers who want to check it. The attempt token is the opposite: `lib/tokens.ts`
 * states that holding a result URL *is* the claim to that result.
 *
 * Reusing one as the other would mean every buyer broadcasts access to their own private
 * result the moment they share their certificate - and unlike an accidental leak it could
 * not be walked back with a `noindex`, because a certificate nobody can fetch is a
 * certificate nobody can verify. So a separate public id is minted at purchase and this
 * page only ever resolves that.
 *
 * Indexable on purpose, which is the inverse of every other token-scoped page here. There
 * is nothing secret on it: a name the buyer chose to publish, a score, a percentile, a date.
 */
export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string; id: string }>
}): Promise<Metadata> {
  const { lang, id } = await params
  if (!isLocale(lang) || !isTokenShaped(id)) return {}

  await connectDatabase()
  const attempt = await IqAttemptModel.findOne({ certificateId: id }).lean()
  if (!attempt?.certificateName)
    return { title: iqUi(lang).certificateNotFound }

  const copy = iqUi(lang)
  const title = `${attempt.certificateName} - ${copy.scoreLabel} ${attempt.score}`
  const description = fill(copy.percentileLabel, {
    percentile: attempt.percentile ?? 0,
  })

  return {
    title,
    description,
    // Indexed, unlike the result page. The whole point is that a stranger can find and
    // check this.
    alternates: { canonical: `/${lang}/iq/certificate/${id}` },
    openGraph: {
      title,
      description,
      url: `/${lang}/iq/certificate/${id}`,
      type: 'profile',
    },
  }
}

export default async function CertificatePage({
  params,
}: {
  params: Promise<{ lang: string; id: string }>
}) {
  const { lang, id } = await params
  if (!isLocale(lang)) notFound()
  if (!isTokenShaped(id)) notFound()

  await connectDatabase()
  const attempt = await IqAttemptModel.findOne({ certificateId: id }).lean()
  if (!attempt?.certificateName || attempt.score === null) notFound()

  const copy = iqUi(lang)
  const bandLabel = BAND_LABELS[lang][attempt.band ?? ''] ?? attempt.band ?? ''
  const issued = attempt.certificateIssuedAt ?? attempt.createdAt

  return (
    <main>
      <SectionFrame
        className="py-section-sm"
        innerClassName="max-w-2xl"
      >
        <EditorialPanel
          variant="strong"
          className="p-8 text-center md:p-12"
        >
          <p className="font-display text-xs font-semibold uppercase tracking-[0.22em] text-pp-muted">
            {copy.certificateTitle}
          </p>

          <p className="mt-7 font-display text-2xl font-semibold text-pp-text md:text-3xl">
            {attempt.certificateName}
          </p>

          <p className="mt-8 font-display text-[clamp(4rem,14vw,7rem)] font-semibold tabular-nums leading-none tracking-tight text-pp-text">
            {attempt.score}
          </p>
          <p className="mt-3 font-display text-lg font-semibold text-pp-text">
            {bandLabel}
          </p>
          <p className="mt-2 text-pp-muted">
            {fill(copy.percentileLabel, {
              percentile: attempt.percentile ?? 0,
            })}
          </p>

          <div className="mt-9 border-t border-pp-line pt-6 text-sm text-pp-muted">
            <p>
              {copy.certificateIssued}{' '}
              <time dateTime={new Date(issued).toISOString()}>
                {new Date(issued).toLocaleDateString(
                  lang === 'vi' ? 'vi-VN' : 'en-GB'
                )}
              </time>
            </p>
            <p className="mt-1 font-mono text-xs">{id}</p>
          </div>
        </EditorialPanel>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-5 text-sm">
          <Link
            href={`/${lang}/iq/verify/${id}`}
            className="font-semibold text-pp-text underline decoration-pp-blue/50 underline-offset-[0.2em] hover:decoration-pp-blue"
          >
            {copy.verifyThis}
          </Link>
          {/*
            Links to the test, never back to the buyer's result. The result URL is their
            credential; a certificate is a public document and must not carry a route into
            a private one. It also makes every shared certificate a way in for the next
            person, which is the loop this product runs on.
          */}
          <Link
            href={`/${lang}/iq/test`}
            className="font-semibold text-pp-text underline decoration-pp-blue/50 underline-offset-[0.2em] hover:decoration-pp-blue"
          >
            {copy.startTest}
          </Link>
        </div>
      </SectionFrame>
    </main>
  )
}
