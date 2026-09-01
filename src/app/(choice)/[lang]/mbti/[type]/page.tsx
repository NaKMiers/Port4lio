import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import Chevron from '@/components/mbti/Chevron'
import JsonLd from '@/components/JsonLd'
import { GROUP_ACCENT } from '@/components/mbti/type-accent'
import { EditorialPanel } from '@/components/portfolio/primitives/EditorialPanel'
import { SectionFrame } from '@/components/portfolio/primitives/SectionFrame'
import { isLocale, LOCALES } from '@/lib/i18n'
import { getCareerContent, getTypeContent, UI } from '@/lib/mbti/content'
import { getResultPrice } from '@/lib/mbti/pricing'
import {
  alternateLanguages,
  breadcrumbJsonLd,
  faqPageJsonLd,
  SEO,
  typeArticleJsonLd,
  typeDescription,
  typeFaqEntries,
  typeTitle,
} from '@/lib/mbti/seo'
import {
  FUNCTION_COPY,
  functionStack,
  lettersOf,
  ROLE_COPY,
  ROLE_HINT,
} from '@/lib/mbti/theory'
import {
  groupOfType,
  MBTI_TYPES,
  slugFromType,
  typeFromSlug,
  typesInGroup,
} from '@/lib/mbti/types'

/**
 * One of the 16 type pages. 16 types x 2 locales = 32 prerendered pages.
 *
 * `dynamicParams: false` is what turns an unknown type into a 404 instead of an attempted
 * render: any slug outside `generateStaticParams` is rejected by the router before this
 * component runs. The `typeFromSlug` guard below is belt-and-braces for the dev server,
 * where params are not pre-validated.
 */
export const dynamic = 'force-static'
export const dynamicParams = false

export function generateStaticParams() {
  return LOCALES.flatMap(lang => MBTI_TYPES.map(type => ({ lang, type: slugFromType(type) })))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string; type: string }>
}): Promise<Metadata> {
  const { lang, type: slug } = await params
  const type = typeFromSlug(slug)
  if (!isLocale(lang) || !type) return {}

  const price = getResultPrice()
  const title = typeTitle(lang, type)
  const description = typeDescription(lang, type, price)

  return {
    title,
    description,
    // The type code itself is the highest-intent query on these pages - someone searching
    // "INFJ" or "INFJ là gì" already knows what they want.
    keywords: [type, `${type} là gì`, `nhóm tính cách ${type}`, ...SEO[lang].keywords.slice(0, 4)],
    alternates: {
      canonical: `/${lang}/mbti/${slug}`,
      languages: alternateLanguages(locale => `/${locale}/mbti/${slug}`),
    },
    openGraph: {
      type: 'article',
      title,
      description,
      url: `/${lang}/mbti/${slug}`,
      siteName: SEO[lang].siteName,
      locale: lang === 'vi' ? 'vi_VN' : 'en_US',
    },
    twitter: { card: 'summary_large_image', title, description },
  }
}

