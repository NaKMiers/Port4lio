import { describe, expect, it } from 'vitest'

import {
  DEFAULT_LOCALE,
  isLocale,
  LOCALE_LABELS,
  LOCALES,
  negotiateLocale,
  swapLocale,
} from '@/lib/i18n'

/**
 * Locale negotiation decides which language a first-time visitor lands in, and a wrong
 * answer here sends every Vietnamese visitor to the English test (or the reverse). It is
 * pure string handling, so it is cheap to pin down completely.
 */
describe('negotiateLocale', () => {
  it('falls back to Vietnamese when no header is sent', () => {
    expect(negotiateLocale(null)).toBe(DEFAULT_LOCALE)
    expect(negotiateLocale(undefined)).toBe(DEFAULT_LOCALE)
    expect(negotiateLocale('')).toBe(DEFAULT_LOCALE)
  })

  it('matches a bare tag', () => {
    expect(negotiateLocale('vi')).toBe('vi')
    expect(negotiateLocale('en')).toBe('en')
  })

  it('matches a region-qualified tag by its base language', () => {
    expect(negotiateLocale('en-US')).toBe('en')
    expect(negotiateLocale('vi-VN')).toBe('vi')
  })

  it('honours q-values rather than list order', () => {
    // This is the case a naive "first match wins" implementation gets wrong: `en` appears
    // first in the string but the browser ranked `vi` higher.
    expect(negotiateLocale('en;q=0.2,vi;q=0.9')).toBe('vi')
    expect(negotiateLocale('vi;q=0.3,en;q=0.8')).toBe('en')
  })

  it('treats a missing q-value as 1', () => {
    expect(negotiateLocale('en,vi;q=0.9')).toBe('en')
  })

  it('skips languages we do not support', () => {
    expect(negotiateLocale('fr-FR,fr;q=0.9,en;q=0.8')).toBe('en')
    expect(negotiateLocale('ja,ko;q=0.9')).toBe(DEFAULT_LOCALE)
  })

  it('ignores entries explicitly refused with q=0', () => {
    expect(negotiateLocale('en;q=0,vi;q=0.5')).toBe('vi')
  })

  it('is case-insensitive', () => {
    expect(negotiateLocale('EN-GB')).toBe('en')
    expect(negotiateLocale('VI')).toBe('vi')
  })

  it('does not crash on malformed input', () => {
    expect(negotiateLocale(';;;')).toBe(DEFAULT_LOCALE)
    expect(negotiateLocale('en;q=notanumber')).toBe(DEFAULT_LOCALE)
    expect(negotiateLocale(',,,')).toBe(DEFAULT_LOCALE)
  })
})

describe('isLocale', () => {
  it('accepts supported locales only', () => {
    expect(isLocale('vi')).toBe(true)
    expect(isLocale('en')).toBe(true)
    expect(isLocale('fr')).toBe(false)
    expect(isLocale('')).toBe(false)
    expect(isLocale(undefined)).toBe(false)
    // Guards `/EN/mbti` - the route segment is lowercase by contract.
    expect(isLocale('EN')).toBe(false)
  })
})

describe('swapLocale', () => {
  it('swaps the locale segment and keeps the rest of the path', () => {
    expect(swapLocale('/vi/mbti', 'en')).toBe('/en/mbti')
    expect(swapLocale('/en/mbti/test', 'vi')).toBe('/vi/mbti/test')
    expect(swapLocale('/vi/mbti/enfj', 'en')).toBe('/en/mbti/enfj')
    expect(swapLocale('/en/mbti/privacy', 'vi')).toBe('/vi/mbti/privacy')
  })

  it('preserves a result token', () => {
    // The whole point: switching language must not cost someone the result they just
    // finished sixty questions for.
    const token = 'AbCd1234EfGh5678IjKl90'
    expect(swapLocale(`/vi/mbti/result/${token}`, 'en')).toBe(
      `/en/mbti/result/${token}`
    )
  })

  it('is a no-op when the target already matches', () => {
    expect(swapLocale('/vi/mbti/test', 'vi')).toBe('/vi/mbti/test')
  })

  it('falls back to the locale landing page when there is no locale prefix', () => {
    // Never produce `/en//mbti` or `/en/mbti/mbti` from an unexpected path.
    expect(swapLocale('/mbti', 'en')).toBe('/en/mbti')
    expect(swapLocale('/', 'vi')).toBe('/vi/mbti')
    expect(swapLocale('', 'en')).toBe('/en/mbti')
  })

  it('round-trips back to the original path', () => {
    const path = '/vi/mbti/result/AbCd1234EfGh5678IjKl90'
    expect(swapLocale(swapLocale(path, 'en'), 'vi')).toBe(path)
  })
})

describe('locale labels', () => {
  it('names every locale in its own language', () => {
    for (const locale of LOCALES)
      expect(
        LOCALE_LABELS[locale]?.length,
        `label for ${locale}`
      ).toBeGreaterThan(0)
  })
})
