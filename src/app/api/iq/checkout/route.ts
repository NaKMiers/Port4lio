import { NextResponse, type NextRequest } from 'next/server'

import { jsonError } from '@/lib/api-response'
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n'
import { iqOrderCodeIsTaken } from '@/lib/iq/fulfil'
import {
  getIqResultPrice,
  isIqPaidMode,
  normaliseCertificateName,
} from '@/lib/iq/pricing'
import { connectDatabase } from '@/lib/mongodb'
import {
  createPaymentLink,
  generatePayosOrderCode,
  PayosError,
} from '@/lib/payos'
import { checkRateLimit, CHECKOUT_LIMIT, clientIpFrom } from '@/lib/rate-limit'
import { resolveSiteOrigin } from '@/lib/seo'
import { normaliseEmail } from '@/lib/test-kit/contact'
import { FUNNEL_EVENTS, recordFunnelDetached } from '@/lib/test-events'
import { isTokenShaped } from '@/lib/tokens'
import { IqAttemptModel } from '@/models/IqAttempt'
import {
  IqPaymentModel,
  unpaidIqPaymentExpiryFrom,
  type IqPaymentDocument,
} from '@/models/IqPayment'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_BODY_BYTES = 4 * 1024

/** How long a PayOS link stays payable. Matches the MBTI checkout deliberately. */
const LINK_TTL_MINUTES = 15

/**
 * [POST] /api/iq/checkout
 *
 * Starts a payment for one IQ result. Public and unauthenticated, like the rest of the
 * feature - holding the result token IS the claim to that result.
 *
 * ```
 *   size cap ─▶ rate limit ─▶ paid mode? ─▶ token+email+name ─▶ attempt exists & scored?
 *                                                                        │
 *                              already paid ◀───────────────────────────┤
 *                                                                        ▼
 *                                       reuse live pending payment ─or─ create PayOS link
 * ```
 *
 * A near copy of `/api/mbti/checkout`, and intentionally so: the same shape means the same
 * shared `TestPaywall` drives both, and the response contract below is what that component
 * reads. The two differences are the extra `name` field - the certificate that ships with a
 * paid IQ result carries one - and the collection written to.
 */
