import { notFound } from 'next/navigation'

import { isLocale, LOCALES } from '@/lib/i18n'

/**
 * The `(choice)` locale gate. Validation only - no presentation.
 *
 * ```
 *   (choice)/[lang]/layout.tsx        ← this file: is `lang` a real locale?
 *     ├── mbti/layout.tsx             ← TestProductShell, product='mbti'
 *     │     └── page, test, [type]... → /vi/mbti, /vi/mbti/enfj, ...
 *     └── iq/layout.tsx               ← TestProductShell, product='iq'
 *           └── page, test, result... → /vi/iq, /vi/iq/test, ...
 * ```
 *
 * ## Why the chrome is one level down and not here
 *
 * This layout used to render `<MbtiChrome>` around every child. Fine while MBTI was the
 * only product, wrong the instant a second one appeared: a layout at `[lang]` cannot know
 * WHICH product is rendering, so IQ pages would have shipped with a header linking to
 * `/mbti` and a footer pointing at the MBTI privacy notice.
 *
 * The product segment is the first place that knowledge exists, so the shell lives there.
 * Note that this is not a duplication that can be collapsed upward: recovering the product
 * from inside this file would mean reading the request path, which makes the layout dynamic
 * and costs 30-odd prerendered pages their static rendering to save eight lines.
 *
 * The two product layouts are near-identical and are meant to stay that way - both defer to
 * `TestProductShell`, which owns everything that actually differs.
 *
 * `[lang]` is a dynamic segment, so any first path segment reaches here. Validating against
 * the allowlist and 404-ing otherwise is what stops `/garbage/mbti` rendering the product
 * under a nonsense language.
 *
 * `lang` on `<html>` is set by `TestChrome` under each product rather than here, because
 * only the root layout can render `<html>` and it has no way to know which product is
 * active without becoming dynamic - which would cost the portfolio its static rendering.
 */

export function generateStaticParams() {
  return LOCALES.map(lang => ({ lang }))
}

export default async function ChoiceLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ lang: string }>
}) {
  const { lang } = await params

  if (!isLocale(lang)) {
    notFound()
  }

  return children
}
