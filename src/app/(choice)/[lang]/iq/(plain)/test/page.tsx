import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import IqTestClient from '@/app/(choice)/[lang]/iq/(plain)/test/IqTestClient'
import { isLocale, LOCALES } from '@/lib/i18n'
import { iqUi } from '@/lib/iq/content'

/**
 * The test page. A shell only - the questions come from `/api/iq/start`.
 *
 * That split is a correctness requirement, not a preference. The answer key at submit is
 * derived from the seed stored on the attempt row, so the questions the taker sees have to
 * come from that same seed. Generating them here would mean rendering one test and scoring
 * another, and the resulting number would look completely plausible while measuring
 * nothing.
 *
 * `force-static` is therefore fine and correct: this page has no per-visit content. The
 * clock starts when the client calls `/api/iq/start`, not when this HTML is served, so a
 * cached shell cannot leak or expire anything.
 *
 * Not indexed. There is nothing here to rank - `/iq` and `/iq/method` are the indexable
 * surface - and a crawler landing here would only ever see an empty shell.
 */
export const dynamic = 'force-static'

export function generateStaticParams() {
  return LOCALES.map(lang => ({ lang }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>
}): Promise<Metadata> {
  const { lang } = await params
  if (!isLocale(lang)) return {}
  return { title: iqUi(lang).startTest, robots: { index: false, follow: false } }
}

export default async function IqTestPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params
  if (!isLocale(lang)) notFound()

  const copy = iqUi(lang)

  return (
    /*
      `data-plain` switches off the floating shapes for this page only (see globals.css).
      The background wash stays. Several of those ornaments are circles and half-filled
      rounds - the exact vocabulary the answers use - so leaving them drifting around a
      timed pattern-matching test is not just noisy, it is misleading.
    */
    <main data-plain>
      <IqTestClient
        locale={lang}
        copy={{
          questionProgress: copy.questionProgress,
          timeLeft: copy.timeLeft,
          skip: copy.skip,
          back: copy.back,
          submitting: copy.submitting,
          timeUp: copy.timeUp,
          rateLimited: copy.rateLimited,
          genericError: copy.genericError,
        }}
      />
    </main>
  )
}
