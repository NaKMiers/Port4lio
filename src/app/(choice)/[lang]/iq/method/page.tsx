import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { EditorialPanel } from '@/components/portfolio/primitives/EditorialPanel'
import { SectionFrame } from '@/components/portfolio/primitives/SectionFrame'
import { isLocale, LOCALES } from '@/lib/i18n'
import JsonLd from '@/components/JsonLd'
import { bandTableRows, IQ_METHOD, iqUi } from '@/lib/iq/content'
import { alternateIqLanguages, iqBreadcrumbJsonLd, iqMethodJsonLd } from '@/lib/iq/seo'

/**
 * How scoring works.
 *
 * This page is the product's honesty commitment made checkable. The category's conversion
 * lever is score inflation - sites skew the curve because a flattered visitor shares and
 * pays more readily - and this states in public that we do not, alongside the full band
 * table so the mapping can be verified rather than trusted.
 *
 * Static and indexable, deliberately. It is one of only two IQ pages someone can find
 * without a link, and "how is this scored" is a real search. It is also the page that has
 * to stay true if the scale is ever re-normed.
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
  const copy = IQ_METHOD[lang]
  return {
    title: copy.title,
    description: copy.intro,
    alternates: {
      canonical: `/${lang}/iq/method`,
      languages: alternateIqLanguages(locale => `/${locale}/iq/method`),
    },
  }
}

export default async function IqMethodPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params
  if (!isLocale(lang)) notFound()

  const copy = IQ_METHOD[lang]
  const rows = bandTableRows(lang)
  const isVi = lang === 'vi'

  return (
    <main>
      {/*
        This page had no structured data at all. `WebPage` rather than `FAQPage` - see the
        note on `iqMethodJsonLd` for why the question-shaped headings here do not justify
        the Q&A markup.
      */}
      <JsonLd data={iqMethodJsonLd(lang, copy.title, copy.intro)} />
      <JsonLd
        data={iqBreadcrumbJsonLd(lang, [
          { name: 'Home', path: '/' },
          { name: iqUi(lang).brand, path: `/${lang}/iq` },
          { name: copy.title, path: `/${lang}/iq/method` },
        ])}
      />

      <SectionFrame
        aria-labelledby='method-heading'
        disableReveal
        className='border-b border-pp-line pb-section-sm pt-10 md:pt-14'
        innerClassName='max-w-2xl'
      >
        <h1
          id='method-heading'
          className='font-display text-[clamp(2.2rem,5vw,3.2rem)] font-semibold leading-tight tracking-tight text-pp-text'
        >
          {copy.title}
        </h1>
        <p className='mt-5 text-base leading-relaxed text-pp-muted md:text-lg'>{copy.intro}</p>
      </SectionFrame>

      <SectionFrame className='py-section-sm' innerClassName='max-w-2xl'>
        <div className='space-y-8'>
          {copy.sections.map(section => (
            <section key={section.heading}>
              <h2 className='font-display text-sm font-semibold uppercase tracking-[0.18em] text-pp-text'>
                {section.heading}
              </h2>
              <p className='mt-3 text-pp-muted'>{section.body}</p>
            </section>
          ))}
        </div>

        <EditorialPanel variant='strong' className='mt-10 overflow-x-auto p-6 md:p-7'>
          <table className='w-full min-w-[24rem] border-collapse text-sm'>
            <caption className='pb-4 text-left font-display text-sm font-semibold uppercase tracking-[0.18em] text-pp-text'>
              {isVi ? 'Bảng điểm đầy đủ' : 'The complete band table'}
            </caption>
            <thead>
              <tr className='border-b border-pp-line text-left text-pp-muted'>
                <th scope='col' className='py-2 pr-4 font-normal'>
                  {isVi ? 'Điểm thô' : 'Raw correct'}
                </th>
                <th scope='col' className='py-2 pr-4 font-normal'>
                  {isVi ? 'Điểm' : 'Score'}
                </th>
                <th scope='col' className='py-2 pr-4 font-normal'>
                  {isVi ? 'Phân vị' : 'Percentile'}
                </th>
                <th scope='col' className='py-2 font-normal'>
                  {isVi ? 'Xếp loại' : 'Band'}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.score} className='border-b border-pp-line/60'>
                  <td className='py-2 pr-4 tabular-nums text-pp-text'>{row.raw}+</td>
                  <td className='py-2 pr-4 font-display font-semibold tabular-nums text-pp-text'>
                    {row.score}
                  </td>
                  <td className='py-2 pr-4 tabular-nums text-pp-muted'>{row.percentile}%</td>
                  <td className='py-2 text-pp-muted'>{row.label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </EditorialPanel>
      </SectionFrame>
    </main>
  )
}
