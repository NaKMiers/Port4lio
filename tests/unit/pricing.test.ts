import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { formatPrice, getResultPrice, isPaidMode, PAYOS_MIN_AMOUNT } from '@/lib/mbti/pricing'

/**
 * Whether the site is charging, and how much.
 *
 * Worth pinning tightly because both failure directions are expensive: charging when the
 * gateway is unconfigured strands every visitor behind a paywall they cannot pass, and
 * accidentally reading 0 gives the product away.
 */

// `vi.stubEnv` rather than assigning `process.env.X` directly: @types/node declares
// NODE_ENV readonly, so a direct assignment fails typecheck even though it works at
// runtime. `unstubAllEnvs` also restores the real values, including the ones this repo's
// .env sets, so the suite cannot leak config into other test files.
const PAYOS_KEYS = ['PAYOS_CLIENT_ID', 'PAYOS_API_KEY', 'PAYOS_CHECKSUM_KEY'] as const

function configurePayos() {
  for (const key of PAYOS_KEYS) vi.stubEnv(key, 'configured')
}

beforeEach(() => {
  vi.stubEnv('MBTI_RESULT_PRICE', undefined)
  for (const key of PAYOS_KEYS) vi.stubEnv(key, undefined)
  // Default to production semantics; the dev-throw case overrides this.
  vi.stubEnv('NODE_ENV', 'production')
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('getResultPrice', () => {
  it('treats unset, zero and negative as free', () => {
    expect(getResultPrice()).toBe(0)

    vi.stubEnv('MBTI_RESULT_PRICE', '0')
    expect(getResultPrice()).toBe(0)

    vi.stubEnv('MBTI_RESULT_PRICE', '-5000')
    expect(getResultPrice()).toBe(0)
  })

  it('accepts a price at or above the PayOS floor', () => {
    vi.stubEnv('MBTI_RESULT_PRICE', String(PAYOS_MIN_AMOUNT))
    expect(getResultPrice()).toBe(PAYOS_MIN_AMOUNT)

    vi.stubEnv('MBTI_RESULT_PRICE', '50000')
    expect(getResultPrice()).toBe(50_000)
  })

  it('floors a fractional price', () => {
    // Đồng has no subunit, and PayOS rejects non-integers outright.
    vi.stubEnv('MBTI_RESULT_PRICE', '2999.7')
    expect(getResultPrice()).toBe(2_999)
  })

  it('treats a non-numeric price as free rather than NaN', () => {
    vi.stubEnv('MBTI_RESULT_PRICE', 'free please')
    expect(getResultPrice()).toBe(0)
  })

  it('falls back to free in production when the price is below the PayOS floor', () => {
    // Every checkout would fail at PayOS. Serving free is recoverable; taking down the
    // deployment that also hosts the portfolio is not.
    vi.stubEnv('MBTI_RESULT_PRICE', '500')
    expect(getResultPrice()).toBe(0)
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('below the PayOS minimum'))
  })

  it('throws in development when the price is below the PayOS floor', () => {
    // Loud and immediate where it is cheap to be loud.
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('MBTI_RESULT_PRICE', '500')
    expect(() => getResultPrice()).toThrow(/below the PayOS minimum/)
  })
})

describe('isPaidMode', () => {
  it('is false when the price is zero, however well configured PayOS is', () => {
    configurePayos()
    vi.stubEnv('MBTI_RESULT_PRICE', '0')
    expect(isPaidMode()).toBe(false)
  })

  it('is false when a price is set but PayOS is not configured', () => {
    // The kill switch. A paywall with no way through it is worse than giving the result
    // away, because the visitor cannot pay AND cannot read what they answered 60 questions for.
    vi.stubEnv('MBTI_RESULT_PRICE', '2000')
    expect(isPaidMode()).toBe(false)
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('PayOS is not configured'))
  })

  it('is false when PayOS is only partly configured', () => {
    vi.stubEnv('MBTI_RESULT_PRICE', '2000')
    vi.stubEnv('PAYOS_CLIENT_ID', 'client')
    vi.stubEnv('PAYOS_API_KEY', 'key')
    // No checksum key: signatures could never be verified, so payments could never settle.
    expect(isPaidMode()).toBe(false)
  })

  it('is true only with a valid price and complete PayOS credentials', () => {
    configurePayos()
    vi.stubEnv('MBTI_RESULT_PRICE', '2000')
    expect(isPaidMode()).toBe(true)
  })
})

describe('formatPrice', () => {
  it('formats dong with Vietnamese grouping', () => {
    expect(formatPrice(2000)).toBe('2.000₫')
    expect(formatPrice(50000)).toBe('50.000₫')
  })
})
