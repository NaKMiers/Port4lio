import TestChrome from '@/components/test-kit/TestChrome'
import type { Locale } from '@/lib/i18n'
import { iqUi } from '@/lib/iq/content'
import { UI } from '@/lib/mbti/content'
import { testNav, type TestProduct } from '@/lib/test-kit/nav'

/**
 * `TestChrome` with one product's links and copy already filled in.
 *
 * ```
 *   [lang]/mbti/layout.tsx ─┐
 *                           ├─▶ TestProductShell ─▶ TestChrome
 *   [lang]/iq/layout.tsx  ──┘
 * ```
 *
 * ## Why this exists
 *
 * The two product layouts were byte-identical apart from four values: the brand label, the
 * privacy href, the privacy label, and which nav item is current. Two copies of the same
 * twenty lines is how one of them silently stops matching the other - and the failure would
 * be a header on a live page, not a broken build.
 *
 * `TestChrome` deliberately stays dumb: it takes links and labels and knows nothing about
 * products. This module is the one place that maps a product key onto them, so adding a
 * third test means one entry here and one four-line layout file.
 *
 * The copy lookups differ in shape because the two content modules do - `UI` is a record,
 * `iqUi` is a function - so they are wrapped rather than unified. Rewriting one of them to
 * match the other would be a larger change than the duplication it removes.
 */

const PRODUCT_COPY: Record<TestProduct, (locale: Locale) => { brand: string; privacy: string }> = {
  mbti: locale => ({ brand: UI[locale].brand, privacy: UI[locale].privacy }),
  iq: locale => ({ brand: iqUi(locale).brand, privacy: iqUi(locale).privacyLink }),
}

export default function TestProductShell({
  locale,
  product,
  children,
}: {
  locale: Locale
  product: TestProduct
  children: React.ReactNode
}) {
  const copy = PRODUCT_COPY[product](locale)

  return (
    <TestChrome
      locale={locale}
      brand={copy.brand}
      // Derived rather than passed: every test has a privacy notice at the same place under
      // its own segment, and a hand-written href is a thing that can point at the other
      // product's notice without anyone noticing.
      privacyHref={`/${locale}/${product}/privacy`}
      privacyLabel={copy.privacy}
      nav={testNav(locale)}
      activeProduct={product}
    >
      {children}
    </TestChrome>
  )
}
