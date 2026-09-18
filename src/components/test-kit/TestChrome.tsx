import Link from 'next/link'

import LocaleSwitcher from '@/components/mbti/LocaleSwitcher'
import PortfolioBackdropOrnaments from '@/components/portfolio/PortfolioBackdropOrnaments'
import type { Locale } from '@/lib/i18n'

/**
 * The shell shared by every test on this site.
 *
 * ```
 *   .portfolio-public-root          ← tokens + paper background, flex column, min-h-screen
 *     ├── PortfolioBackdropOrnaments  (shared, decorative, out of flow)
 *     ├── header  [• brand]                        [VI|EN]
 *     ├── div.grow      {children}    ← eats the leftover height
 *     ├── {footerSlot}                ← OPTIONAL. Omitted entirely when undefined.
 *     └── footer            [privacy]
 * ```
 *
 * ## Why the footer sits at the bottom without being fixed or sticky
 *
 * The root is a `min-h-screen` flex column and the `{children}` wrapper is the only item
 * that grows, so on a short page it absorbs every leftover pixel and the footer lands on
 * the bottom edge. On a long page the wrapper is already taller than the viewport, nothing
 * is left to absorb, and the footer sits after the content as normal.
 *
 * This is deliberately not `fixed` or `sticky`. Either one would take the footer out of the
 * document's height, so it would overlap the end of a long page - and on the questionnaire
 * that means a bar permanently covering the last answer button. Growing a flex item costs
 * nothing at runtime and cannot overlap anything.
 *
 * `grow` and not `flex-1`: `flex-1` also sets `flex-basis: 0`, which asks the wrapper to
 * start from zero height and grow. That works here only because a flex item's `min-height`
 * defaults to `auto`, and it is one `overflow` change away from clipping long content.
 * `flex-grow: 1` alone keeps the basis at `auto`, so the wrapper is never shorter than what
 * is inside it.
 *
 * `portfolio-public-root` is the whole point: that class is where every editorial token
 * lives (`--pp-bg`, `--pp-text`, the paper background), and the Tailwind `pp-*` utilities
 * resolve to those variables - so a page outside this wrapper renders `bg-pp-panel` as
 * nothing at all. The tests inherit the portfolio's theme instead of owning a second one
 * that would drift the first time a token changed.
 *
 * ## Why this is parameterised, and `MbtiChrome` was not
 *
 * `MbtiChrome` imported MBTI copy directly and hardcoded both hrefs. Invisible while MBTI
 * was the only product; a blocker the moment a second arrived, because
 * `(choice)/[lang]/layout.tsx` wrapped EVERY child in it - so IQ pages would have rendered
 * with a header linking to `/mbti` and a footer pointing at the MBTI privacy notice.
 * Passing links and labels in is what lets one shell serve both.
 *
 * ## Product nav, but still no portfolio link
 *
 * The two tests DO link to each other. That is the opposite call from the portfolio link,
 * and for a specific reason: someone who just finished one test is the most likely person
 * on the internet to take the other, so a two-item nav is the cheapest cross-product loop
 * available. A "Portfolio" breadcrumb has no such payoff - it frames a standalone product
 * as one person's side project to an audience with no idea who that person is, which is
 * why `MbtiChrome` deliberately omitted it and why this still does.
 *
 * `aria-current` marks the active product, so the nav is not just two links that look the
 * same to a screen reader.
 *
 * The header is sticky: both tests are long, and a language toggle that scrolls away is one
 * someone has to hunt for mid-test.
 *
 * ## `footerSlot`: why it is opt-in, and never a default
 *
 * It exists to carry `AvailabilityBlock` - a "here is who built this and he is open to
 * work" panel - above the privacy footer. It is optional, and the default must stay
 * "nothing", for one reason that is not about taste:
 *
 * ```
 *   /vi/mbti           ✓ block     someone browsing
 *   /vi/mbti/enfj      ✓ block     someone reading a result they can link to
 *   /vi/mbti/result/x  ✓ block     someone who just finished
 *   /vi/mbti/test      ✗ NOTHING   someone 30 questions into a questionnaire
 *   /vi/iq/test        ✗ NOTHING   someone on a 24-minute clock
 * ```
 *
 * Interrupting a questionnaire with a hire-me pitch is the specific failure this placement
 * exists to prevent. A visitor mid-test has not agreed to hear anything, the IQ test is
 * timed, and the block's own call to action navigates *away from the site* - so on the test
 * page it is not merely noise, it is an exit next to the answer buttons.
 *
 * A default would put it there. Every page that wants it says so, and the two that must not
 * have it get it by *not asking* rather than by remembering to suppress it - which is the
 * whole difference, because suppression is the thing a new page silently forgets.
 *
 * The opt-in is expressed in the route tree rather than in the pages, because a page cannot
 * pass a prop to its own layout and this shell is rendered by one. Each product is split
 * into `(pitch)` and `(plain)` route groups, each with its own layout, and the group a page
 * lives in IS the decision - see `(choice)/[lang]/mbti/(pitch)/layout.tsx`. Route groups add
 * no path segment, so no URL changed when this landed.
 *
 * `tests/unit/test-chrome-footer-slot.test.tsx` asserts the rendered markup is
 * byte-identical when the prop is undefined. This shell wraps 12 page types across 2
 * locales, all of them serving real traffic, so "adding an optional prop changed nothing"
 * needs to be a measurement rather than an expectation.
 */
