import Link from 'next/link'

import { cx } from '@/components/ccaf/ccaf-ui'
import { t, UI } from '@/lib/ccaf/copy'
import { LOCALE_LABELS, LOCALES, type Locale } from '@/lib/i18n'

/**
 * The language toggle, top right of the page.
 *
 * ## Why two links and not a client-side toggle
 *
 * `lib/i18n.ts` states the rule for this codebase plainly: the locale goes in the URL. The
 * usual reason - a link that renders a different language depending on who opens it is a
 * link nobody can reason about - stopped applying when this page went behind the owner
 * gate, since there is nobody to send it to. What survives is the smaller version of the
 * same property: the URL says which language you are looking at, so a bookmark and a
 * reload keep their answer.
 *
 * ## Why the hrefs are a lookup and not `swapLocale`
 *
 * `swapLocale` rewrites `/vi/thing` into `/en/thing`, which is the shape every other
 * localized route here uses. These two are `/admin/ccaf` and `/admin/ccaf/en` instead: that
 * shape was inherited from the page's public life, when `/ccaf` was already in the sitemap
 * and had already been handed out. D6 later moved the pair under `/admin`, which changed the
 * prefix and not the shape, so the two entries in this map stay.
 */

const HREF: Record<Locale, string> = {
  vi: '/admin/ccaf',
  en: '/admin/ccaf/en',
}

/** Short label for the toggle; the full name goes to screen readers and the tooltip. */
const SHORT_LABELS: Record<Locale, string> = {
  vi: 'VI',
  en: 'EN',
}

export default function CcafLocaleSwitcher({ current }: { current: Locale }) {
  return (
    <div
      className='inline-flex items-center gap-0.5 rounded-full border border-pp-line bg-white/70 p-0.5 shadow-[0_8px_18px_rgba(46,35,28,0.05)] backdrop-blur-md'
      role='group'
      aria-label={t(UI.languageGroup, current)}
    >
      {LOCALES.map(locale => {
        const active = locale === current
        return (
          <Link
            key={locale}
            href={HREF[locale]}
            hrefLang={locale}
            title={LOCALE_LABELS[locale]}
            // Tells assistive tech which of the two is the page you are on, which a pair
            // of plain links otherwise leaves ambiguous.
            aria-current={active ? 'true' : undefined}
            className={cx(
              'rounded-full px-3 py-1.5 font-display text-[11px] font-semibold uppercase tracking-[0.16em] no-underline transition',
              active
                ? 'bg-pp-text text-[var(--pp-bg)] shadow-[0_6px_14px_rgba(31,28,26,0.18)]'
                : 'text-pp-muted hover:bg-white hover:text-pp-text'
            )}
          >
            {SHORT_LABELS[locale]}
            <span className='sr-only'> - {LOCALE_LABELS[locale]}</span>
          </Link>
        )
      })}
    </div>
  )
}
