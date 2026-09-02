import { describe, expect, it } from 'vitest'

import { assertClientPostable, FUNNEL_EVENTS, ServerOnlyEventError } from '@/lib/test-events'
import { dayBucket, testEventId } from '@/models/TestEvent'

/**
 * The trust boundary.
 *
 * `/api/event` is public and unauthenticated - it has to be, because the things it records
 * happen in a stranger's browser. That makes `assertClientPostable` the only thing standing
 * between the funnel and anyone with `curl`.
 *
 * The stakes are specific. `paid` is the number a pricing decision gets made from, and a
 * forged row is indistinguishable from a real one afterward. A poisoned funnel is worse
 * than no funnel, because it would be believed.
 */

describe('assertClientPostable', () => {
  it('accepts the kinds a browser genuinely observes', () => {
    expect(() => assertClientPostable('share', null)).not.toThrow()
    expect(() => assertClientPostable('attribute', null)).not.toThrow()
    expect(() => assertClientPostable('progress', null)).not.toThrow()
  })

  it('refuses EVERY funnel event, including paywall-seen', () => {
    /**
     * `paywall-seen` used to be the one exception, on the reasoning that only the browser
     * knows the paywall rendered. Both result pages now decide `locked` server-side and
     * emit it there, so the exception protected nothing and cost something: `paywall-seen`
     * is a denominator in the conversion rate `/metrics` reports, so forged rows would drag
     * that rate down while looking entirely plausible.
     */
    expect(() => assertClientPostable('funnel', FUNNEL_EVENTS.paywallSeen)).toThrow(
      ServerOnlyEventError
    )
  })

  it('REFUSES a forged paid event', () => {
    // The assertion this whole file exists for.
    expect(() => assertClientPostable('funnel', FUNNEL_EVENTS.paid)).toThrow(ServerOnlyEventError)
  })

  it('refuses the other server-authoritative funnel events', () => {
    expect(() => assertClientPostable('funnel', FUNNEL_EVENTS.checkoutStarted)).toThrow(
      ServerOnlyEventError
    )
    expect(() => assertClientPostable('funnel', FUNNEL_EVENTS.resultViewed)).toThrow(
      ServerOnlyEventError
    )
  })

  it('refuses a funnel event with no name, rather than defaulting to something', () => {
    expect(() => assertClientPostable('funnel', null)).toThrow(ServerOnlyEventError)
    expect(() => assertClientPostable('funnel', '')).toThrow(ServerOnlyEventError)
  })

  it('refuses an invented kind', () => {
    expect(() => assertClientPostable('admin', null)).toThrow(ServerOnlyEventError)
    expect(() => assertClientPostable('', null)).toThrow(ServerOnlyEventError)
  })
})

describe('testEventId', () => {
  it('keys attribution on both the share and the visitor, so one arrival counts once', () => {
    const a = testEventId.attribute('mbti', 'TOKEN', 'session-1')
    const b = testEventId.attribute('mbti', 'TOKEN', 'session-2')

    // Same share, two different people: two rows, because that is two arrivals.
    expect(a).not.toBe(b)
    // Same share, same person, however many times the beacon re-fires: one row.
    expect(testEventId.attribute('mbti', 'TOKEN', 'session-1')).toBe(a)
  })

  it('keys progress on the session alone, so tab switches collapse', () => {
    expect(testEventId.progress('mbti', 's1')).toBe(testEventId.progress('mbti', 's1'))
    expect(testEventId.progress('mbti', 's1')).not.toBe(testEventId.progress('mbti', 's2'))
  })

  it('namespaces by product, so IQ cannot collide with MBTI', () => {
    expect(testEventId.progress('mbti', 's1')).not.toBe(testEventId.progress('iq', 's1'))
  })

  it('buckets funnel counters by day so a time series falls out of the key', () => {
    const day = dayBucket(new Date('2026-09-02T23:59:59.000Z'))
    expect(day).toBe('2026-09-02')
    expect(testEventId.funnel('mbti', 'paid', day)).toBe('mbti:funnel:paid:2026-09-02')
  })
})
