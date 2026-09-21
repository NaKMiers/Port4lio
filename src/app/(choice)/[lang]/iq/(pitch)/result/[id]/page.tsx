import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import Chevron from '@/components/mbti/Chevron'
import { EditorialPanel } from '@/components/portfolio/primitives/EditorialPanel'
import { SectionFrame } from '@/components/portfolio/primitives/SectionFrame'
import MethodTease from '@/components/test-kit/MethodTease'
import ShareControl from '@/components/test-kit/ShareControl'
import TestPaywall from '@/components/test-kit/TestPaywall'
import { isLocale } from '@/lib/i18n'
import { BAND_LABELS, fill, iqUi } from '@/lib/iq/content'
import { formatPrice, getIqResultPrice, isIqPaidMode } from '@/lib/iq/pricing'
import { connectDatabase } from '@/lib/mongodb'
import { mintShareToken } from '@/lib/share'
import { paymentCopy } from '@/lib/test-kit/payment-copy'
import { FUNNEL_EVENTS, recordFunnelDetached } from '@/lib/test-events'
import { isTokenShaped } from '@/lib/tokens'
import { ATTEMPT_TTL_DAYS } from '@/models/Attempt'
import { IqAttemptModel } from '@/models/IqAttempt'

/**
 * One IQ result, addressed by capability token.
 *
 * `force-dynamic` + `no-store` is a correctness requirement: this page is token-scoped, so
 * caching risks serving one person's score under another person's URL. It also has to
 * reflect a payment that landed seconds ago.
 *
 * ## What is behind the paywall
 *
 * The result is the product - the score, the percentile, the band - and the certificate
 * comes with it rather than being sold separately. That is the same model MBTI runs, and
 * running one model across both products means one checkout component, one fulfilment
 * shape, and one sentence in the privacy notice.
 *
 * The paywall renders INSTEAD of the score, never over it. A number blurred behind an
 * overlay is still in the HTML, and anyone who opens devtools reads it - which would make
 * the paywall theatre and teach the visitor that this site can be ignored.
 */
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string; id: string }>
}): Promise<Metadata> {
  const { lang } = await params
  if (!isLocale(lang)) return {}
  return {
    title: iqUi(lang).yourScore,
    // Never indexed: this URL is a credential. A crawled result page is a leaked one.
    robots: { index: false, follow: false },
  }
}

