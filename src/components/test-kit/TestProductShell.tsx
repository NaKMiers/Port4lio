import TestChrome from '@/components/test-kit/TestChrome'
import type { Locale } from '@/lib/i18n'
import { iqUi } from '@/lib/iq/content'
import { UI } from '@/lib/mbti/content'
import { testNav, type TestProduct } from '@/lib/test-kit/nav'

/**
 * `TestChrome` with one product's links and copy already filled in.
 *
 * ```
 *   [lang]/mbti/(pitch)/layout.tsx ─┐  footerSlot={<AvailabilityBlock/>}
 *   [lang]/mbti/(plain)/layout.tsx ─┤  no footerSlot
 *                                   ├─▶ TestProductShell ─▶ TestChrome
 *   [lang]/iq/(pitch)/layout.tsx  ──┤  footerSlot={<AvailabilityBlock/>}
 *   [lang]/iq/(plain)/layout.tsx  ──┘  no footerSlot
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
 *
 * ## Why there are four layouts above and not two
 *
 * `footerSlot` is opt-in per page and this shell is rendered by a layout, so the decision
 * has to live somewhere a layout can see it. A page cannot pass props upward, and deriving
 * it from the request path would make the layout dynamic - which costs 30-odd prerendered
 * pages their static rendering, the same trade `(choice)/[lang]/layout.tsx` already refused
 * once for the product key.
 *
 * So each product is partitioned into two route groups whose only difference is this one
 * prop. Route groups add no path segment, so the URLs are unchanged, and a page's group
 * membership IS its answer - there is no third state where a page neither opts in nor out.
 * `TestChrome`'s header explains what the two groups mean.
 */

const PRODUCT_COPY: Record<
  TestProduct,
  (locale: Locale) => { brand: string; privacy: string }
> = {
  mbti: locale => ({ brand: UI[locale].brand, privacy: UI[locale].privacy }),
  iq: locale => ({
    brand: iqUi(locale).brand,
    privacy: iqUi(locale).privacyLink,
  }),
}

export default function TestProductShell({
  locale,
  product,
  footerSlot,
  children,
}: {
  locale: Locale
  product: TestProduct
  /** Passed straight through. See `TestChrome` for why it must stay opt-in. */
  footerSlot?: React.ReactNode
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
      footerSlot={footerSlot}
    >
      {children}
    </TestChrome>
  )
}
