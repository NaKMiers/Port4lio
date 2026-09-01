import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import Chevron from '@/components/mbti/Chevron'
import JsonLd from '@/components/JsonLd'
import { GROUP_ACCENT } from '@/components/mbti/type-accent'
import { EditorialPanel } from '@/components/portfolio/primitives/EditorialPanel'
import { SectionFrame } from '@/components/portfolio/primitives/SectionFrame'
import { isLocale, LOCALES } from '@/lib/i18n'
import { getTypeContent, UI } from '@/lib/mbti/content'
import { getResultPrice } from '@/lib/mbti/pricing'
import { QUESTION_COUNT } from '@/lib/mbti/questions'
import {
  alternateLanguages,
  breadcrumbJsonLd,
  faqEntries,
  faqJsonLd,
  landingDescription,
  landingTitle,
  productJsonLd,
  SEO,
  typeListJsonLd,
  websiteJsonLd,
} from '@/lib/mbti/seo'
import { MBTI_TYPES, slugFromType, TYPE_GROUPS, typesInGroup } from '@/lib/mbti/types'

/**
 * MBTI landing. Fully static: the content is compiled in, nothing here reads the database
 * or the request. Along with the 16 type pages this is one of only two ways someone finds
 * this product without being sent a link, so it is prerendered and indexable.
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

  const price = getResultPrice()
  const title = landingTitle(lang, price)
  const description = landingDescription(lang, price)

  return {
    title,
    description,
    keywords: [...SEO[lang].keywords],
    alternates: {
      canonical: `/${lang}/mbti`,
      // Both versions exist at stable URLs, so tell search engines about both rather than
      // letting one language shadow the other. `x-default` points at Vietnamese - see the
      // note on `alternateLanguages`.
      languages: alternateLanguages(locale => `/${locale}/mbti`),
    },
    openGraph: {
      type: 'website',
      title,
      description,
      url: `/${lang}/mbti`,
      siteName: SEO[lang].siteName,
      locale: lang === 'vi' ? 'vi_VN' : 'en_US',
      alternateLocale: LOCALES.filter(l => l !== lang).map(l => (l === 'vi' ? 'vi_VN' : 'en_US')),
    },
    twitter: { card: 'summary_large_image', title, description },
  }
}

/** The four axis chips, coloured in the same order the axes are scored. */
const AXIS_DOTS = ['bg-pp-orange', 'bg-pp-blue', 'bg-pp-green', 'bg-pp-violet'] as const