export default async function IqResultPage({
  params,
}: {
  params: Promise<{ lang: string; id: string }>
}) {
  const { lang, id } = await params
  if (!isLocale(lang)) notFound()

  // Shape check before the query: a malformed segment never becomes a database round trip.
  if (!isTokenShaped(id)) notFound()

  await connectDatabase()
  const attempt = await IqAttemptModel.findById(id).lean()

  // Missing and expired are indistinguishable, and both are a 404. With a TTL, "not found"
  // is a normal outcome rather than an error.
  if (!attempt) notFound()

  const copy = iqUi(lang)

  // Started but never finished: send them back rather than showing an empty result.
  if (attempt.submittedAt === null || attempt.score === null)
    return (
      <main>
        <SectionFrame
          className="py-section-sm"
          innerClassName="max-w-2xl"
        >
          <p className="text-pp-muted">{copy.timeUp}</p>
          <Link
            href={`/${lang}/iq/test`}
            className="mt-6 inline-flex items-center gap-2.5 font-display text-sm font-semibold uppercase tracking-[0.16em] text-pp-text"
          >
            {copy.retake}
            <Chevron direction="right" />
          </Link>
        </SectionFrame>
      </main>
    )

  /**
   * `paid` is what gates the score, not the presence of an email.
   *
   * Reading `isIqPaidMode()` here rather than only at checkout is what makes turning the
   * price off release every existing result: with no price, nothing is locked, including
   * attempts that were sitting behind a paywall a minute ago.
   *
   * `waived` is the third way out, decided at submit: a score reached by guessing through
   * the test in a couple of minutes is not a measurement, so it is released free and says
   * so. See `lib/test-kit/effort.ts`.
   */
  const paidMode = isIqPaidMode()
  const locked = paidMode && !attempt.paid && !attempt.waived

  /**
   * The notice is about a charge that did not happen, so it only makes sense where a charge
   * was possible. With `IQ_RESULT_PRICE` unset every result is free anyway, and telling a
   * rusher "this one is free" would imply the others are not.
   */
  const explainWaiver = paidMode && attempt.waived

  // Fires either way - they did reach the result page. The gap between `result-viewed` and
  // `paid` IS the paywall's conversion rate, which is the number a pricing decision gets
  // made from.
  recordFunnelDetached('iq', FUNNEL_EVENTS.resultViewed)

  // The locked subset, recorded IN ADDITION to `result-viewed` rather than instead of it.
  //
  // Without this the dashboard could not answer "how many people actually hit the wall",
  // because `result-viewed` counts everyone including those who never saw it. Additive on
  // purpose: MBTI emits these two as mutually exclusive, so if this replaced
  // `result-viewed` the same label would mean a different thing per product and the two
  // columns could not be read side by side. See the note under the funnel on `/metrics`.
  if (locked) {
    recordFunnelDetached('iq', FUNNEL_EVENTS.paywallSeen)

    return (
      <main>
        <SectionFrame
          className="py-section-sm"
          innerClassName="max-w-2xl"
        >
          <TestPaywall
            token={id}
            locale={lang}
            endpoint="/api/iq/checkout"
            withName
            // Formatted here rather than in the client so đồng formatting lives in one
            // place and the client never has to know the raw amount.
            price={formatPrice(getIqResultPrice())}
            copy={{
              // Everything about the bank transfer itself is shared with MBTI; only the
              // product-specific lines come from IQ's own content file.
              ...paymentCopy(lang),
              title: copy.paywallTitle,
              lead: copy.paywallLead,
              emailLabel: copy.emailLabel,
              emailPlaceholder: copy.emailPlaceholder,
              emailHint: copy.emailHint,
              nameLabel: copy.certificateNameLabel,
              namePlaceholder: copy.certificateNamePlaceholder,
              nameHint: copy.certificateNameHint,
              deliveryNote: copy.payDeliveryNote,
              invalidEmail: copy.invalidEmail,
              invalidName: copy.invalidName,
              rateLimited: copy.rateLimited,
              genericError: copy.genericError,
            }}
          />

          {/*
            A locked result is a dead end without this. Someone who followed a shared link
            lands on a paywall for a stranger's result with no way into the product - the
            loop stops on the exact page it is supposed to continue from.
          */}
          <div className="mt-8 border-t border-pp-line pt-6">
            <p className="text-sm text-pp-muted">{copy.lockedRecruitLead}</p>
            <Link
              href={`/${lang}/iq/test`}
              className="mt-3 inline-flex items-center gap-2.5 font-display text-sm font-semibold uppercase tracking-[0.16em] text-pp-text"
            >
              {copy.lockedRecruitCta}
              <Chevron direction="right" />
            </Link>
          </div>
        </SectionFrame>
      </main>
    )
  }

  const bandLabel = BAND_LABELS[lang][attempt.band ?? ''] ?? attempt.band ?? ''

  // Minted per render, recorded only if they actually tap share. Points at the public
  // landing page, never at this URL - this URL is the credential for this result.
  const shareToken = mintShareToken()
  const shareUrl = `/${lang}/iq?s=${shareToken}`

  return (
    <main>
      <SectionFrame
        aria-labelledby="iq-result-heading"
        disableReveal
        className="border-b border-pp-line pb-section-sm pt-10 md:pt-14"
        innerClassName="max-w-3xl"
      >
        <p className="font-display text-xs font-semibold uppercase tracking-[0.18em] text-pp-muted">
          {copy.yourScore}
        </p>
        <h1
          id="iq-result-heading"
          className="mt-3 font-display text-[clamp(3.5rem,12vw,7rem)] font-semibold tabular-nums leading-[0.95] tracking-tight text-pp-text"
        >
          {attempt.score}
        </h1>
        <p className="mt-3 font-display text-xl font-semibold text-pp-text">
          {bandLabel}
        </p>
        <p className="mt-4 text-base text-pp-muted md:text-lg">
          {fill(copy.percentileLabel, { percentile: attempt.percentile ?? 0 })}
        </p>
        <p className="mt-1 text-sm text-pp-muted">
          {fill(copy.rawLabel, {
            raw: attempt.raw ?? 0,
            total: attempt.answers?.length ?? 26,
          })}
        </p>
      </SectionFrame>

      <SectionFrame
        className="py-section-sm"
        innerClassName="max-w-3xl"
      >
        {/*
          The waiver, said out loud, above everything else on the page.
          ```
            ┌────────────────────────────────────┐
            │ This one is free - here is why     │
            │ ...and no certificate with it      │
            │ [ take it again ]                  │
            └────────────────────────────────────┘
          ```
          Placed first because it changes how the number above should be read. A free score
          with no explanation looks like arbitrary pricing to the taker and like a bug to
          anyone comparing notes; the sentence is what turns it into a validity guarantee.

          The retake link is the point of the whole feature: someone who rushed has now seen
          exactly what the product looks like, which is more than the paywall alone ever
          shows them.
        */}
        {explainWaiver ? (
          <EditorialPanel
            variant="strong"
            className="mb-8 p-6 md:p-7"
          >
            <h2 className="font-display text-sm font-semibold uppercase tracking-[0.18em] text-pp-text">
              {copy.waivedTitle}
            </h2>
            <p className="mt-3 text-pp-muted">{copy.waivedBody}</p>
            <p className="mt-3 text-sm text-pp-muted">
              {copy.waivedNoCertificate}
            </p>
            <Link
              href={`/${lang}/iq/test`}
              className="mt-5 inline-flex items-center gap-2.5 rounded-full bg-pp-text px-7 py-3.5 font-display text-sm font-semibold uppercase tracking-[0.16em] text-[var(--pp-bg)] no-underline"
            >
              {copy.retake}
              <Chevron direction="right" />
            </Link>
          </EditorialPanel>
        ) : null}

        {/*
          The certificate, when there is one. Present on every paid result - it ships with
          the purchase rather than being an upsell - and absent in free mode, where nothing
          was bought and there is no name to put on it.
        */}
        {attempt.certificateId ? (
          <EditorialPanel
            variant="strong"
            className="p-6 md:p-7"
          >
            <h2 className="font-display text-sm font-semibold uppercase tracking-[0.18em] text-pp-text">
              {copy.certificateTitle}
            </h2>
            <p className="mt-3 text-pp-muted">{copy.certificateLead}</p>
            <Link
              href={`/${lang}/iq/certificate/${attempt.certificateId}`}
              className="mt-5 inline-flex items-center gap-2.5 rounded-full bg-pp-text px-7 py-3.5 font-display text-sm font-semibold uppercase tracking-[0.16em] text-[var(--pp-bg)] no-underline"
            >
              {copy.certificateView}
              <Chevron direction="right" />
            </Link>
          </EditorialPanel>
        ) : null}

        {/*
          Placed right under the score, because this is the exact moment the question
          lands - someone has just been handed a number and is deciding whether to believe
          it. Answering that honestly here is worth more than another share button.
        */}
        <MethodTease
          className="mt-8"
          href={`/${lang}/iq/method`}
          title={copy.methodTeaseTitle}
          body={copy.methodTeaseBody}
          cta={copy.methodTeaseCta}
        />

        <div className="mt-9 flex flex-wrap items-center gap-4">
          <ShareControl
            product="iq"
            shareToken={shareToken}
            type={attempt.band ?? 'iq'}
            url={shareUrl}
            title={`${copy.scoreLabel} ${attempt.score}`}
            text={fill(copy.percentileLabel, {
              percentile: attempt.percentile ?? 0,
            })}
            copy={{
              share: copy.certificateShare,
              copied: copy.shareCopied,
              copyManually: copy.shareCopyManually,
            }}
          />
          <Link
            href={`/${lang}/iq/test`}
            className="text-sm text-pp-muted underline underline-offset-[0.2em]"
          >
            {copy.retake}
          </Link>
        </div>

        <p className="mt-8 text-sm text-pp-muted">
          {fill(copy.keepLink, { days: ATTEMPT_TTL_DAYS })}
        </p>
      </SectionFrame>
    </main>
  )
}
