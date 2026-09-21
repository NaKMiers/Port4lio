import { NextResponse, type NextRequest } from 'next/server'

import { jsonError } from '@/lib/api-response'
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n'
import { getResultPrice, isPaidMode } from '@/lib/mbti/pricing'
import { connectDatabase } from '@/lib/mongodb'
import {
  createPaymentLink,
  generatePayosOrderCode,
  PayosError,
} from '@/lib/payos'
import { payosOrderCodeIsTaken } from '@/lib/payos-fulfil'
import { checkRateLimit, CHECKOUT_LIMIT, clientIpFrom } from '@/lib/rate-limit'
import { resolveSiteOrigin } from '@/lib/seo'
import { normaliseEmail } from '@/lib/test-kit/contact'
import { FUNNEL_EVENTS, recordFunnelDetached } from '@/lib/test-events'
import { isTokenShaped } from '@/lib/tokens'
import { AttemptModel, type AttemptDocument } from '@/models/Attempt'
import {
  PaymentModel,
  unpaidPaymentExpiryFrom,
  type PaymentDocument,
} from '@/models/Payment'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_BODY_BYTES = 4 * 1024

/**
 * How long a payment link stays payable. Long enough to open a banking app and find the
 * transfer screen, short enough that an abandoned link does not sit around claimable.
 *
 * The checkout panel counts down to the stored `linkExpiresAt` rather than to this
 * constant, so changing it here cannot leave the UI showing a duration that no longer
 * matches what PayOS enforces.
 */
const LINK_TTL_MINUTES = 15

/**
 * [POST] /api/mbti/checkout
 *
 * Starts a payment for one attempt. Public and unauthenticated, like the rest of the MBTI
 * feature - holding the result token IS the claim to that result.
 *
 * ```
 *   size cap ─▶ rate limit ─▶ paid mode? ─▶ validate token+email ─▶ attempt exists?
 *                                                                        │
 *                              already paid ◀───────────────────────────┤
 *                                                                        ▼
 *                                       reuse live pending payment ─or─ create PayOS link
 * ```
 */