export default async function MbtiLandingPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params
  if (!isLocale(lang)) notFound()

  const copy = UI[lang]
  const price = getResultPrice()
  const faqs = faqEntries(lang, price)

  return (
    <main>
      {/*
        One script per entity rather than an @graph: they are independent statements, and a
        malformed one then fails alone instead of taking the whole payload down with it.
      */}
      <JsonLd data={websiteJsonLd(lang)} />
      <JsonLd data={productJsonLd(lang, price)} />
      <JsonLd data={typeListJsonLd(lang, MBTI_TYPES)} />
      <JsonLd data={faqJsonLd(lang, price)} />
      <JsonLd
        data={breadcrumbJsonLd(lang, [
          { name: SEO[lang].breadcrumbHome, path: '/' },
          { name: SEO[lang].breadcrumbMbti, path: `/${lang}/mbti` },
        ])}
      />

      <SectionFrame
        id='mbti-hero'
        aria-labelledby='mbti-heading'
        disableReveal
        className='border-b border-pp-line pb-section-sm pt-10 md:pt-14'
      >
        <div className='max-w-3xl'>
          <div className='inline-flex items-center gap-3 rounded-full border border-pp-line/80 bg-white/70 px-4 py-2 shadow-[0_12px_28px_rgba(46,35,28,0.06)] backdrop-blur-md'>
            <span
              className='h-2.5 w-2.5 rounded-full bg-[linear-gradient(135deg,var(--pp-violet),var(--pp-blue))] shadow-[0_0_0_8px_rgba(123,109,255,0.12)]'
              aria-hidden
            />
            <span className='text-xs font-semibold uppercase tracking-[0.18em] text-pp-text'>
              {copy.testMeta.replace('{count}', String(QUESTION_COUNT))}
            </span>
          </div>

          <h1
            id='mbti-heading'
            className='mt-6 font-display text-[clamp(2.25rem,5vw,3.75rem)] font-semibold leading-[1.08] tracking-tight text-pp-text'
          >
            {copy.landingTitle}
          </h1>

          <p className='mt-5 max-w-2xl text-base leading-relaxed text-pp-muted md:text-lg'>
            {copy.landingLead}
          </p>

          <ul className='mt-8 flex flex-wrap gap-2.5'>
            {copy.landingAxes.map((axis, index) => (
              <li key={axis}>
                <span className='inline-flex items-center gap-2 rounded-full border border-pp-line bg-pp-panel-strong px-3.5 py-2 text-xs font-semibold uppercase tracking-[0.15em] text-pp-text shadow-[0_8px_18px_rgba(46,35,28,0.05)]'>
                  <span className={`h-2 w-2 rounded-full ${AXIS_DOTS[index % 4]}`} aria-hidden />
                  {axis}
                </span>
              </li>
            ))}
          </ul>

          <Link
            href={`/${lang}/mbti/test`}
            className='mt-10 inline-flex items-center gap-2.5 rounded-full bg-pp-text px-7 py-3.5 font-display text-sm font-semibold uppercase tracking-[0.16em] text-[var(--pp-bg)] no-underline shadow-[0_16px_32px_rgba(31,28,26,0.18)] transition hover:-translate-y-0.5 hover:shadow-[0_20px_38px_rgba(31,28,26,0.22)] motion-reduce:hover:translate-y-0'
          >
            {copy.startTest}
            <Chevron direction='right' />
          </Link>
        </div>
      </SectionFrame>

      <SectionFrame id='all-types' aria-labelledby='all-types-heading' className='py-section-sm'>
        <h2
          id='all-types-heading'
          className='font-display text-[clamp(1.75rem,3.4vw,2.5rem)] font-semibold leading-tight tracking-tight text-pp-text'
        >
          {copy.allTypes}
        </h2>
        <p className='mt-3 max-w-2xl text-pp-muted'>{copy.allTypesLead}</p>

        <div className='mt-10 space-y-10'>
          {TYPE_GROUPS.map(group => {
            const accent = GROUP_ACCENT[group]
            return (
              <section key={group} aria-labelledby={`group-${group}`}>
                <div className='flex items-center gap-3'>
                  <span className={`h-2.5 w-2.5 rounded-full ${accent.dot}`} aria-hidden />
                  <h3
                    id={`group-${group}`}
                    className='font-display text-sm font-semibold uppercase tracking-[0.18em] text-pp-text'
                  >
                    {copy.groupLabels[group]}
                  </h3>
                  <span className={`h-px flex-1 ${accent.rule}`} aria-hidden />
                </div>

                <ul className='mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4'>
                  {typesInGroup(group).map(type => {
                    const content = getTypeContent(lang, type)
                    return (
                      <li key={type}>
                        <Link
                          href={`/${lang}/mbti/${slugFromType(type)}`}
                          className='block h-full no-underline'
                        >
                          <EditorialPanel
                            variant='default'
                            className='h-full p-4 motion-safe:transition-transform motion-safe:duration-300 motion-safe:hover:-translate-y-0.5'
                          >
                            <p
                              className={`font-display text-lg font-semibold tracking-tight ${accent.text}`}
                            >
                              {type}
                            </p>
                            <p className='mt-1 text-sm leading-snug text-pp-muted'>
                              {content.nickname}
                            </p>
                          </EditorialPanel>
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </section>
            )
          })}
        </div>
      </SectionFrame>

      {/*
        The FAQ is real page content, not just a JSON-LD payload. Google restricted FAQ rich
        results to government and health sites in 2023, so the structured data alone is
        unlikely to render as an expandable snippet - but these answers target genuine
        long-tail queries ("mbti có chính xác không", "test mbti mất bao lâu") and that is
        what ranks. Plain `<h3>` + `<p>`, not a `<details>` accordion, so the text is in the
        initial HTML rather than behind an interaction.
      */}
      <SectionFrame id='faq' aria-labelledby='faq-heading' className='py-section-sm'>
        <h2
          id='faq-heading'
          className='font-display text-[clamp(1.75rem,3.4vw,2.5rem)] font-semibold leading-tight tracking-tight text-pp-text'
        >
          {copy.faqTitle}
        </h2>

        <div className='mt-8 space-y-3'>
          {faqs.map(({ q, a }) => (
            <EditorialPanel key={q} variant='strong' className='p-5 md:p-6'>
              <h3 className='font-display text-base font-semibold leading-snug text-pp-text'>{q}</h3>
              <p className='mt-2.5 text-sm leading-relaxed text-pp-muted'>{a}</p>
            </EditorialPanel>
          ))}
        </div>
      </SectionFrame>
    </main>
  )
}
