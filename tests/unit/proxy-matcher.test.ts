import { describe, expect, it } from 'vitest'

import { config } from '@/proxy'
import { TEST_PRODUCTS } from '@/lib/test-kit/nav'

/**
 * The locale proxy's matcher, checked against the list of products that actually exist.
 *
 * This is the test for a bug that already shipped: `/mbti` redirected to `/vi/mbti` while a
 * bare `/iq` 404'd, because the matcher was written when MBTI was the only product and
 * nothing connected it to `TEST_PRODUCTS`. Next requires matcher entries to be static
 * literals it can analyse at build time, so the list cannot be generated - which means the
 * only thing that can keep it honest is an assertion.
 *
 * A new product added to `TEST_PRODUCTS` now fails here until its two matcher entries
 * exist, rather than silently 404-ing on its unprefixed URL.
 */
describe('proxy matcher', () => {
  it('covers the bare and nested path of every test product', () => {
    for (const product of TEST_PRODUCTS) {
      expect(config.matcher, `bare /${product}`).toContain(`/${product}`)
      expect(config.matcher, `nested /${product}/*`).toContain(
        `/${product}/:path*`
      )
    }
  })

  it('has exactly two entries per product and nothing else', () => {
    // A stray entry here is how the portfolio would get redirected into a locale that does
    // not exist, which is the failure the allowlist exists to prevent.
    expect(config.matcher).toHaveLength(TEST_PRODUCTS.length * 2)
  })

  it('never matches the portfolio, its assets, or already-localised paths', () => {
    const forbidden = [
      '/',
      '/cv',
      '/api/:path*',
      '/_next/:path*',
      '/vi/:path*',
      '/en/:path*',
    ]
    for (const path of forbidden)
      expect(config.matcher, path).not.toContain(path)
  })
})