export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (contentLength > MAX_BODY_BYTES) return jsonError('Payload too large', 413)

  // Checked before anything else touches the database: if we are not charging, this route
  // has nothing to do and must not create payment records that would outlive the config.
  if (!isPaidMode()) return jsonError('Results are currently free', 409)

  await connectDatabase()

  const limit = await checkRateLimit(clientIpFrom(request), CHECKOUT_LIMIT)
  if (!limit.ok)
    return NextResponse.json(
      { error: 'Too many requests' },
      {
        status: 429,
        headers: { 'Retry-After': String(limit.retryAfterSeconds) },
      }
    )

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonError('Invalid JSON body', 400)
  }

  const {
    token: rawToken,
    email: rawEmail,
    locale: rawLocale,
  } = (body ?? {}) as { token?: unknown; email?: unknown; locale?: unknown }

  if (typeof rawToken !== 'string' || !isTokenShaped(rawToken))
    return jsonError('Invalid result token', 400)

  const email = normaliseEmail(rawEmail)
  if (!email) return jsonError('Please enter a valid email address', 400)

  // Same narrowing rule as the submit route: a guard on an inline conditional refines the
  // expression, not the variable.
  const localeCandidate = typeof rawLocale === 'string' ? rawLocale : undefined
  const locale: Locale = isLocale(localeCandidate)
    ? localeCandidate
    : DEFAULT_LOCALE

  const attempt = (await AttemptModel.findById(
    rawToken
  ).lean()) as AttemptDocument | null
  if (!attempt) return jsonError('This result no longer exists', 404)

  // Not an error worth charging for twice. The client treats this as "reload and read it".
  if (attempt.paid)
    return NextResponse.json({ alreadyPaid: true }, { status: 200 })

  // Already free, and the result page says so. Answered the same way as `paid` because it
  // is the same situation from the buyer's side: there is nothing left to buy, so reload
  // and read it. Taking money here would charge for something we already gave away.
  if (attempt.waived)
    return NextResponse.json({ alreadyPaid: true }, { status: 200 })

  const amount = getResultPrice()

  // Reuse a live link rather than minting a new one per click. Two links for one attempt
  // means the buyer can pay the one we are not watching, and PayOS quota is finite.
  //
  // `linkExpiresAt` in the future is load-bearing: without it a reopened page would be
  // handed a QR that PayOS stopped accepting minutes ago, and the countdown would start
  // from a timestamp already in the past.
  const existing = (await PaymentModel.findOne({
    attemptToken: rawToken,
    status: 'pending',
    amount,
    linkExpiresAt: { $gt: new Date() },
  })
    .sort({ createdAt: -1 })
    .lean()) as PaymentDocument | null

  if (existing?.accountNumber)
    return NextResponse.json(await paymentResponse(existing), { status: 200 })

  const origin = resolveSiteOrigin().replace(/\/$/, '')
  const resultUrl = `${origin}/${locale}/mbti/result/${rawToken}`

  // One timestamp, used for both the PayOS `expiredAt` and our stored `linkExpiresAt`, so
  // the countdown the buyer sees and the deadline PayOS enforces cannot drift apart.
  const linkExpiresAt = new Date(Date.now() + LINK_TTL_MINUTES * 60 * 1000)

  try {
    const orderCode = await generatePayosOrderCode(payosOrderCodeIsTaken)

    // PayOS truncates `description` into the bank memo, so it has to be short. The order
    // code is what actually matches the payment; this is only what a human sees.
    const link = await createPaymentLink({
      orderCode,
      amount,
      description: `MBTI ${attempt.type}`,
      returnUrl: resultUrl,
      cancelUrl: resultUrl,
      expiredAt: Math.floor(linkExpiresAt.getTime() / 1000),
      buyerEmail: email,
    })

    const created = await PaymentModel.create({
      orderCode,
      attemptToken: rawToken,
      email,
      amount,
      status: 'pending',
      locale,
      paymentLinkId: link.paymentLinkId,
      checkoutUrl: link.checkoutUrl,
      qrCode: link.qrCode,
      bin: link.bin,
      accountNumber: link.accountNumber,
      accountName: link.accountName,
      // PayOS's own memo, NOT the description we sent - it prefixes its own reference and
      // a transfer carrying anything else cannot be matched.
      transferDescription: link.description,
      linkExpiresAt,
      createdAt: new Date(),
      expireAt: unpaidPaymentExpiryFrom(new Date()),
    })

    // Server-emitted, like `paid`: a payment link now exists at PayOS, which is a fact
    // only this handler knows. Detached so a counter never delays handing the buyer their
    // QR code.
    recordFunnelDetached('mbti', FUNNEL_EVENTS.checkoutStarted)

    return NextResponse.json(
      await paymentResponse(created.toObject() as PaymentDocument),
      {
        status: 201,
      }
    )
  } catch (error) {
    if (error instanceof PayosError) {
      console.error(
        `[mbti-checkout] PayOS refused (${error.code}):`,
        error.message
      )
      return jsonError(
        'Could not start the payment. Please try again in a moment.',
        502
      )
    }

    console.error('[mbti-checkout] failed to create payment', error)
    return jsonError('Could not start the payment. Please try again.', 500)
  }
}

/**
 * Only the fields the checkout UI needs. Notably NOT the buyer's email back to the client.
 *
 * `qrCode` is PayOS's raw VietQR payload, so it is rendered to a PNG here rather than sent
 * to a QR image service. AnphaShop hands the payload to `api.qrserver.com`; doing that puts
 * a third party on the payment path - their downtime becomes our failed checkout, and the
 * payload naming the payee and amount leaves our infrastructure for no benefit. Generating
 * it locally costs a few milliseconds and one dependency.
 */
async function paymentResponse(payment: PaymentDocument) {
  let qrDataUri: string | null = null

  if (payment.qrCode)
    try {
      const { toDataURL } = await import('qrcode')
      qrDataUri = await toDataURL(payment.qrCode, { margin: 1, width: 520 })
    } catch (error) {
      // The transfer details below are a complete way to pay on their own, so a QR that
      // fails to render is a degraded checkout, not a broken one.
      console.error('[mbti-checkout] QR render failed', error)
    }

  return {
    orderCode: payment.orderCode,
    amount: payment.amount,
    // Absolute, not a duration: the countdown then survives a refresh and stays correct on
    // a reused link, where "15 minutes" would restart a clock that is already half spent.
    expiresAt: payment.linkExpiresAt.toISOString(),
    qrDataUri,
    bin: payment.bin,
    accountNumber: payment.accountNumber,
    accountName: payment.accountName,
    transferDescription: payment.transferDescription,
    checkoutUrl: payment.checkoutUrl,
  }
}
