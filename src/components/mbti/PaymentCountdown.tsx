'use client'

import { useEffect, useState } from 'react'

/** Under a minute is when people start watching the clock, so it gets the urgent colour. */
const URGENT_THRESHOLD_MS = 60_000

export type Countdown = {
  minutes: number
  seconds: number
  /** `m:ss`. Zero-padded seconds only - `0:07`, not `00:07`. */
  label: string
  expired: boolean
  urgent: boolean
}

/**
 * Pure clock maths, extracted so the boundary behaviour is testable without a DOM.
 *
 * `Math.ceil` on the seconds is deliberate: with `floor`, a deadline 900ms away renders as
 * "0:00" while the link is still payable, which reads as broken. Ceil means the display
 * only reaches 0:00 at true expiry.
 */
export function countdownFrom(deadlineMs: number, nowMs: number): Countdown {
  const remainingMs = Math.max(0, deadlineMs - nowMs)
  const totalSeconds = Math.ceil(remainingMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  return {
    minutes,
    seconds,
    label: `${minutes}:${String(seconds).padStart(2, '0')}`,
    expired: remainingMs === 0,
    urgent: remainingMs > 0 && remainingMs < URGENT_THRESHOLD_MS,
  }
}

/**
 * Counts down to the moment the PayOS link stops being payable.
 *
 * Takes an absolute ISO timestamp rather than a duration, so the clock is correct after a
 * refresh and on a reused link - handing it "15 minutes" would restart a countdown that is
 * already half spent, and the QR would die with time still showing.
 *
 * `onExpire` fires once, at the transition. The parent uses it to swap the panel for a
 * retry prompt rather than leaving a dead QR on screen.
 */
export default function PaymentCountdown({
  expiresAt,
  label,
  onExpire,
}: {
  expiresAt: string
  label: string
  onExpire: () => void
}) {
  const deadline = new Date(expiresAt).getTime()

  const [countdown, setCountdown] = useState(() =>
    countdownFrom(deadline, Date.now())
  )

  useEffect(() => {
    // Recomputed from the deadline every tick rather than decremented, so a backgrounded
    // tab - where timers are throttled hard - shows the true remaining time on return
    // instead of however many ticks it managed to fire.
    const tick = () => {
      const next = countdownFrom(deadline, Date.now())
      setCountdown(next)
      if (next.expired) onExpire()
    }

    tick()
    const timer = setInterval(tick, 1_000)
    return () => clearInterval(timer)
  }, [deadline, onExpire])

  const { label: remaining, urgent } = countdown

  return (
    <p className="flex items-center justify-center gap-2.5 text-sm text-pp-muted">
      <span>{label}</span>
      <time
        dateTime={expiresAt}
        // `tabular-nums` stops the digits jittering as the width of each glyph changes.
        className={`font-display text-base font-semibold tabular-nums ${
          urgent ? 'text-[#c2410c]' : 'text-pp-text'
        }`}
        // The countdown is decorative for a screen reader - announcing every second would
        // be unusable. The deadline is in `dateTime`, and expiry is announced by the
        // status message the parent swaps in.
        aria-hidden
      >
        {remaining}
      </time>
    </p>
  )
}
