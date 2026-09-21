import { isPayosConfigured } from '@/lib/payos'

/**
 * What a full MBTI result costs, and whether we are charging at all.
 *
 * ```
 *   MBTI_RESULT_PRICE          PayOS keys      behaviour
 *   ─────────────────────────────────────────────────────────────
 *   unset / 0 / negative       any             free (today's flow)
 *   >= 2000                    missing         free + one loud log
 *   >= 2000                    present         paid
 *   1..1999                    any             misconfiguration (see below)
 * ```
 *
 * Every paid-mode decision in the app routes through `isPaidMode()`. Nothing else reads
 * `process.env.MBTI_RESULT_PRICE`, so there is one place to look when the site is charging
 * a number nobody expected.
 */

/**
 * PayOS rejects transfers below this. The exact floor varies by merchant contract, so
 * confirm it on my.payos.vn before assuming 2000 is right for the account in use.
 *
 * A price under the floor is not "a cheap product": PayOS refuses the create-link call, so
 * every single checkout fails at the moment the visitor tries to pay.
 */
export const PAYOS_MIN_AMOUNT = 2_000

function readPrice(): number {
  const raw = process.env.MBTI_RESULT_PRICE
  if (!raw) return 0

  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) {
    console.error(
      `[pricing] MBTI_RESULT_PRICE is not a number ("${raw}") - treating as free`
    )
    return 0
  }

  return Math.floor(parsed)
}

/**
 * The configured price in đồng, or 0 for free.
 *
 * A value between 1 and `PAYOS_MIN_AMOUNT` is always a mistake, and the two environments
 * want opposite things from it. In development, throwing is the fastest possible feedback
 * on a typo. In production, throwing would take down the whole deployment - including the
 * portfolio that shares it - over a pricing typo, so it degrades to free and says so
 * loudly. Hours of free results are recoverable; an outage on the page recruiters open is
 * a worse trade.
 */
export function getResultPrice(): number {
  const price = readPrice()
  if (price <= 0) return 0

  if (price < PAYOS_MIN_AMOUNT) {
    const message = `MBTI_RESULT_PRICE is ${price}, below the PayOS minimum of ${PAYOS_MIN_AMOUNT}. Every checkout would fail.`

    if (process.env.NODE_ENV === 'development')
      throw new Error(`[pricing] ${message}`)

    console.error(`[pricing] ${message} Falling back to free results.`)
    return 0
  }

  return price
}

/**
 * Whether to charge for results right now.
 *
 * The `isPayosConfigured()` half is the kill switch: a deployment with a price set but no
 * PayOS credentials must give results away rather than show a paywall with no way through
 * it. A visitor who cannot pay and cannot read their result would just leave.
 */
export function isPaidMode(): boolean {
  const price = getResultPrice()
  if (price <= 0) return false

  if (!isPayosConfigured()) {
    console.error(
      `[pricing] MBTI_RESULT_PRICE is ${price} but PayOS is not configured - serving results free. Set PAYOS_CLIENT_ID, PAYOS_API_KEY and PAYOS_CHECKSUM_KEY to start charging.`
    )
    return false
  }

  return true
}

/** `2000` -> `"2.000₫"`. Vietnamese grouping in both locales; the currency is đồng either way. */
export function formatPrice(amount: number): string {
  return `${new Intl.NumberFormat('vi-VN').format(amount)}₫`
}
