import { notFound } from 'next/navigation'

import AvailabilityBlock from '@/components/blog/AvailabilityBlock'
import TestProductShell from '@/components/test-kit/TestProductShell'
import { isLocale, LOCALES } from '@/lib/i18n'

/**
 * MBTI's shell, for the pages allowed to pitch.
 *
 * ```
 *   mbti/(pitch)/          ← this layout: shell + AvailabilityBlock
 *     ├── page.tsx              /vi/mbti
 *     ├── opengraph-image.tsx   ← must sit HERE, not at mbti/. See below.
 *     ├── [type]/               /vi/mbti/enfj  (×16, ×2 locales)
 *     │     └── opengraph-image.tsx
 *     └── result/[id]/          /vi/mbti/result/<token>
 *
 *   mbti/(plain)/          ← the sibling layout: shell, nothing else
 *     ├── test/                 /vi/mbti/test      ← must never pitch
 *     └── privacy/              /vi/mbti/privacy
 * ```
 *
 * ## Why this is a route group and not a prop on a page
 *
 * `footerSlot` is opt-in per page, and the shell that takes it is rendered by a layout. A
 * page cannot pass props to its own layout, so the only ways to decide per page are to read
 * the request path - which makes the layout dynamic and costs every one of the 30-odd pages
 * below its static rendering - or to express the decision in the route tree. This is the
 * second.
 *
 * Route groups add no path segment, so `(pitch)` and `(plain)` are invisible in every URL:
 * all 60 visitor-facing route lines in `next build` are unchanged by this split, and the
 * only three that moved are the generated `opengraph-image-<hash>` ones described below.
 * What the groups buy is that a page's *location* is its answer. There is no page that
 * forgot to opt out, because opting out is not an action - it is where the file lives.
 *
 * ## `opengraph-image.tsx` moved with the page, and had to
 *
 * Measured, because the failure is silent. Next associates a metadata image with the page in
 * the *same segment directory*, so leaving `opengraph-image.tsx` at `mbti/` while the page
 * moved to `mbti/(pitch)/` dropped `og:image` from the rendered `<head>` entirely - no
 * warning, no build error, and the image route itself still built and still served. Every
 * shared link would have lost its preview card, on a product whose growth loop is people
 * sending each other links.
 *
 * Keeping it at `mbti/` was attempted for a reason: Next derives the `-<hash>` suffix in
 * `/vi/mbti/opengraph-image-<hash>` from the file's path, so moving the file changes that
 * URL. The trade was measured in both directions and is not close - a stale suffix means
 * platforms that cached the *old* URL re-scrape and get the new one, while a missing
 * `og:image` means there is nothing to scrape at all.
 *
 * The three routes here are the ones where a visitor is reading rather than working:
 * browsing the landing page, reading a type description someone linked them, or looking at
 * a result they just earned. `/mbti/test` is the one page on this product where a visitor is
 * 30 questions into something, and `TestChrome`'s header explains at length why a hire-me
 * panel must not appear there.
 *
 * ## Two layouts instead of one, and why `mbti/layout.tsx` is gone
 *
 * It held only the locale re-validation below, which each group now does for itself. Keeping
 * it as a third, chrome-less layout above these two would mean three files to read to learn
 * what wraps a page, to save one duplicated `isLocale` call.
 *
 * The locale is re-validated rather than trusted: `isLocale` narrows `string` to `Locale`
 * for the shell below, and the parent's check at `[lang]` is not visible to the type system
 * here.
 */

export function generateStaticParams() {
  return LOCALES.map(lang => ({ lang }))
}

export default async function MbtiPitchLayout({
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
      product="mbti"
      footerSlot={<AvailabilityBlock locale={lang} />}
    >
      {children}
    </TestProductShell>
  )
}
