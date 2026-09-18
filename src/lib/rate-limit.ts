import type { NextRequest } from 'next/server'

import { RateLimitModel } from '@/models/RateLimit'

/**
 * Fixed-window rate limiting backed by Mongo.
 *
 * ```
 *   request ──▶ bucket key = route : ip : floor(now / window)
 *                    │
 *                    ▼
 *          findOneAndUpdate($inc count, upsert)   ◀── atomic, one round trip
 *                    │
 *          count > limit ? 429 : continue
 * ```
 *
 * Fixed window, not sliding: a caller can get up to 2x the limit across a window
 * boundary. That is a known and accepted property. The job here is to stop a script from
 * writing a hundred thousand documents into a database shared with the portfolio, not to
 * meter an API precisely, and a fixed window does that in one atomic operation with no
 * extra state.
 *
 * `$inc` with `upsert` is the whole concurrency story: two simultaneous requests cannot
 * both read 0 and both write 1, because neither reads at all.
 */

export type RateLimitResult = {
  ok: boolean
  /** Seconds until the current window ends. Sent as `Retry-After` on a 429. */
  retryAfterSeconds: number
}

export type RateLimitOptions = {
  /** Distinguishes routes so submitting a test does not consume the invite budget. */
  route: string
  limit: number
  windowSeconds: number
}

/**
 * Best-effort client IP.
 *
 * `x-forwarded-for` is client-controlled in general, but behind Vercel (and any sane
 * proxy) the platform overwrites it, and the leftmost entry is the real client. There is
 * no perfect answer here without a trusted-proxy config; an attacker who can forge it can
 * spread across buckets, which is why this is a volume guard and not an auth control.
 */
export function clientIpFrom(request: NextRequest): string | null {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }
  return request.headers.get('x-real-ip')?.trim() || null
}

export async function checkRateLimit(
  ip: string | null,
  { route, limit, windowSeconds }: RateLimitOptions
): Promise<RateLimitResult> {
  // No identifiable caller means no meaningful bucket. Collapsing everyone into a shared
  // 'unknown' key looks like rate limiting but throttles real visitors against each
  // other: ten strangers finishing the test in the same minute would 429 one another,
  // while an actual attacker just rotates headers. Fail open and say so, rather than
  // punish the users we can least identify.
  if (!ip) {
    console.warn(`[rate-limit] no client IP on ${route} - check skipped`)
    return { ok: true, retryAfterSeconds: 0 }
  }

  const nowMs = Date.now()
  const windowMs = windowSeconds * 1000
  const windowStart = Math.floor(nowMs / windowMs)
  const windowEndsAt = new Date((windowStart + 1) * windowMs)
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((windowEndsAt.getTime() - nowMs) / 1000)
  )

  try {
    const doc = await RateLimitModel.findByIdAndUpdate(
      `${route}:${ip}:${windowStart}`,
      { $inc: { count: 1 }, $setOnInsert: { expireAt: windowEndsAt } },
      { upsert: true, new: true, lean: true }
    )

    return { ok: (doc?.count ?? 1) <= limit, retryAfterSeconds }
  } catch (error) {
    // Fail OPEN, deliberately. This guards against volume, not against an attacker, and a
    // transient Mongo blip must not take down a free test that is the top of the funnel.
    // The trade is explicit: a database outage means no rate limiting for its duration.
    console.error('[rate-limit] check failed, allowing request', error)
    return { ok: true, retryAfterSeconds }
  }
}

/** Submitting a finished 60-question test. Generous: a real person cannot approach this. */
export const SUBMIT_LIMIT: RateLimitOptions = {
  route: 'mbti-submit',
  limit: 10,
  windowSeconds: 60,
}

/**
 * Starting a checkout. Tighter than submitting, because each one creates a payment link at
 * PayOS and burns an order code - so this is protecting a third-party quota, not just our
 * own database. A real buyer needs one, or two if they change their mind about the email.
 */
export const CHECKOUT_LIMIT: RateLimitOptions = {
  route: 'mbti-checkout',
  limit: 6,
  windowSeconds: 60,
}

/**
 * Polling for payment status. Deliberately loose: the client polls every 3 seconds while a
 * payment is in flight, and someone may have the page open in two tabs. Throttling this
 * would strand a buyer on a spinner after their money had already left.
 */
export const STATUS_LIMIT: RateLimitOptions = {
  route: 'payos-status',
  limit: 90,
  windowSeconds: 60,
}

