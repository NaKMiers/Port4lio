import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import Chevron from '@/components/mbti/Chevron'
import { EditorialPanel } from '@/components/portfolio/primitives/EditorialPanel'
import { SectionFrame } from '@/components/portfolio/primitives/SectionFrame'
import MethodTease from '@/components/test-kit/MethodTease'
import { isLocale, LOCALES } from '@/lib/i18n'
import { fill, IQ_LANDING_SECTIONS, iqUi } from '@/lib/iq/content'
import { ITEM_COUNT } from '@/lib/iq/items/config'
import { TEST_DURATION_SECONDS } from '@/lib/iq/scoring'
import { getIqResultPrice } from '@/lib/iq/pricing'
import {
  alternateIqLanguages,
  iqBreadcrumbJsonLd,
  iqDescription,
  iqFaqEntries,
  iqFaqJsonLd,
  iqLandingJsonLd,
} from '@/lib/iq/seo'
import JsonLd from '@/components/JsonLd'

/**
 * The IQ landing page. Fully static - nothing here reads the database or the request.
 *
 * Along with `/iq/method` this is one of only two IQ pages someone can find without being
 * sent a link, so it is prerendered and indexable. The test, result and certificate pages
 * are all token-scoped or dynamic and deliberately are not.
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
  const copy = iqUi(lang)
  // Read at build time, since this page is prerendered. Changing the price is a redeploy,
  // which is also what it takes to change the price PayOS is asked for.
  const description = iqDescription(lang, getIqResultPrice())

  return {
    title: copy.landingTitle,
    description,
    alternates: {
      canonical: `/${lang}/iq`,
      languages: alternateIqLanguages(locale => `/${locale}/iq`),
    },
    openGraph: {
      title: copy.landingTitle,
      description,
      url: `/${lang}/iq`,
      type: 'website',
    },
  }
}

export default async function IqLandingPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params
  if (!isLocale(lang)) notFound()

  const copy = iqUi(lang)
  const sections = IQ_LANDING_SECTIONS[lang]
  const minutes = Math.round(TEST_DURATION_SECONDS / 60)
  const price = getIqResultPrice()

  return (
    <main>
      <JsonLd data={iqLandingJsonLd(lang, price)} />
      <JsonLd data={iqFaqJsonLd(lang, price)} />
      {/*
        The MBTI landing has had a breadcrumb since it shipped; this one did not, so IQ
        results showed a bare URL in search where MBTI's showed a trail.
      */}
      <JsonLd
        data={iqBreadcrumbJsonLd(lang, [
          { name: 'Home', path: '/' },
          { name: copy.brand, path: `/${lang}/iq` },
        ])}
      />

      <SectionFrame
        aria-labelledby='iq-heading'
        disableReveal
        className='border-b border-pp-line pb-section-sm pt-10 md:pt-16'
        innerClassName='max-w-3xl'
      >
        <h1
          id='iq-heading'
          className='font-display text-[clamp(2.4rem,6vw,4rem)] font-semibold leading-[1.02] tracking-tight text-pp-text'
        >
          {copy.landingTitle}
        </h1>
        <p className='mt-5 max-w-2xl text-base leading-relaxed text-pp-muted md:text-lg'>
          {copy.landingLead}
        </p>

        <div className='mt-8'>
          <Link
            href={`/${lang}/iq/test`}
            className='inline-flex items-center gap-2.5 rounded-full bg-pp-text px-8 py-4 font-display text-sm font-semibold uppercase tracking-[0.16em] text-[var(--pp-bg)] no-underline shadow-[0_16px_32px_rgba(31,28,26,0.18)] transition hover:-translate-y-0.5 motion-reduce:hover:translate-y-0'
          >
            {copy.startTest}
            <Chevron direction='right' />
          </Link>
        </div>
      </SectionFrame>

      <SectionFrame className='py-section-sm' innerClassName='max-w-3xl'>
        <EditorialPanel variant='strong' className='p-6 md:p-7'>
          <h2 className='font-display text-sm font-semibold uppercase tracking-[0.18em] text-pp-text'>
            {copy.howItWorks}
          </h2>
          <p className='mt-4 text-pp-muted'>
            {fill(copy.howItWorksBody, { count: ITEM_COUNT, minutes })}
          </p>
        </EditorialPanel>

        <MethodTease
          className='mt-6'
          href={`/${lang}/iq/method`}
          title={copy.methodTeaseTitle}
          body={copy.methodTeaseBody}
          cta={copy.methodTeaseCta}
        />

      </SectionFrame>

      <SectionFrame className='py-section-sm' innerClassName='max-w-3xl'>
        <section aria-labelledby='iq-about'>
          <h2
            id='iq-about'
            className='font-display text-[clamp(1.6rem,3.4vw,2.1rem)] font-semibold tracking-tight text-pp-text'
          >
            {sections.aboutHeading}
          </h2>
          <p className='mt-4 text-pp-muted md:text-lg'>{sections.aboutBody}</p>
        </section>

        {/*
          The differentiated content. Every competitor shows sample questions; none explain
          the transformations their items are built from, because most licensed a fixed
          image bank and do not know. This is the one section only a generated test can
          write, and it doubles as long-tail surface.
        */}
        <section aria-labelledby='iq-rules' className='mt-14'>
          <h2
            id='iq-rules'
            className='font-display text-[clamp(1.6rem,3.4vw,2.1rem)] font-semibold tracking-tight text-pp-text'
          >
            {sections.rulesHeading}
          </h2>
          <p className='mt-4 text-pp-muted md:text-lg'>{sections.rulesLead}</p>

          <ol className='mt-7 space-y-4'>
            {sections.rules.map((rule, index) => (
              <li key={rule.name}>
                <EditorialPanel className='flex gap-4 p-5'>
                  <span
                    aria-hidden
                    className='mt-0.5 grid h-7 w-7 flex-none place-items-center rounded-full bg-[rgba(31,28,26,0.06)] font-display text-xs font-semibold tabular-nums text-pp-text'
                  >
                    {index + 1}
                  </span>
                  <div className='min-w-0'>
                    <h3 className='font-display text-base font-semibold text-pp-text'>{rule.name}</h3>
                    <p className='mt-1.5 text-sm leading-relaxed text-pp-muted'>{rule.body}</p>
                  </div>
                </EditorialPanel>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby='iq-tips' className='mt-14'>
          <h2
            id='iq-tips'
            className='font-display text-[clamp(1.6rem,3.4vw,2.1rem)] font-semibold tracking-tight text-pp-text'
          >
            {sections.tipsHeading}
          </h2>
          <ul className='mt-5 space-y-3'>
            {sections.tips.map(tip => (
              <li key={tip} className='flex gap-3 text-pp-muted'>
                <span aria-hidden className='mt-2 h-1.5 w-1.5 flex-none rounded-full bg-pp-blue' />
                <span>{tip}</span>
              </li>
            ))}
          </ul>
        </section>

        {/*
          The limits, on the page people actually land on rather than only behind a link.
          Same claim as /iq/method, deliberately - if these two ever disagree, one of them
          is lying and the honest-scoring position collapses.
        */}
        <section aria-labelledby='iq-limits' className='mt-14'>
          <h2
            id='iq-limits'
            className='font-display text-[clamp(1.6rem,3.4vw,2.1rem)] font-semibold tracking-tight text-pp-text'
          >
            {sections.limitsHeading}
          </h2>
          <p className='mt-4 text-pp-muted md:text-lg'>{sections.limitsBody}</p>
        </section>

        {/*
          The FAQ was previously only in JSON-LD, which meant a crawler could read answers
          a human never could. Same source array, so the structured data and the page can
          never drift apart.
        */}
        <section aria-labelledby='iq-faq' className='mt-14'>
          <h2
            id='iq-faq'
            className='font-display text-[clamp(1.6rem,3.4vw,2.1rem)] font-semibold tracking-tight text-pp-text'
          >
            {sections.faqHeading}
          </h2>
          <dl className='mt-6 space-y-5'>
            {iqFaqEntries(lang, price).map(entry => (
              <div key={entry.q} className='border-b border-pp-line pb-5 last:border-b-0'>
                <dt className='font-display text-base font-semibold text-pp-text'>{entry.q}</dt>
                <dd className='mt-2 text-pp-muted'>{entry.a}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/*
          Start button alone. The privacy link that used to sit beside it was competing with
          the one call to action at the bottom of a long page - and `TestChrome` already
          renders a privacy link in the footer of every page, so it was a second copy
          stealing attention from the first.
        */}
        <div className='mt-14 border-t border-pp-line pt-9'>
          <Link
            href={`/${lang}/iq/test`}
            className='inline-flex items-center gap-2.5 rounded-full bg-pp-text px-8 py-4 font-display text-sm font-semibold uppercase tracking-[0.16em] text-[var(--pp-bg)] no-underline shadow-[0_16px_32px_rgba(31,28,26,0.18)] transition hover:-translate-y-0.5 motion-reduce:hover:translate-y-0'
          >
            {copy.startTest}
            <Chevron direction='right' />
          </Link>
        </div>
      </SectionFrame>
    </main>
  )
}
