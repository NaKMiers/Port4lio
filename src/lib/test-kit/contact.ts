/**
 * Contact-field rules, shared by every test.
 *
 * Lifted out of `api/mbti/checkout/route.ts`, where both constants were file-local. That
 * was fine while one route validated email; the moment a second one did, two copies would
 * have drifted - and the failure mode is the ugly kind, where a address the MBTI checkout
 * accepts is rejected by the IQ gate for no reason the visitor can see.
 */

export const MAX_EMAIL_LENGTH = 254

/**
 * Deliberately loose: something@something.tld and no more.
 *
 * A stricter regex is a well-known way to reject real addresses (RFC 5321 permits far more
 * than people expect, including `+` tags and long TLDs). The address is only ever used to
 * send a result to whoever typed it, so the cost of accepting an odd-looking valid address
 * is zero and the cost of rejecting a real one is a lost buyer.
 */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Trimmed and lowercased, or `null` if it is not usable. */
export function normaliseEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const email = raw.trim().toLowerCase()
  if (!email || email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) return null
  return email
}
