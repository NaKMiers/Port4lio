import { formatPrice, PAYOS_MIN_AMOUNT } from '@/lib/mbti/pricing'
import { isPayosConfigured } from '@/lib/payos'

/**
 * What a full IQ result costs, and whether we are charging at all.
 *
 * ```
 *   IQ_RESULT_PRICE            PayOS keys      behaviour
 *   ─────────────────────────────────────────────────────────────
 *   unset / 0 / negative       any             free
 *   >= 2000                    missing         free + one loud log
 *   >= 2000                    present         paid
 *   1..1999                    any             misconfiguration (see below)
 * ```
 *
 * A deliberate mirror of `lib/mbti/pricing.ts`, down to the fallback behaviour, because the
 * two products now have the same shape: the result is the paid artifact and the certificate
 * comes with it. Two modules rather than one shared function so the prices can differ
 * without a shared constant becoming a coupling nobody wanted - but the RULES are identical
 * on purpose, and `PAYOS_MIN_AMOUNT` and `formatPrice` are imported rather than redeclared
 * because the PayOS floor is a property of the merchant account, not of a product.
 */

export function getIqResultPrice(): number {
  const raw = process.env.IQ_RESULT_PRICE
  if (!raw) return 0

  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) {
    console.error(
      `[iq-pricing] IQ_RESULT_PRICE is not a number ("${raw}") - treating as free`
    )
    return 0
  }

  const price = Math.floor(parsed)
  if (price <= 0) return 0

  if (price < PAYOS_MIN_AMOUNT) {
    const message = `IQ_RESULT_PRICE is ${price}, below the PayOS minimum of ${PAYOS_MIN_AMOUNT}. Every checkout would fail.`

    // Throw in development, where it is the fastest possible feedback on a typo. Degrade in
    // production, where throwing would take down the portfolio and the CV over a pricing
    // mistake - hours of free results are recoverable, an outage on the page recruiters
    // open is not.
    if (process.env.NODE_ENV === 'development')
      throw new Error(`[iq-pricing] ${message}`)

    console.error(`[iq-pricing] ${message} Falling back to free results.`)
    return 0
  }

  return price
}

/**
 * Whether to charge for IQ results right now.
 *
 * The `isPayosConfigured()` half is the kill switch: a deployment with a price but no PayOS
 * credentials must give results away rather than show a paywall with no way through it. A
 * visitor who can neither pay nor read their result would simply leave.
 */
export function isIqPaidMode(): boolean {
  const price = getIqResultPrice()
  if (price <= 0) return false

  if (!isPayosConfigured()) {
    console.error(
      `[iq-pricing] IQ_RESULT_PRICE is ${price} but PayOS is not configured - serving results free. Set PAYOS_CLIENT_ID, PAYOS_API_KEY and PAYOS_CHECKSUM_KEY to start charging.`
    )
    return false
  }

  return true
}

export { formatPrice }

/**
 * Display-name rules for the certificate that comes with a paid result.
 *
 * This name goes on a deliberately public, indexable page, so it is the one piece of
 * user-supplied text on the whole IQ surface that strangers will read. Bounded and
 * character-restricted rather than sanitised afterwards: the certificate renders as text in
 * React (which escapes) and through Satori for its card (which has no HTML context to
 * escape into), so the defence that matters is keeping the input space small.
 */
export const CERTIFICATE_NAME_MAX = 40

/**
 * Letters, digits, and the punctuation that appears in real names.
 *
 * Explicit code-unit ranges rather than `\p{L}` with the `u` flag, because this project
 * compiles at `target: es5` and the compiler rejects unicode property escapes there.
 * Bumping the global target for one regex would be a much larger change than the problem.
 *
 * The ranges, so a future reader does not have to decode them:
 *   00C0-024F  Latin-1 Supplement + Latin Extended-A/B (á, ê, ñ, ō, ...)
 *   0300-036F  Combining diacriticals, for decomposed forms - macOS pastes these
 *   1E00-1EFF  Latin Extended Additional, which is where most Vietnamese lives (ệ, ỹ, ấ)
 *
 * Vietnamese names are the primary case and they break under a naive `A-Za-z` allowlist,
 * so this is correctness for the main audience rather than internationalisation polish.
 */
const NAME_PATTERN = /^[A-Za-z0-9 '.À-ɏ̀-ͯḀ-ỿ-]+$/

export function normaliseCertificateName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim().replace(/\s+/g, ' ')
  if (trimmed.length < 2 || trimmed.length > CERTIFICATE_NAME_MAX) return null
  if (!NAME_PATTERN.test(trimmed)) return null
  return trimmed
}
