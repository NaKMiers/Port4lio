import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import Chevron from '@/components/mbti/Chevron'
import { GROUP_ACCENT } from '@/components/mbti/type-accent'
import { EditorialPanel } from '@/components/portfolio/primitives/EditorialPanel'
import { SectionFrame } from '@/components/portfolio/primitives/SectionFrame'
import ShareControl from '@/components/test-kit/ShareControl'
import TestPaywall from '@/components/test-kit/TestPaywall'
import { paymentCopy } from '@/lib/test-kit/payment-copy'
import { isLocale } from '@/lib/i18n'
import { getTypeContent, UI } from '@/lib/mbti/content'
import { formatPrice, getResultPrice, isPaidMode } from '@/lib/mbti/pricing'
import { connectDatabase } from '@/lib/mongodb'
import {
  AXES,
  groupOfType,
  isMbtiType,
  slugFromType,
  type MbtiType,
} from '@/lib/mbti/types'
import { mintShareToken } from '@/lib/share'
import { FUNNEL_EVENTS, recordFunnelDetached } from '@/lib/test-events'
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
   *
   * `waived` is the third way out, decided at submit: an attempt whose answers are a held
   * button rather than an opinion is released free, because there is nothing there worth
   * charging for. See `lib/test-kit/effort.ts`.
   */
  const paidMode = isPaidMode()
  const locked = paidMode && !attempt.paid && !attempt.waived

  /** See the IQ result page: a waiver is only worth explaining where a charge was possible. */
  const explainWaiver = paidMode && attempt.waived

  // Fire-and-forget: a counter must never delay or fail a render, least of all one someone
  // paid for. `recordFunnelDetached` swallows everything internally.
  recordFunnelDetached(
    'mbti',
    locked ? FUNNEL_EVENTS.paywallSeen : FUNNEL_EVENTS.resultViewed
  )

  /**
   * A locked result renders the paywall and NOTHING ELSE - same shape as the IQ page.
   *
   * The four letters are the product. This page used to print the type, the nickname and
   * the tagline above the paywall on the theory that the type is the hook and the depth is
   * the sale, but that gives away the one thing a taker came here to learn: not what ESTJ
   * means - `/[lang]/mbti/<type>` explains that to anyone, for free, forever - but that
   * ESTJ is THEM. Sold the answer, charged for the footnotes.
   *
   * An early return rather than a `locked ?` ternary around each block, because the header
   * sat OUTSIDE that ternary and no amount of care inside it would have covered the leak.
   * One return is also the only version where "what does a non-payer see" has a single
   * answer that can be read off the page in one place.
   *
   * `waived` and `MBTI_RESULT_PRICE=0` both flow through `locked`, so a free result still
   * shows everything - the gate closes on unpaid attempts only.
   */
  if (locked)
    return (
      <main>
        <SectionFrame
          className="py-section-sm"
          innerClassName="max-w-2xl"
        >
          <TestPaywall
            token={id}
            locale={lang}
            endpoint="/api/mbti/checkout"
            // Formatted here rather than in the client so đồng formatting lives in one
            // place and the client never has to know the raw amount.
            price={formatPrice(getResultPrice())}
            copy={{
              // Product-specific copy from MBTI's own content file; everything about the
              // bank transfer itself is shared with IQ.
              ...paymentCopy(lang),
              title: copy.paywallTitle,
              lead: copy.paywallLead,
              emailLabel: copy.emailLabel,
              emailPlaceholder: copy.emailPlaceholder,
              emailHint: copy.emailHint,
              deliveryNote: copy.payDeliveryNote,
              invalidEmail: copy.invalidEmail,
              rateLimited: copy.rateLimited,
              genericError: copy.genericError,
            }}
          />

          {/*
            A locked result is a dead end without this. Someone who followed a shared link
            lands on a paywall for a stranger's result with no way into the product - the
            loop stops on the exact page it is supposed to continue from. One link fixes it.
          */}
          <div className="mt-8 border-t border-pp-line pt-6">
            <p className="text-sm text-pp-muted">{copy.lockedRecruitLead}</p>
            <Link
              href={`/${lang}/mbti/test`}
              className="mt-3 inline-flex items-center gap-2.5 font-display text-sm font-semibold uppercase tracking-[0.16em] text-pp-text"
            >
              {copy.lockedRecruitCta}
              <Chevron direction="right" />
            </Link>
          </div>
        </SectionFrame>
      </main>
    )

  /**
   * Minted per render, recorded only if the visitor actually taps share.
   *
   * The shared URL points at `/[lang]/mbti/<type>` - already public, already carrying a
   * prerendered OG card, and crucially carrying no credential. Sharing `id` instead would
   * paste the capability token for this result into a group chat.
   */
  const shareToken = mintShareToken()
  const shareUrl = `/${lang}/mbti/${slugFromType(type)}?s=${shareToken}`

  return (
    <main>
      <SectionFrame
        aria-labelledby="result-heading"
        disableReveal
        className="border-b border-pp-line pb-section-sm pt-10 md:pt-14"
        innerClassName="max-w-3xl"
      >
        <p className="font-display text-xs font-semibold uppercase tracking-[0.18em] text-pp-muted">
          {copy.yourType}
        </p>
        <h1
          id="result-heading"
          className="mt-3 font-display text-[clamp(3rem,9vw,5.5rem)] font-semibold leading-[0.95] tracking-tight text-pp-text"
        >
          {type}
        </h1>
        <p className={`mt-3 font-display text-xl font-semibold ${accent.text}`}>
          {content.nickname}
        </p>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-pp-muted md:text-lg">
          {content.tagline}
        </p>
      </SectionFrame>

      <SectionFrame
        className="py-section-sm"
        innerClassName="max-w-3xl"
      >
        {/*
          The waiver, said out loud, above the result it applies to. Same reasoning as the
          IQ page: a free result with no explanation reads as arbitrary pricing, and the
          sentence is what makes it a validity guarantee instead. The retake link is the
          point - they have now seen the product.
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
            <Link
              href={`/${lang}/mbti/test`}
              className="mt-5 inline-flex items-center gap-2.5 rounded-full bg-pp-text px-7 py-3.5 font-display text-sm font-semibold uppercase tracking-[0.16em] text-[var(--pp-bg)] no-underline"
            >
              {copy.retake}
              <Chevron direction="right" />
            </Link>
          </EditorialPanel>
        ) : null}

        <EditorialPanel
          variant="strong"
          className="p-6 md:p-7"
        >
          <h2 className="font-display text-sm font-semibold uppercase tracking-[0.18em] text-pp-text">
            {copy.axisBreakdown}
          </h2>
          <dl className="mt-5 space-y-4">
            {AXES.map(axis => {
              const score = attempt.scores[axis]
              const total = score.a + score.b
              const aPercent = Math.round((score.a / total) * 100)
              // The dominant side is the one worth colouring in; a bar that always fills
              // from the left reads as "more is better" on an axis that has no better side.
              const leansA = aPercent >= 50
              return (
                <div key={axis}>
                  <dt className="flex items-baseline justify-between gap-4 font-display text-sm font-semibold tabular-nums">
                    <span className={leansA ? 'text-pp-text' : 'text-pp-muted'}>
                      {axis[0]} {aPercent}%
                    </span>
                    <span className={leansA ? 'text-pp-muted' : 'text-pp-text'}>
                      {100 - aPercent}% {axis[1]}
                    </span>
                  </dt>
                  <dd
                    className="mt-1.5 h-2 overflow-hidden rounded-full bg-[rgba(31,28,26,0.07)]"
                    aria-label={`${axis}: ${aPercent}% ${axis[0]}, ${100 - aPercent}% ${axis[1]}`}
                  >
                    <div
                      className="h-full rounded-full bg-[linear-gradient(90deg,var(--pp-violet),var(--pp-blue))]"
                      style={{ width: `${aPercent}%` }}
                    />
                  </dd>
                </div>
              )
            })}
          </dl>
        </EditorialPanel>

        <div className="mt-8 space-y-4">
          {content.overview.map(paragraph => (
            <p
              key={paragraph}
              className="text-pp-muted"
            >
              {paragraph}
            </p>
          ))}
        </div>

        <div className="mt-9 flex flex-wrap items-center gap-4">
          <Link
            href={`/${lang}/mbti/${slugFromType(type)}`}
            className="inline-flex items-center gap-2.5 rounded-full bg-pp-text px-7 py-3.5 font-display text-sm font-semibold uppercase tracking-[0.16em] text-[var(--pp-bg)] no-underline shadow-[0_16px_32px_rgba(31,28,26,0.18)] transition hover:-translate-y-0.5 hover:shadow-[0_20px_38px_rgba(31,28,26,0.22)] motion-reduce:hover:translate-y-0"
          >
            {copy.readFullType} {type}
            <Chevron direction="right" />
          </Link>
          <ShareControl
            product="mbti"
            shareToken={shareToken}
            type={slugFromType(type)}
            url={shareUrl}
            title={copy.shareTitle.replace('{type}', type)}
            text={copy.shareText.replace('{type}', type)}
            copy={{
              share: copy.shareButton,
              copied: copy.shareCopied,
              copyManually: copy.shareCopyManually,
            }}
          />
          <Link
            href={`/${lang}/mbti/test`}
            className="text-sm font-semibold text-pp-muted no-underline transition hover:text-pp-text"
          >
            {copy.retake}
          </Link>
        </div>

        <EditorialPanel
          variant="default"
          className="mt-10 flex gap-3.5 border-[rgba(255,159,64,0.3)] bg-[rgba(255,159,64,0.07)] p-5"
        >
          <span
            className="mt-1 h-2 w-2 shrink-0 rounded-full bg-pp-orange"
            aria-hidden
          />
          <p className="text-sm leading-relaxed text-pp-muted">
            {copy.resultKeepLink.replace('{days}', String(ATTEMPT_TTL_DAYS))}
          </p>
        </EditorialPanel>
      </SectionFrame>
    </main>
  )
}
