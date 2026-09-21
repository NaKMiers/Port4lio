import { notFound } from 'next/navigation'

import AvailabilityBlock from '@/components/blog/AvailabilityBlock'
import TestProductShell from '@/components/test-kit/TestProductShell'
import { isLocale, LOCALES } from '@/lib/i18n'

/**
 * IQ's shell, for the pages allowed to pitch: the landing page and the result.
 *
 * See `mbti/(pitch)/layout.tsx` - the two differ only in the product key. The split into
 * `(pitch)` and `(plain)` is explained there in full, along with why `opengraph-image.tsx`
 * had to move into this group rather than stay at `iq/`, and what the `footerSlot` is for is
 * explained in `TestChrome`'s header.
 *
 * IQ's `(plain)` group is the larger of the two: `test`, `privacy`, `method`, `certificate`
 * and `verify`. The last three are worth naming, because none of them is a questionnaire and
 * all three are still the wrong place. `method` is the page that argues the test is honest,
 * and a hire-me panel underneath an honesty argument undercuts it; `certificate` and
 * `verify` are shown to a *third party* checking somebody else's result, who did not come
 * here to meet the author.
 */

export function generateStaticParams() {
  return LOCALES.map(lang => ({ lang }))
}

export default async function IqPitchLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ lang: string }>
}) {
  const { lang } = await params
  if (!isLocale(lang)) notFound()

  return (
    <TestProductShell
      locale={lang}
      product="iq"
      footerSlot={<AvailabilityBlock locale={lang} />}
    >
      {children}
    </TestProductShell>
  )
}
