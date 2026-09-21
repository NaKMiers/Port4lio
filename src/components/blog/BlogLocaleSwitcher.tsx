'use client'

import { useBlogLocale } from '@/components/blog/BlogLocaleProvider'
import { LOCALE_LABELS, LOCALES } from '@/lib/i18n'

const cx = (...parts: (string | undefined | false)[]) =>
  parts.filter(Boolean).join(' ')

const SHORT_LABELS: Record<string, string> = { vi: 'VI', en: 'EN' }

/**
 * The blog's VI/EN toggle. Visually identical to MBTI's `LocaleSwitcher`, structurally not.
 *
 * That one renders two `<Link>`s, because its locales are two real URLs. This renders two
 * `<button>`s, because the blog's locale is a stored preference and there is no second URL to
 * point at - see `BlogLocaleProvider` for why. Rendering links that went nowhere, or that
 * pointed at a `?lang=` the page does not read, would be worse than looking slightly
 * different from its sibling.
 *
 * `aria-pressed` rather than `aria-current`: these are controls that change a setting, not
 * navigation showing where you are.
 */
export default function BlogLocaleSwitcher() {
  const { locale, setLocale } = useBlogLocale()

  return (
    <div
      className="inline-flex items-center gap-0.5 rounded-full border border-pp-line bg-white/70 p-0.5 shadow-[0_8px_18px_rgba(46,35,28,0.05)] backdrop-blur-md"
      role="group"
      aria-label="Language"
    >
      {LOCALES.map(option => {
        const active = option === locale
        return (
          <button
            key={option}
            type="button"
            onClick={() => setLocale(option)}
            aria-pressed={active}
            title={LOCALE_LABELS[option]}
            className={cx(
              'rounded-full px-3 py-1.5 font-display text-[11px] font-semibold uppercase tracking-[0.16em] transition',
              active
                ? 'bg-pp-text text-[var(--pp-bg)] shadow-[0_6px_14px_rgba(31,28,26,0.18)]'
                : 'text-pp-muted hover:bg-white hover:text-pp-text'
            )}
          >
            {SHORT_LABELS[option]}
            <span className="sr-only"> - {LOCALE_LABELS[option]}</span>
          </button>
        )
      })}
    </div>
  )
}
