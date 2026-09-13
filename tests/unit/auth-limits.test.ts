import { describe, expect, it } from 'vitest'

import {
  AUTH_DEFAULT_DAYS,
  AUTH_MAX_DAYS,
  AUTH_MIN_DAYS,
  authTtlSecondsForDays,
  parseAuthDays,
} from '@/lib/auth-limits'

/**
 * The bound on how long a verified browser may act as the owner.
 *
 * `parseAuthDays` is not a form validator with a server-side copy - it IS the check. The
 * picker in `OwnerAuthGate` can only ever send what it draws, so everything interesting
 * that reaches this function came from something other than the picker. That is why the
 * rejections below matter more than the happy path.
 */
describe('parseAuthDays', () => {
  it('accepts every whole day in the range', () => {
    for (let days = AUTH_MIN_DAYS; days <= AUTH_MAX_DAYS; days += 1) {
      expect(parseAuthDays(days), `${days} days`).toBe(days)
    }
  })

  it('reads the number a JSON body might send as a string', () => {
    expect(parseAuthDays('7')).toBe(7)
  })

  it('falls back to the default when no preference is expressed', () => {
    // A caller predating the picker sends `{ code }` and nothing else, and must keep
    // getting what it always got.
    expect(parseAuthDays(undefined)).toBe(AUTH_DEFAULT_DAYS)
    expect(parseAuthDays(null)).toBe(AUTH_DEFAULT_DAYS)
    expect(parseAuthDays('')).toBe(AUTH_DEFAULT_DAYS)
    expect(AUTH_DEFAULT_DAYS).toBe(AUTH_MIN_DAYS)
  })

  it('refuses anything past the ceiling rather than clamping to it', () => {
    // Clamping would hand someone who asked for a year a 30-day token and let them believe
    // they had a year. The one thing a session length must be is a number you can trust.
    expect(parseAuthDays(AUTH_MAX_DAYS + 1)).toBeNull()
    expect(parseAuthDays(365)).toBeNull()
    expect(parseAuthDays(Number.MAX_SAFE_INTEGER)).toBeNull()
  })

  it('refuses anything below the floor, including the session that never ends', () => {
    expect(parseAuthDays(0)).toBeNull()
    expect(parseAuthDays(-1)).toBeNull()
    expect(parseAuthDays(-9999)).toBeNull()
  })

  it('refuses values that are not whole days', () => {
    expect(parseAuthDays(1.5)).toBeNull()
    expect(parseAuthDays('7.5')).toBeNull()
    expect(parseAuthDays(Number.NaN)).toBeNull()
    expect(parseAuthDays(Number.POSITIVE_INFINITY)).toBeNull()
  })

  it('refuses shapes that are not a number at all', () => {
    expect(parseAuthDays('thirty')).toBeNull()
    expect(parseAuthDays(true)).toBeNull()
    expect(parseAuthDays({ days: 7 })).toBeNull()
    // `Number([])` is 0 and `Number([7])` is 7 - neither is a length anybody typed.
    expect(parseAuthDays([])).toBeNull()
    expect(parseAuthDays([7])).toBeNull()
  })
})

describe('authTtlSecondsForDays', () => {
  it('is the cookie lifetime and the token lifetime, in seconds', () => {
    expect(authTtlSecondsForDays(1)).toBe(86_400)
    expect(authTtlSecondsForDays(30)).toBe(2_592_000)
  })

  it('keeps the previous fixed behaviour as the default', () => {
    expect(authTtlSecondsForDays(AUTH_DEFAULT_DAYS)).toBe(24 * 60 * 60)
  })
})
