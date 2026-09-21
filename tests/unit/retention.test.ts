import { describe, expect, it } from 'vitest'

import { LOCALES } from '@/lib/i18n'
import { UI } from '@/lib/mbti/content'
import { ATTEMPT_TTL_DAYS, attemptExpiryFrom } from '@/models/Attempt'
import { testEventExpiryFrom } from '@/models/TestEvent'

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
    expect(attemptExpiryFrom(now).toISOString()).toBe(
      '2026-01-22T00:00:00.000Z'
    )
  })

  it('never writes the retention number into UI copy', () => {
    // The whole point of the `{days}` placeholder. A literal number here is a promise that
    // silently goes stale the moment ATTEMPT_TTL_DAYS changes.
    for (const locale of LOCALES) {
      expect(UI[locale].resultKeepLink, `${locale} resultKeepLink`).toContain(
        '{days}'
      )
      expect(
        UI[locale].resultKeepLink,
        `${locale} hardcodes a day count`
      ).not.toMatch(/\d+\s*(ngày|days)/)
    }
  })
})

/**
 * MANDATORY REGRESSION: `TestEvent`'s retention window is still 21 days.
 *
 * Phase 0 adds `ContactMessage`, which deliberately has NO TTL index at all - see
 * `tests/api/contact.test.ts`. That is the first collection on this site holding stranger
 * data that is not covered by the one sentence `/[lang]/mbti/privacy` says, so it is exactly
 * the moment somebody starts adjusting retention windows to make the story tidy.
 *
 * `tests/api/retention.test.ts` already asserts `TestEvent`'s window *equals*
 * `ATTEMPT_TTL_DAYS`, which is the property that matters for the privacy notice. But an
 * equality alone would still pass if both moved together, so this pins the number itself,
 * beside the `ATTEMPT_TTL_DAYS` assertion above that pins the other half. Neither one can
 * drift without a test naming it.
 */
describe('test event retention', () => {
  it('is still 21 days, the same window as Attempt', () => {
    const now = new Date('2026-01-01T00:00:00.000Z')
    const elapsedDays =
      (testEventExpiryFrom(now).getTime() - now.getTime()) / 86_400_000

    expect(elapsedDays).toBe(21)
    expect(elapsedDays).toBe(ATTEMPT_TTL_DAYS)
  })
})
