import { notFound } from 'next/navigation'

import MbtiChrome from '@/components/mbti/MbtiChrome'
import { isLocale, LOCALES } from '@/lib/i18n'

/**
 * The `(choice)` shell.
 *
 * `lang` is set by `MbtiChrome` rather than on `<html>` because only the root layout can
 * render `<html>`, and the root layout has no way to know which route group is rendering
 * without becoming dynamic - which would cost the portfolio its static rendering. `lang`
 * is a global HTML attribute and a subtree may legitimately declare a different language
 * from the document, so screen readers and search engines both read this correctly. The
 * per-page `alternates` metadata carries the `hreflang` pairs.
 *
 * `[lang]` is a dynamic segment, so any first path segment reaches here. Validating
 * against the locale allowlist and 404-ing otherwise is what stops `/garbage/mbti` from
 * rendering the product under a nonsense language.
 *
 * Presentation lives in `MbtiChrome`, which puts this subtree inside
 * `.portfolio-public-root` - the same editorial surface `(me)` uses. MBTI is a section of
 * the portfolio, so it inherits that theme instead of owning a second one.
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

  return <MbtiChrome locale={lang}>{children}</MbtiChrome>
}
