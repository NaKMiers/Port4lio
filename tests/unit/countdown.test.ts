import { describe, expect, it } from 'vitest'

import { countdownFrom } from '@/components/mbti/PaymentCountdown'

/**
 * The payment countdown's clock maths.
 *
 * Extracted from the component so the boundary cases are testable without a DOM. They are
 * worth pinning because both directions mislead a buyer mid-payment: showing 0:00 while the
 * link still works reads as broken, and showing time left on a dead link sends someone to
 * their banking app for a transfer that can no longer be matched.
 */

const DEADLINE = 1_700_000_000_000

describe('countdownFrom', () => {
  it('formats minutes and zero-padded seconds', () => {
    expect(countdownFrom(DEADLINE, DEADLINE - 15 * 60_000).label).toBe('15:00')
    expect(countdownFrom(DEADLINE, DEADLINE - 63_000).label).toBe('1:03')
    expect(countdownFrom(DEADLINE, DEADLINE - 7_000).label).toBe('0:07')
  })

  it('rounds up, so it never shows 0:00 while the link is still payable', () => {
    // With Math.floor this renders "0:00" for a link that has 900ms left, which reads as
    // expired to anyone looking at it.
    const almost = countdownFrom(DEADLINE, DEADLINE - 900)
    expect(almost.label).toBe('0:01')
    expect(almost.expired).toBe(false)
  })

  it('reaches 0:00 exactly at the deadline, and reports expired', () => {
    const atDeadline = countdownFrom(DEADLINE, DEADLINE)
    expect(atDeadline.label).toBe('0:00')
    expect(atDeadline.expired).toBe(true)
  })

  it('clamps rather than counting negative once the deadline has passed', () => {
    // A page left open overnight must not display "-431:12".
    const late = countdownFrom(DEADLINE, DEADLINE + 60 * 60_000)
    expect(late.label).toBe('0:00')
    expect(late.minutes).toBe(0)
    expect(late.seconds).toBe(0)
    expect(late.expired).toBe(true)
  })

  it('marks the final minute urgent, but never an already-expired clock', () => {
    expect(countdownFrom(DEADLINE, DEADLINE - 61_000).urgent).toBe(false)
    expect(countdownFrom(DEADLINE, DEADLINE - 59_000).urgent).toBe(true)
    // Expired is its own state with its own message; it must not also render as "urgent".
    expect(countdownFrom(DEADLINE, DEADLINE).urgent).toBe(false)
  })

  it('handles a long link without rolling minutes over an hour boundary oddly', () => {
    expect(countdownFrom(DEADLINE, DEADLINE - 90 * 60_000).label).toBe('90:00')
  })
})