/**
 * Measurement beacons. Loose, because a single honest visitor legitimately emits several:
 * one share, one attribution on landing, and a progress beacon on each tab switch away
 * from the test. Tight enough that a script cannot fill a database shared with the
 * portfolio.
 *
 * Worth being clear about what this does and does not protect. Writes here are already
 * idempotent - the subject is baked into the document `_id`, so a flood of repeats updates
 * one row rather than adding rows. This is a volume guard on the write path, not the thing
 * keeping the numbers honest; that job belongs to the `_id` and to `assertClientPostable`.
 */
export const EVENT_LIMIT: RateLimitOptions = {
  route: 'event',
  limit: 60,
  windowSeconds: 60,
}

/**
 * Starting an IQ test. Each call writes a row and starts a 24-minute clock, so this is the
 * one IQ endpoint a script could use to fill the collection. Tight, because a real person
 * starts one test, or a few if they abandon and come back.
 */
export const IQ_START_LIMIT: RateLimitOptions = {
  route: 'iq-start',
  limit: 8,
  windowSeconds: 60,
}

/**
 * Submitting a finished IQ test. Looser than starting: submit is idempotent, so a retry
 * after a flaky connection is a normal thing to do and must not be punished with a 429 on
 * work that took 24 minutes.
 */
export const IQ_SUBMIT_LIMIT: RateLimitOptions = {
  route: 'iq-submit',
  limit: 20,
  windowSeconds: 60,
}

/**
 * Saving CCA-F study progress. Behind the owner gate, so this is not protecting against
 * strangers - it is a ceiling on a debounced autosave that fires on every tick of a
 * checkbox. The client coalesces edits into one write per ~800ms; a burst of ticking is a
 * handful of writes, so 40 leaves room for an impatient session without letting a stuck
 * retry loop rewrite the same document hundreds of times a minute.
 */
export const CCAF_SAVE_LIMIT: RateLimitOptions = {
  route: 'ccaf-save',
  limit: 40,
  windowSeconds: 60,
}

/**
 * The contact form. The tightest bucket here, and the window is an hour rather than a
 * minute.
 *
 * Every other bucket protects a database. This one protects a *mailbox*: each accepted
 * submission sends a message with a visitor-controlled subject, body and `replyTo` from the
 * site's own Gmail account. The failure mode is not a large collection, it is the owner's
 * inbox buried under a relayed spam run and the sending account suspended for it - and
 * Gmail's own daily quota is the only thing behind this.
 *
 * Three per hour, because a real person sends one. Two if they realise they typoed their
 * email, and three is already generous for the third attempt nobody makes. A minute-long
 * window would be useless here: a script sending one message a minute for a day stays under
 * every limit above and still delivers 1440 emails.
 *
 * This is NOT the only bound on the mail path, and it must not be treated as one.
 * `checkRateLimit` fails open on a missing client IP and fails open on a Mongo error, so
 * both of the failure modes that make this bucket matter most are also the ones that switch
 * it off. `api/contact/route.ts` carries a second, process-local ceiling for exactly that
 * reason - see `claimMailBudget` there.
 */
/**
 * The blog editor's autosave, modelled on `CCAF_SAVE_LIMIT` above.
 *
 * Owner-only, so this is not an abuse control - `requireOwner` already refused everyone else
 * before the limiter is reached. What it bounds is our own editor misbehaving: a debounce
 * that stops debouncing, a retry loop on a failing save, a second tab left open on the same
 * draft. Each PATCH re-renders the markdown through Shiki and writes `bodyHtml`, so a runaway
 * client is not a cheap no-op write, it is real CPU per request.
 *
 * Generous on purpose. A person typing produces a save every few seconds at most, and 60 in
 * a minute is far above anything a human can cause, so a 429 here means something is broken
 * rather than someone being productive.
 */
export const BLOG_SAVE_LIMIT: RateLimitOptions = {
  route: 'blog-save',
  limit: 60,
  windowSeconds: 60,
}

export const CONTACT_LIMIT: RateLimitOptions = {
  route: 'contact',
  limit: 3,
  windowSeconds: 60 * 60,
}

/*
 * IQ checkout has no limit of its own: `/api/iq/checkout` uses `CHECKOUT_LIMIT` above.
 *
 * The limit exists to protect PayOS's order-code quota, which is per merchant account and
 * shared by both products - so one bucket covering both is the accurate model. Two separate
 * buckets would let an abuser spend twice the quota by alternating between them.
 */