export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (contentLength > MAX_BODY_BYTES) return jsonError('Payload too large', 413)

  // Checked before anything else touches the database: if we are not charging, this route
  // has nothing to do and must not create payment records that would outlive the config.
  if (!isIqPaidMode()) return jsonError('Results are currently free', 409)

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
    name: rawName,
    locale: rawLocale,
  } = (body ?? {}) as {
    token?: unknown
    email?: unknown
    name?: unknown
    locale?: unknown
  }

  if (typeof rawToken !== 'string' || !isTokenShaped(rawToken))
    return jsonError('Invalid result token', 400)

  const email = normaliseEmail(rawEmail)
  if (!email) return jsonError('Please enter a valid email address', 400)

  // The word "name" in this message is load-bearing: `TestPaywall` distinguishes the two
  // 400s by looking for it, so a rejected name shows the name error rather than telling
  // the buyer to fix an address that was fine.
  const certificateName = normaliseCertificateName(rawName)
  if (!certificateName)
    return jsonError('Please enter a valid name for the certificate', 400)

  // Same narrowing rule as the submit route: a guard on an inline conditional refines the
  // expression, not the variable.
  const localeCandidate = typeof rawLocale === 'string' ? rawLocale : undefined
  const locale: Locale = isLocale(localeCandidate)
    ? localeCandidate
    : DEFAULT_LOCALE

  const attempt = await IqAttemptModel.findById(rawToken).lean()
  if (!attempt) return jsonError('This result no longer exists', 404)

  // Nothing to sell yet. A result is what is being bought, and an unfinished attempt has
  // no score on it.
  if (attempt.submittedAt === null || attempt.score === null)
    return jsonError('This test has not been completed', 400)

  // Not an error worth charging for twice. The client treats this as "reload and read it".
  if (attempt.paid)
    return NextResponse.json({ alreadyPaid: true }, { status: 200 })

  /**
   * Already free, and the result page says so.
   *
   * Answered like `paid` because from the buyer's side it is the same situation - nothing
   * left to buy, reload and read it. Refusing also protects the certificate: a public,
   * verifiable document minted for a score reached by guessing would be a fake credential
   * issued in our own name, and a certificate cannot be walked back once it is shared.
   */
  if (attempt.waived)
    return NextResponse.json({ alreadyPaid: true }, { status: 200 })

  const amount = getIqResultPrice()

  /**
   * Reuse a live link rather than minting a new one per click. Two links for one attempt
   * means the buyer can pay the one we are not watching, and PayOS quota is finite.
   *
   * `certificateName` is in the filter as well as `amount`: someone who reopens the form to
   * fix a typo in their name must get a NEW link, or they would pay for a certificate
   * carrying the old spelling and the fix would be silently discarded.
   */
  const existing = (await IqPaymentModel.findOne({
    attemptToken: rawToken,
    status: 'pending',
    amount,
    certificateName,
    linkExpiresAt: { $gt: new Date() },
  })
    .sort({ createdAt: -1 })
    .lean()) as IqPaymentDocument | null

  if (existing?.accountNumber)
    return NextResponse.json(await paymentResponse(existing), { status: 200 })

  const origin = resolveSiteOrigin().replace(/\/$/, '')
  const resultUrl = `${origin}/${locale}/iq/result/${rawToken}`

  // One timestamp, used for both the PayOS `expiredAt` and our stored `linkExpiresAt`, so
  // the countdown the buyer sees and the deadline PayOS enforces cannot drift apart.
  const linkExpiresAt = new Date(Date.now() + LINK_TTL_MINUTES * 60 * 1000)

  try {
    const orderCode = await generatePayosOrderCode(iqOrderCodeIsTaken)

    // PayOS truncates `description` into the bank memo, so it has to be short. The order
    // code is what actually matches the payment; this is only what a human sees.
    const link = await createPaymentLink({
      orderCode,
      amount,
      description: `IQ ${attempt.score}`,
      returnUrl: resultUrl,
      cancelUrl: resultUrl,
      expiredAt: Math.floor(linkExpiresAt.getTime() / 1000),
      buyerEmail: email,
    })

    const created = await IqPaymentModel.create({
      orderCode,
      attemptToken: rawToken,
      email,
      certificateName,
      amount,
      status: 'pending',
      locale,
      paymentLinkId: link.paymentLinkId,
      checkoutUrl: link.checkoutUrl,
      qrCode: link.qrCode,
      bin: link.bin,
      accountNumber: link.accountNumber,
      accountName: link.accountName,
      // PayOS's own memo, NOT the description we sent - it prefixes its own reference and a
      // transfer carrying anything else cannot be matched.
      transferDescription: link.description,
      linkExpiresAt,
      createdAt: new Date(),
      expireAt: unpaidIqPaymentExpiryFrom(new Date()),
    })

    // Server-emitted, like `paid`: a payment link now exists at PayOS, which is a fact only
    // this handler knows. Detached so a counter never delays handing the buyer their QR.
    recordFunnelDetached('iq', FUNNEL_EVENTS.checkoutStarted)

    return NextResponse.json(
      await paymentResponse(created.toObject() as IqPaymentDocument),
      {
        status: 201,
      }
    )
  } catch (error) {
    if (error instanceof PayosError) {
      console.error(
        `[iq-checkout] PayOS refused (${error.code}):`,
        error.message
      )
      return jsonError(
        'Could not start the payment. Please try again in a moment.',
        502
      )
    }

    console.error('[iq-checkout] failed to create payment', error)
    return jsonError('Could not start the payment. Please try again.', 500)
  }
}

/**
 * Only the fields the checkout UI needs. Notably NOT the buyer's email or name back to the
 * client, and not the score either - the order code is a guessable timestamp, so anything
 * echoed here is effectively public.
 *
 * `qrCode` is PayOS's raw VietQR payload, rendered to a PNG here rather than handed to a QR
 * image service: a third party on the payment path turns their downtime into our failed
 * checkout, for no benefit.
 */
async function paymentResponse(payment: IqPaymentDocument) {
  let qrDataUri: string | null = null

  if (payment.qrCode)
    try {
      const { toDataURL } = await import('qrcode')
      qrDataUri = await toDataURL(payment.qrCode, { margin: 1, width: 520 })
    } catch (error) {
      // The transfer details below are a complete way to pay on their own, so a QR that
      // fails to render is a degraded checkout, not a broken one.
      console.error('[iq-checkout] QR render failed', error)
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
