import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import Chevron from '@/components/mbti/Chevron'
import ResultPaywall from '@/components/mbti/ResultPaywall'
import { GROUP_ACCENT } from '@/components/mbti/type-accent'
import { EditorialPanel } from '@/components/portfolio/primitives/EditorialPanel'
import { SectionFrame } from '@/components/portfolio/primitives/SectionFrame'
import { isLocale } from '@/lib/i18n'
import { getTypeContent, UI } from '@/lib/mbti/content'
import { formatPrice, getResultPrice, isPaidMode } from '@/lib/mbti/pricing'
import { connectDatabase } from '@/lib/mongodb'
import { AXES, groupOfType, isMbtiType, slugFromType, type MbtiType } from '@/lib/mbti/types'
import { isTokenShaped } from '@/lib/tokens'
import { AttemptModel, ATTEMPT_TTL_DAYS } from '@/models/Attempt'

/**
 * A free solo result, addressed by capability token.
 *
 * `force-dynamic` + `no-store` is a correctness requirement, not a performance choice.
 * This page is token-scoped: caching it risks serving one person's result under another
 * person's URL, and once the paid pair report lands in Phase 3, a cached page would also
 * keep showing the paywall to someone who has already paid. The portfolio in `(me)` sets
 * `revalidate = 60`, which is right there and wrong here.
 */
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>
}): Promise<Metadata> {
  const { lang } = await params
  if (!isLocale(lang)) return {}

  // Never indexed: these URLs are credentials. A crawled result page is a leaked one.
  return {
    title: UI[lang].resultTitle,
    robots: { index: false, follow: false },
  }
}