export default function TestChrome({
  locale,
  brand,
  privacyHref,
  privacyLabel,
  nav,
  activeProduct,
  footerSlot,
  children,
}: {
  locale: Locale
  /** Only used as the nav's accessible name now that the nav carries the branding. */
  brand: string
  privacyHref: string
  privacyLabel: string
  /** The sibling tests, in display order. */
  nav: { key: string; label: string; href: string }[]
  activeProduct: string
  /**
   * Rendered between the content and the privacy footer, when given. Read the header
   * section above before making this default to anything.
   */
  footerSlot?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div lang={locale} className='portfolio-public-root relative flex min-h-screen flex-col'>
      <PortfolioBackdropOrnaments />

      <header className='sticky top-0 z-30 border-b border-pp-line bg-[var(--pp-bg)]/80 backdrop-blur-md'>
        <div className='mx-auto flex w-full max-w-editorial items-center justify-between gap-4 px-gutter py-3.5'>
          {/*
            The nav IS the branding. There is no separate wordmark, because with two
            products a lone brand label plus a nav that repeats it says the same thing
            twice and pushes the switch to the far edge of a wide screen.
            ```
              ● MBTI   ○ IQ                                        [VI | EN]
              ▲active   ▲muted
            ```
            The active item keeps the gradient dot the brand used to own; the inactive one
            gets a hollow ring. Weight and colour do the rest. A filled dark pill read as a
            button - something that submits - on a page whose real buttons are answers.
          */}
          <nav aria-label={brand}>
            <ul className='flex items-center gap-5 sm:gap-7'>
              {nav.map(item => {
                const active = item.key === activeProduct
                return (
                  <li key={item.key}>
                    <Link
                      href={item.href}
                      aria-current={active ? 'page' : undefined}
                      className='group inline-flex items-center gap-2.5 no-underline'
                    >
                      <span
                        aria-hidden
                        className={
                          active
                            ? 'h-2.5 w-2.5 rounded-full bg-[linear-gradient(135deg,var(--pp-violet),var(--pp-blue))] shadow-[0_0_0_7px_rgba(123,109,255,0.12)] transition-transform motion-safe:group-hover:scale-110'
                            : 'h-2.5 w-2.5 rounded-full border border-[rgba(31,28,26,0.28)] transition-colors group-hover:border-[rgba(31,28,26,0.55)]'
                        }
                      />
                      <span
                        className={`font-display text-sm font-semibold uppercase tracking-[0.2em] transition-colors ${
                          active ? 'text-pp-text' : 'text-pp-muted group-hover:text-pp-text'
                        }`}
                      >
                        {item.label}
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </nav>

          <LocaleSwitcher current={locale} />
        </div>
      </header>

      <div className='grow'>{children}</div>

      {/*
        Outside `.grow`, so it sits at the true bottom of a short page rather than being
        pushed down by the growing wrapper - and above the privacy footer, so the last thing
        on the page is still the privacy link and not a pitch.

        Bare `{footerSlot}`: `undefined` renders as nothing at all, with no marker and no
        wrapper element, which is what makes the byte-identical assertion hold. Wrapping
        this in a `<div>` "for spacing" would break that, and the slot's own content carries
        its border and padding for exactly that reason.
      */}
      {footerSlot}

      <footer className='border-t border-pp-line'>
        <div className='mx-auto flex w-full max-w-editorial items-center justify-center px-gutter py-8 text-sm'>
          <Link
            href={privacyHref}
            className='font-semibold text-pp-text underline decoration-pp-blue/50 underline-offset-[0.2em] hover:decoration-pp-blue'
          >
            {privacyLabel}
          </Link>
        </div>
      </footer>
    </div>
  )
}