export default async function MbtiTypePage({
  params,
}: {
  params: Promise<{ lang: string; type: string }>
}) {
  const { lang, type: slug } = await params
  const type = typeFromSlug(slug)
  if (!isLocale(lang) || !type) notFound()

  const copy = UI[lang]
  const content = getTypeContent(lang, type)
  const group = groupOfType(type)
  const accent = GROUP_ACCENT[group]
  const siblings = typesInGroup(group).filter(other => other !== type)
  const letters = lettersOf(lang, type)
  const stack = functionStack(type)
  const careers = getCareerContent(lang, type)
  const faqs = typeFaqEntries(lang, type)

  /**
   * Jump links. Google uses in-page anchors to build the "jump to" links that appear under
   * a result, which is worth having on a page this long - and they are useful navigation
   * on a phone regardless of whether Google ever renders them.
   */
  const sections = [
    { id: 'letters', label: copy.lettersTitle },
    { id: 'functions', label: copy.functionsTitle },
    { id: 'strengths', label: copy.strengths },
    { id: 'careers', label: copy.careersTitle },
    { id: 'relationships', label: copy.inRelationships },
    { id: 'faq', label: copy.faqTitle },
  ]

  return (
    <main>
      <JsonLd data={typeArticleJsonLd(lang, type)} />
      <JsonLd data={faqPageJsonLd(faqs)} />
      <JsonLd
        data={breadcrumbJsonLd(lang, [
          { name: SEO[lang].breadcrumbHome, path: '/' },
          { name: SEO[lang].breadcrumbMbti, path: `/${lang}/mbti` },
          { name: type, path: `/${lang}/mbti/${slug}` },
        ])}
      />

      <SectionFrame
        aria-labelledby='type-heading'
        disableReveal
        className='border-b border-pp-line pb-section-sm pt-10 md:pt-14'
        innerClassName='max-w-3xl'
      >
        {/*
          `flex w-fit`, not `inline-flex`: the group chip below is inline-level, so an
          inline-level back link shares a line with it and the chip's `mt-6` becomes
          vertical margin on an inline box - which nudges the box without breaking the
          line, leaving the two touching. Block-level here puts the chip on its own row
          and lets that margin apply. `w-fit` keeps the hit area at the text width rather
          than spanning the column.
        */}
        <Link
          href={`/${lang}/mbti`}
          className='flex w-fit items-center gap-2 text-sm font-semibold text-pp-muted no-underline transition hover:text-pp-text'
        >
          <Chevron direction='left' />
          {copy.backToStart}
        </Link>

        <span
          className={`mt-7 inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 font-display text-[11px] font-semibold uppercase tracking-[0.16em] ${accent.chip} ${accent.text}`}
        >
          <span className={`h-2 w-2 rounded-full ${accent.dot}`} aria-hidden />
          {copy.groupLabels[group]}
        </span>

        <h1
          id='type-heading'
          className='mt-4 font-display text-[clamp(2.5rem,6vw,4rem)] font-semibold leading-[1.05] tracking-tight text-pp-text'
        >
          {type}
        </h1>
        <p className={`mt-2 font-display text-xl font-semibold ${accent.text}`}>
          {content.nickname}
        </p>
        <p className='mt-4 max-w-2xl text-base leading-relaxed text-pp-muted md:text-lg'>
          {content.tagline}
        </p>
      </SectionFrame>

      <SectionFrame className='py-section-sm' innerClassName='max-w-3xl'>
        <div className='space-y-4'>
          {content.overview.map(paragraph => (
            <p key={paragraph} className='text-pp-muted'>
              {paragraph}
            </p>
          ))}
        </div>

        <nav aria-labelledby='toc-heading' className='mt-10 rounded-panel border border-pp-line bg-white/50 p-5'>
          <h2
            id='toc-heading'
            className='font-display text-[11px] font-semibold uppercase tracking-[0.18em] text-pp-muted'
          >
            {copy.onThisPage}
          </h2>
          <ul className='mt-3 flex flex-wrap gap-x-5 gap-y-2'>
            {sections.map(section => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className='text-sm font-semibold text-pp-text decoration-pp-blue/50 underline-offset-[0.2em] hover:decoration-pp-blue'
                >
                  {section.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        {/*
          The type code, decomposed. Someone searching "chữ N trong MBTI là gì" or landing
          here from "ENTJ meaning" wants this before anything else, and it is composed from
          eight letter definitions rather than written sixteen times.
        */}
        <section id='letters' aria-labelledby='letters-heading' className='mt-12 scroll-mt-24'>
          <h2
            id='letters-heading'
            className='font-display text-xl font-semibold tracking-tight text-pp-text'
          >
            {copy.lettersTitle}
          </h2>
          <p className='mt-2 text-sm text-pp-muted'>
            {copy.lettersLead.replace('{type}', type)}
          </p>

          <ul className='mt-5 space-y-3'>
            {letters.map(entry => (
              <li key={entry.letter}>
                <EditorialPanel variant='strong' className='flex gap-4 p-5'>
                  <span
                    className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border font-display text-lg font-semibold ${accent.chip} ${accent.text}`}
                    aria-hidden
                  >
                    {entry.letter}
                  </span>
                  <div>
                    <h3 className='font-display text-base font-semibold text-pp-text'>
                      {entry.name}
                    </h3>
                    <p className='mt-1.5 text-sm leading-relaxed text-pp-muted'>{entry.summary}</p>
                  </div>
                </EditorialPanel>
              </li>
            ))}
          </ul>
        </section>

        {/*
          The function stack, derived from the type code by the standard rules rather than
          tabulated - see `functionStack`. "Hàm nhận thức <type>" is one of the highest
          volume follow-up queries after a type code, and it is the part most competitors
          either omit or get wrong.
        */}
        <section id='functions' aria-labelledby='functions-heading' className='mt-12 scroll-mt-24'>
          <h2
            id='functions-heading'
            className='font-display text-xl font-semibold tracking-tight text-pp-text'
          >
            {copy.functionsTitle}
          </h2>
          <p className='mt-2 text-sm leading-relaxed text-pp-muted'>{copy.functionsLead}</p>

          <ol className='mt-5 space-y-3'>
            {stack.map((entry, index) => (
              <li key={entry.role}>
                <EditorialPanel variant='default' className='flex gap-4 p-5'>
                  <span
                    className='flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-pp-line bg-white/70 font-display text-sm font-semibold text-pp-muted'
                    aria-hidden
                  >
                    {index + 1}
                  </span>
                  <div>
                    <p className='font-display text-[11px] font-semibold uppercase tracking-[0.16em] text-pp-muted'>
                      {ROLE_COPY[lang][entry.role]}
                    </p>
                    <h3 className={`mt-1 font-display text-base font-semibold ${accent.text}`}>
                      {FUNCTION_COPY[lang][entry.fn].name}
                    </h3>
                    <p className='mt-1.5 text-sm leading-relaxed text-pp-muted'>
                      {FUNCTION_COPY[lang][entry.fn].summary}
                    </p>
                    <p className='mt-1.5 text-xs leading-relaxed text-pp-muted/80'>
                      {ROLE_HINT[lang][entry.role]}
                    </p>
                  </div>
                </EditorialPanel>
              </li>
            ))}
          </ol>
        </section>

        <div id='strengths' className='mt-12 grid scroll-mt-24 gap-4 md:grid-cols-2'>
          <EditorialPanel variant='strong' className='p-6'>
            <h2 className='font-display text-sm font-semibold uppercase tracking-[0.18em] text-pp-text'>
              {copy.strengths}
            </h2>
            <ul className='mt-4 space-y-2.5'>
              {content.strengths.map(item => (
                <li key={item} className='flex gap-3 text-sm leading-relaxed text-pp-muted'>
                  <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${accent.dot}`} aria-hidden />
                  {item}
                </li>
              ))}
            </ul>
          </EditorialPanel>

          <EditorialPanel variant='strong' className='p-6'>
            <h2 className='font-display text-sm font-semibold uppercase tracking-[0.18em] text-pp-text'>
              {copy.growth}
            </h2>
            <ul className='mt-4 space-y-2.5'>
              {content.growth.map(item => (
                <li key={item} className='flex gap-3 text-sm leading-relaxed text-pp-muted'>
                  <span className='mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-pp-orange' aria-hidden />
                  {item}
                </li>
              ))}
            </ul>
          </EditorialPanel>
        </div>

        {/*
          Careers. Hand-written per type, unlike the letters and functions above - a role
          list that could belong to any of the sixteen types is precisely what the
          helpful-content system demotes, and "nghề nghiệp phù hợp với <type>" is the
          highest-intent query these pages can answer.
        */}
        <section id='careers' aria-labelledby='careers-heading' className='mt-12 scroll-mt-24'>
          <h2
            id='careers-heading'
            className='font-display text-xl font-semibold tracking-tight text-pp-text'
          >
            {copy.careersTitle}
          </h2>
          <p className='mt-3 text-pp-muted'>{careers.workStyle}</p>

          <EditorialPanel variant='strong' className='mt-5 p-6'>
            <h3 className='font-display text-sm font-semibold uppercase tracking-[0.18em] text-pp-text'>
              {copy.careersRoles}
            </h3>
            <ul className='mt-4 grid gap-2.5 sm:grid-cols-2'>
              {careers.roles.map(role => (
                <li key={role} className='flex gap-3 text-sm leading-relaxed text-pp-muted'>
                  <span
                    className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${accent.dot}`}
                    aria-hidden
                  />
                  {role}
                </li>
              ))}
            </ul>
          </EditorialPanel>

          <div className='mt-4 grid gap-4 md:grid-cols-2'>
            <EditorialPanel variant='default' className='p-6'>
              <h3 className='font-display text-sm font-semibold uppercase tracking-[0.18em] text-pp-text'>
                {copy.careersThrives}
              </h3>
              <p className='mt-3 text-sm leading-relaxed text-pp-muted'>{careers.thrivesIn}</p>
            </EditorialPanel>
            <EditorialPanel variant='default' className='p-6'>
              <h3 className='font-display text-sm font-semibold uppercase tracking-[0.18em] text-pp-text'>
                {copy.careersDrains}
              </h3>
              <p className='mt-3 text-sm leading-relaxed text-pp-muted'>{careers.drainedBy}</p>
            </EditorialPanel>
          </div>

          {/* Directly under the list, not buried in a footer. */}
          <p className='mt-4 flex gap-3 rounded-panel border border-[rgba(255,159,64,0.3)] bg-[rgba(255,159,64,0.07)] p-5 text-sm leading-relaxed text-pp-muted'>
            <span className='mt-1.5 h-2 w-2 shrink-0 rounded-full bg-pp-orange' aria-hidden />
            {copy.careersCaveat}
          </p>
        </section>

        <EditorialPanel id='relationships' variant='default' className='mt-12 scroll-mt-24 p-6'>
          <h2 className='font-display text-sm font-semibold uppercase tracking-[0.18em] text-pp-text'>
            {copy.inRelationships}
          </h2>
          <p className='mt-3 text-pp-muted'>{content.inRelationships}</p>
        </EditorialPanel>

        {/*
          Per-type FAQ. Composed from this type's authored content plus the derived stack,
          so it targets the long-tail queries around a type code ("điểm yếu của ISFP",
          "INFJ cognitive functions") without being generic padding.
        */}
        <section id='faq' aria-labelledby='type-faq-heading' className='mt-12 scroll-mt-24'>
          <h2
            id='type-faq-heading'
            className='font-display text-xl font-semibold tracking-tight text-pp-text'
          >
            {copy.faqTitle}
          </h2>
          <div className='mt-5 space-y-3'>
            {faqs.map(({ q, a }) => (
              <EditorialPanel key={q} variant='strong' className='p-5'>
                <h3 className='font-display text-base font-semibold leading-snug text-pp-text'>{q}</h3>
                <p className='mt-2 text-sm leading-relaxed text-pp-muted'>{a}</p>
              </EditorialPanel>
            ))}
          </div>
        </section>

        <Link
          href={`/${lang}/mbti/test`}
          className='mt-10 inline-flex items-center gap-2.5 rounded-full bg-pp-text px-7 py-3.5 font-display text-sm font-semibold uppercase tracking-[0.16em] text-[var(--pp-bg)] no-underline shadow-[0_16px_32px_rgba(31,28,26,0.18)] transition hover:-translate-y-0.5 hover:shadow-[0_20px_38px_rgba(31,28,26,0.22)] motion-reduce:hover:translate-y-0'
        >
          {copy.startTest}
          <Chevron direction='right' />
        </Link>

        {/*
          Links to the three sibling types.

          Without these, every type page is a leaf: the only way between them is back
          through the landing page, so crawl depth is 2 for all sixteen and link equity
          pools at the index instead of spreading. Siblings rather than all fifteen others
          because a same-group link is a genuinely useful next click for a reader, and a
          block of fifteen reads as a footer dump to both people and crawlers.
        */}
        <nav className='mt-14 border-t border-pp-line pt-8' aria-labelledby='related-heading'>
          <h2
            id='related-heading'
            className='font-display text-sm font-semibold uppercase tracking-[0.18em] text-pp-text'
          >
            {copy.relatedTypes}
          </h2>
          <ul className='mt-4 grid gap-3 sm:grid-cols-3'>
            {siblings.map(sibling => {
              const siblingContent = getTypeContent(lang, sibling)
              return (
                <li key={sibling}>
                  <Link href={`/${lang}/mbti/${slugFromType(sibling)}`} className='block h-full no-underline'>
                    <EditorialPanel
                      variant='default'
                      className='h-full p-4 motion-safe:transition-transform motion-safe:duration-300 motion-safe:hover:-translate-y-0.5'
                    >
                      <p className={`font-display text-base font-semibold tracking-tight ${accent.text}`}>
                        {sibling}
                      </p>
                      <p className='mt-1 text-sm leading-snug text-pp-muted'>
                        {siblingContent.nickname}
                      </p>
                    </EditorialPanel>
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>
      </SectionFrame>
    </main>
  )
}