export default async function MbtiResultPage({
  params,
}: {
  params: Promise<{ lang: string; id: string }>
}) {
  const { lang, id } = await params
  if (!isLocale(lang)) notFound()

  const copy = UI[lang]

  // Shape check before the query: a malformed or oversized segment never becomes a
  // database round trip.
  if (!isTokenShaped(id)) notFound()

  await connectDatabase()
  const attempt = await AttemptModel.findById(id).lean()

  // A missing document is indistinguishable from an expired one, and both are a 404. The
  // TTL means "not found" is a normal outcome here, not an error.
  if (!attempt || !isMbtiType(attempt.type)) notFound()

  const type = attempt.type as MbtiType
  const content = getTypeContent(lang, type)
  const group = groupOfType(type)
  const accent = GROUP_ACCENT[group]

  /**
   * The gate.
   *
   * `isPaidMode()` is re-read on every request rather than captured at build time, which is
   * what makes `MBTI_RESULT_PRICE=0` release every existing attempt immediately instead of
   * leaving old ones stuck behind a paywall that no longer exists. This page is already
   * `force-dynamic` + `fetchCache: 'force-no-store'`, so there is no cached copy of the
   * locked version to serve to someone who has since paid.
   */
  const locked = isPaidMode() && !attempt.paid

  return (
    <main>
      <SectionFrame
        aria-labelledby='result-heading'
        disableReveal
        className='border-b border-pp-line pb-section-sm pt-10 md:pt-14'
        innerClassName='max-w-3xl'
      >
        <p className='font-display text-xs font-semibold uppercase tracking-[0.18em] text-pp-muted'>
          {copy.yourType}
        </p>
        <h1
          id='result-heading'
          className='mt-3 font-display text-[clamp(3rem,9vw,5.5rem)] font-semibold leading-[0.95] tracking-tight text-pp-text'
        >
          {type}
        </h1>
        <p className={`mt-3 font-display text-xl font-semibold ${accent.text}`}>
          {content.nickname}
        </p>
        <p className='mt-4 max-w-2xl text-base leading-relaxed text-pp-muted md:text-lg'>
          {content.tagline}
        </p>
      </SectionFrame>

      <SectionFrame className='py-section-sm' innerClassName='max-w-3xl'>
        {locked ? (
          <ResultPaywall
            token={id}
            locale={lang}
            // Formatted here rather than in the client so đồng formatting lives in one
            // place and the client never has to know the raw amount.
            price={formatPrice(getResultPrice())}
            copy={{
              title: copy.paywallTitle,
              lead: copy.paywallLead,
              emailLabel: copy.emailLabel,
              emailPlaceholder: copy.emailPlaceholder,
              emailHint: copy.emailHint,
              payButton: copy.payButton,
              preparing: copy.payPreparing,
              scanTitle: copy.payScanTitle,
              scanLead: copy.payScanLead,
              waiting: copy.payWaiting,
              done: copy.payDone,
              cancelled: copy.payCancelled,
              expiresIn: copy.payExpiresIn,
              expired: copy.payExpired,
              retry: copy.payRetry,
              deliveryNote: copy.payDeliveryNote,
              invalidEmail: copy.invalidEmail,
              rateLimited: copy.rateLimited,
              genericError: copy.genericError,
              transfer: {
                title: copy.payManualTitle,
                bank: copy.payBank,
                accountNumber: copy.payAccountNumber,
                accountName: copy.payAccountName,
                amount: copy.payAmount,
                transferNote: copy.payTransferNote,
                transferWarning: copy.payTransferWarning,
                copy: copy.copy,
                copied: copy.copied,
              },
            }}
          />
        ) : (
          <>
        <EditorialPanel variant='strong' className='p-6 md:p-7'>
          <h2 className='font-display text-sm font-semibold uppercase tracking-[0.18em] text-pp-text'>
            {copy.axisBreakdown}
          </h2>
          <dl className='mt-5 space-y-4'>
            {AXES.map(axis => {
              const score = attempt.scores[axis]
              const total = score.a + score.b
              const aPercent = Math.round((score.a / total) * 100)
              // The dominant side is the one worth colouring in; a bar that always fills
              // from the left reads as "more is better" on an axis that has no better side.
              const leansA = aPercent >= 50
              return (
                <div key={axis}>
                  <dt className='flex items-baseline justify-between gap-4 font-display text-sm font-semibold tabular-nums'>
                    <span className={leansA ? 'text-pp-text' : 'text-pp-muted'}>
                      {axis[0]} {aPercent}%
                    </span>
                    <span className={leansA ? 'text-pp-muted' : 'text-pp-text'}>
                      {100 - aPercent}% {axis[1]}
                    </span>
                  </dt>
                  <dd
                    className='mt-1.5 h-2 overflow-hidden rounded-full bg-[rgba(31,28,26,0.07)]'
                    aria-label={`${axis}: ${aPercent}% ${axis[0]}, ${100 - aPercent}% ${axis[1]}`}
                  >
                    <div
                      className='h-full rounded-full bg-[linear-gradient(90deg,var(--pp-violet),var(--pp-blue))]'
                      style={{ width: `${aPercent}%` }}
                    />
                  </dd>
                </div>
              )
            })}
          </dl>
        </EditorialPanel>

        <div className='mt-8 space-y-4'>
          {content.overview.map(paragraph => (
            <p key={paragraph} className='text-pp-muted'>
              {paragraph}
            </p>
          ))}
        </div>

        <div className='mt-9 flex flex-wrap items-center gap-4'>
          <Link
            href={`/${lang}/mbti/${slugFromType(type)}`}
            className='inline-flex items-center gap-2.5 rounded-full bg-pp-text px-7 py-3.5 font-display text-sm font-semibold uppercase tracking-[0.16em] text-[var(--pp-bg)] no-underline shadow-[0_16px_32px_rgba(31,28,26,0.18)] transition hover:-translate-y-0.5 hover:shadow-[0_20px_38px_rgba(31,28,26,0.22)] motion-reduce:hover:translate-y-0'
          >
            {copy.readFullType} {type}
            <Chevron direction='right' />
          </Link>
          <Link
            href={`/${lang}/mbti/test`}
            className='text-sm font-semibold text-pp-muted no-underline transition hover:text-pp-text'
          >
            {copy.retake}
          </Link>
        </div>

        <EditorialPanel
          variant='default'
          className='mt-10 flex gap-3.5 border-[rgba(255,159,64,0.3)] bg-[rgba(255,159,64,0.07)] p-5'
        >
          <span className='mt-1 h-2 w-2 shrink-0 rounded-full bg-pp-orange' aria-hidden />
          <p className='text-sm leading-relaxed text-pp-muted'>
            {copy.resultKeepLink.replace('{days}', String(ATTEMPT_TTL_DAYS))}
          </p>
        </EditorialPanel>
          </>
        )}
      </SectionFrame>
    </main>
  )
}
