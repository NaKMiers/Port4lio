import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import TestChrome from '@/components/test-kit/TestChrome'

/**
 * MANDATORY REGRESSION: adding `footerSlot` to `TestChrome` changed nothing else.
 *
 * `TestChrome` wraps 12 page types across 2 locales - both landings, 16 MBTI type pages,
 * both questionnaires, both result pages, both privacy notices, `iq/method`, `certificate`
 * and `verify` - every one of them serving real traffic. So "an optional prop cannot have
 * changed the output when it is not passed" needs to be a measurement rather than an
 * expectation, because the blast radius of being wrong is the entire test product.
 *
 * ## Why this does not need jsdom, and why it does need one mock
 *
 * No DOM: `renderToStaticMarkup` under `environment: 'node'` produces the markup string
 * directly, which is the thing under test. No testing-library either - there is nothing to
 * query, only bytes to compare.
 *
 * But `TestChrome` is not a pure server tree, which the plan for this work assumed it was.
 * It renders `LocaleSwitcher`, a client component that calls `usePathname()`, and outside a
 * Next router context that hook returns `null` - so `swapLocale(null, ...)` throws
 * `Cannot read properties of null (reading 'split')` and the render dies before producing a
 * byte. Mocking the hook is supplying the router context the component legitimately
 * requires, not working around a broken test; the pathname value is arbitrary because
 * nothing here asserts on the switcher's hrefs.
 */

vi.mock('next/navigation', () => ({
  usePathname: () => '/vi/mbti',
  notFound: () => {
    throw new Error('notFound() called')
  },
}))

const PROPS = {
  locale: 'vi' as const,
  brand: 'MBTI',
  privacyHref: '/vi/mbti/privacy',
  privacyLabel: 'Quyền riêng tư',
  nav: [
    { key: 'mbti', label: 'MBTI', href: '/vi/mbti' },
    { key: 'iq', label: 'IQ', href: '/vi/iq' },
  ],
  activeProduct: 'mbti',
}

const CHILDREN = <main id='page-content'>content</main>

function render(extra: { footerSlot?: React.ReactNode } = {}) {
  return renderToStaticMarkup(
    <TestChrome {...PROPS} {...extra}>
      {CHILDREN}
    </TestChrome>
  )
}

describe('TestChrome footerSlot', () => {
  it('renders byte-identically when the prop is omitted entirely', () => {
    // The two ways a caller can decline: not passing it, and passing `undefined`. The
    // second is what the `(plain)` layouts effectively do by forwarding an absent prop
    // through `TestProductShell`, so they must not diverge.
    expect(render({ footerSlot: undefined })).toBe(render())
  })

  it('leaves no trace of the slot in the markup when it is absent', () => {
    const html = render()

    // The footer opening tag must follow the content wrapper's closing tag immediately,
    // with nothing between them. This is the assertion that fails if somebody gives the
    // prop a default, or wraps `{footerSlot}` in a `<div>` "for spacing" - both of which
    // would render for every page whether it asked or not.
    expect(html).toContain('</div><footer')
  })

  it('inserts exactly the slot content, in exactly one place, and alters nothing else', () => {
    const slot = <aside id='slot-probe'>PITCH</aside>
    const slotHtml = renderToStaticMarkup(slot)

    const without = render()
    const withSlot = render({ footerSlot: slot })

    // A single footer, so the splice point below is unambiguous.
    expect(without.match(/<footer/g)).toHaveLength(1)

    /**
     * The strong form of the regression, and the reason this file is not a smoke test.
     *
     * It does not merely check that the slot appears somewhere - it reconstructs the
     * expected output by splicing the slot's own markup in at the footer boundary and
     * demands an exact match. So it fails if the slot is wrapped, if it lands anywhere
     * else, if it renders twice, or if passing it changes one byte of the surrounding
     * shell. And because it is expressed as a transformation of the no-slot render rather
     * than a frozen string, a legitimate change to the header or footer markup does not
     * make it fail spuriously.
     */
    expect(withSlot).toBe(without.replace('<footer', `${slotHtml}<footer`))
  })

  it('still renders the shell it is responsible for', () => {
    // Guards the guard: if `render()` silently produced an empty string, every assertion
    // above would pass on `''`. These are the parts callers depend on existing.
    const html = render()

    expect(html).toContain('portfolio-public-root')
    expect(html).toContain('id="page-content"')
    expect(html).toContain('/vi/mbti/privacy')
    expect(html).toContain('lang="vi"')
  })
})
