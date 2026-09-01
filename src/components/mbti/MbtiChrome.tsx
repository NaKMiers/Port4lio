import Link from 'next/link'

import LocaleSwitcher from '@/components/mbti/LocaleSwitcher'
import PortfolioBackdropOrnaments from '@/components/portfolio/PortfolioBackdropOrnaments'
import type { Locale } from '@/lib/i18n'
import { UI } from '@/lib/mbti/content'

/**
 * The MBTI shell.
 *
 * `portfolio-public-root` is the whole point of this component. That class is where every
 * editorial token lives (`--pp-bg`, `--pp-text`, the paper background, the `p` colour
 * rules), and the Tailwind `pp-*` utilities resolve to those variables - so a page outside
 * this wrapper renders `bg-pp-panel` as nothing at all. MBTI is a section of the
 * portfolio, not a separate site, so it hangs off the same root the one-pager does rather
 * than re-declaring a parallel palette that would drift the first time a token changes.
 *
 * ```
 *   .portfolio-public-root          ← tokens + paper background
 *     ├── PortfolioBackdropOrnaments  (shared, decorative, lg+ only)
 *     ├── header  [brand]              [portfolio] [VI|EN]
 *     ├── {children}
 *     └── footer  [privacy] [portfolio]
 * ```
 *
 * The header is sticky rather than static: the test is 60 questions of scrolling, and a
 * language toggle that scrolls away is one someone has to hunt for mid-test.
 */
export default function MbtiChrome({
  locale,
  children,
}: {
  locale: Locale
  children: React.ReactNode
}) {
  const copy = UI[locale]

  return (
    <div lang={locale} className='portfolio-public-root relative min-h-screen'>
      <PortfolioBackdropOrnaments />

      <header className='sticky top-0 z-30 border-b border-pp-line bg-[var(--pp-bg)]/80 backdrop-blur-md'>
        <div className='mx-auto flex w-full max-w-editorial items-center justify-between gap-4 px-gutter py-3.5'>
          <Link
            href={`/${locale}/mbti`}
            className='group inline-flex items-center gap-2.5 no-underline'
            aria-label={copy.brand}
          >
            <span
              className='h-2.5 w-2.5 rounded-full bg-[linear-gradient(135deg,var(--pp-violet),var(--pp-blue))] shadow-[0_0_0_7px_rgba(123,109,255,0.12)] transition-transform motion-safe:group-hover:scale-110'
              aria-hidden
            />
            <span className='font-display text-sm font-semibold uppercase tracking-[0.2em] text-pp-text'>
              {copy.brand}
            </span>
          </Link>

          {/*
            No link back to the portfolio, in either the header or the footer. This is a
            standalone product for strangers on the internet, not a portfolio sub-page, and
            a "Portfolio" breadcrumb frames it as one person's side project to an audience
            that has no idea who that person is.
          */}
          <LocaleSwitcher current={locale} />
        </div>
      </header>

      {children}

      <footer className='border-t border-pp-line'>
        <div className='mx-auto flex w-full max-w-editorial items-center justify-center px-gutter py-8 text-sm'>
          <Link
            href={`/${locale}/mbti/privacy`}
            className='font-semibold text-pp-text underline decoration-pp-blue/50 underline-offset-[0.2em] hover:decoration-pp-blue'
          >
            {copy.privacy}
          </Link>
        </div>
      </footer>
    </div>
  )
}
