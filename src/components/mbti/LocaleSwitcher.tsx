'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { LOCALE_LABELS, LOCALES, swapLocale, type Locale } from '@/lib/i18n'

const cx = (...parts: (string | undefined | false)[]) => parts.filter(Boolean).join(' ')

/** Short label for the toggle; the full name goes in the tooltip and to screen readers. */
const SHORT_LABELS: Record<Locale, string> = {
  vi: 'VI',
  en: 'EN',
}

/**
 * Language toggle for the MBTI header.
 *
 * Real `<Link>`s rather than a `<select>` + router push: with exactly two locales the
 * alternatives fit on screen, each one is a crawlable URL that matches the `hreflang`
 * pairs the pages already declare, and it keeps working with JS disabled. `usePathname` is
 * the only reason this is a Client Component - it needs the current URL to build the
 * counterpart.
 */
export default function LocaleSwitcher({ current }: { current: Locale }) {
  const pathname = usePathname()

  return (
    <div
      className='inline-flex items-center gap-0.5 rounded-full border border-pp-line bg-white/70 p-0.5 shadow-[0_8px_18px_rgba(46,35,28,0.05)] backdrop-blur-md'
      role='group'
      aria-label='Language'
    >
      {LOCALES.map(locale => {
        const active = locale === current
        return (
          <Link
            key={locale}
            href={swapLocale(pathname, locale)}
            hrefLang={locale}
            title={LOCALE_LABELS[locale]}
            // Tells assistive tech which of the two is the page you are on, which a pair
            // of plain links otherwise leaves ambiguous.
            aria-current={active ? 'true' : undefined}
            className={cx(
              'rounded-full px-3 py-1.5 font-display text-[11px] font-semibold uppercase tracking-[0.16em] no-underline transition',
              active
                ? 'bg-pp-text text-[var(--pp-bg)] shadow-[0_6px_14px_rgba(31,28,26,0.18)]'
                : 'text-pp-muted hover:bg-white hover:text-pp-text',
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
