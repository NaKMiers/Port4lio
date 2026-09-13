/**
 * How long a verified browser may act as the owner.
 *
 * ## Why this is not in `lib/auth.ts`
 *
 * It was, for about ten minutes. `lib/auth.ts` imports `node:crypto` and reads
 * `AUTH_SECRET`, so it is a server-only module - and `OwnerAuthGate` is a client component
 * that needs to know the range in order to draw the picker and label it. Importing the
 * constants from there would have pulled the signing code, and the secret it reads, toward
 * the browser bundle. Splitting the numbers out is cheaper than either duplicating them
 * (two sources of truth for a security bound) or shipping crypto to the client.
 *
 * Nothing here touches a secret or a token. It is arithmetic and a range check, which is
 * exactly why both sides can have it.
 */

const DAY_SECONDS = 24 * 60 * 60

/**
 * The floor is the old fixed behaviour: 24 hours. It stays the default because a session
 * that outlives the sitting is the one a borrowed or unlocked laptop inherits, and the cost
 * of the short option is one email.
 *
 * The ceiling exists because "remember me" with no end is not a session at all - a token
 * nobody can recall is only as revocable as `AUTH_SECRET`, and rotating that signs everyone
 * out of everything.
 */
export const AUTH_MIN_DAYS = 1
export const AUTH_MAX_DAYS = 30
export const AUTH_DEFAULT_DAYS = 1

/**
 * The requested session length, or `null` if it is not a whole number of days in range.
 *
 * Absent is not invalid: a caller that sends no preference gets `AUTH_DEFAULT_DAYS`, which
 * is what every caller did before the picker existed.
 *
 * Out of range is rejected rather than clamped. Clamping would quietly hand someone who
 * asked for 90 days a 30-day token and let them believe they had 90 - and the one thing a
 * session length has to be is a number the holder can trust.
 */
export function parseAuthDays(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') return AUTH_DEFAULT_DAYS
  const days = typeof raw === 'string' ? Number(raw) : raw
  if (typeof days !== 'number' || !Number.isInteger(days)) return null
  if (days < AUTH_MIN_DAYS || days > AUTH_MAX_DAYS) return null
  return days
}

export function authTtlSecondsForDays(days: number): number {
  return days * DAY_SECONDS
}
