import { describe, expect, it } from 'vitest'

import { LOCALES } from '@/lib/i18n'
import { UI } from '@/lib/mbti/content'
import { ATTEMPT_TTL_DAYS, attemptExpiryFrom } from '@/models/Attempt'

/**
 * Retention is a promise made to strangers about their own data, in two languages, in
 * three places (privacy notice, result page, result email). The number is easy to change
 * in one of them and forget the others - which had already happened once, with the UI
 * strings still saying 90 days after the constant moved.
 *
 * These tests make that specific drift impossible.
 */

describe('attempt retention', () => {
  it('is 21 days', () => {
    expect(ATTEMPT_TTL_DAYS).toBe(21)
  })

  it('computes an expiry that many days out', () => {
    const now = new Date('2026-01-01T00:00:00.000Z')
    expect(attemptExpiryFrom(now).toISOString()).toBe('2026-01-22T00:00:00.000Z')
  })

  it('never writes the retention number into UI copy', () => {
    // The whole point of the `{days}` placeholder. A literal number here is a promise that
    // silently goes stale the moment ATTEMPT_TTL_DAYS changes.
    for (const locale of LOCALES) {
      expect(UI[locale].resultKeepLink, `${locale} resultKeepLink`).toContain('{days}')
      expect(UI[locale].resultKeepLink, `${locale} hardcodes a day count`).not.toMatch(/\d+\s*(ngày|days)/)
    }
  })
})
