import { NextResponse, type NextRequest } from 'next/server'

import { deliverResultEmail } from '@/lib/mbti/result-email'
import { connectDatabase } from '@/lib/mongodb'
import { verifyPayosData, type PayosWebhookBody } from '@/lib/payos'
import { fulfilIqPayment } from '@/lib/iq/fulfil'
import { deliverIqResultEmail } from '@/lib/iq/result-email'
import { fulfilMbtiPayment } from '@/lib/payos-fulfil'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * [POST] /api/payos/webhook
 *
 * Public by design - PayOS posts here server to server, so there is no session and no
 * cookie. The HMAC signature IS the authentication, and nothing happens before it verifies.
 *
 * Register this URL once per environment with `confirmWebhook()`, and only against this
 * feature's own PayOS merchant account. PayOS stores ONE webhook URL per merchant:
 * registering it while another product shares the account silently redirects that
 * product's payment notifications here, where they resolve to `unknown-order-code` and are
 * dropped.
 */
export async function POST(request: NextRequest) {
  let body: PayosWebhookBody

  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ message: 'Invalid JSON body' }, { status: 400 })
  }

  const { data, signature } = body ?? {}

  // Reject anything we cannot cryptographically attribute to PayOS. This is the only thing
  // standing between the internet and "mark any order paid".
  if (!verifyPayosData(data as unknown as Record<string, unknown>, signature)) {
    console.warn('[PayOS Webhook] Signature verification failed')
    return NextResponse.json({ message: 'Invalid signature' }, { status: 400 })
  }

  const orderCode = Number(data?.orderCode)
  const amount = Number(data?.amount)

  if (!Number.isFinite(orderCode) || !Number.isFinite(amount))
    return NextResponse.json({ message: 'Invalid payload' }, { status: 400 })

  try {
    await connectDatabase()

    // Set when the order turns out to be an IQ one, so the acknowledgement below reports
    // what actually happened rather than MBTI's `unknown-order-code`. Only ever read in
    // logs and by PayOS's dashboard, but a fulfilled IQ payment reporting "unknown" is the
    // kind of thing that wastes an hour during an incident.
    let iqOutcome: string | null = null

    const result = await fulfilMbtiPayment(
      {
        orderCode,
        amount,
        reference: data?.reference,
        transactionDateTime: data?.transactionDateTime,
      },
      deliverResultEmail
    )

    switch (result.outcome) {
      case 'fulfilled':
        console.info(`[PayOS Webhook] Fulfilled ${orderCode}`)
        break

      case 'already-processed':
        console.info(`[PayOS Webhook] ${orderCode} already processed`)
        break

      /**
       * Not an MBTI order. Two possibilities, and they need telling apart.
       *
       * ```
       *   orderCode ──▶ fulfilMbtiPayment ──▶ unknown-order-code
       *                                            │
       *                                            ▼
       *                                    fulfilIqPayment
       *                                       │          │
       *                                   fulfilled   unknown ──▶ registration ping
       * ```
       *
       * Both products share one PayOS merchant account, so one webhook receives both and
       * has to route by order code. Chaining on `unknown-order-code` rather than looking
       * the code up twice up front keeps MBTI - the older, higher-volume path - at one
       * query.
       *
       * PayOS also posts an arbitrary payload when the webhook URL is registered, and must
       * receive a 2XX or registration fails. That is what falls through both lookups.
       */
      case 'unknown-order-code': {
        const iq = await fulfilIqPayment(
          { orderCode, amount, reference: data?.reference },
          deliverIqResultEmail
        )
        iqOutcome = iq.outcome
        switch (iq.outcome) {
          case 'fulfilled':
            console.info(`[PayOS Webhook] Fulfilled IQ result ${orderCode}`)
            break
          case 'already-processed':
            console.info(`[PayOS Webhook] IQ ${orderCode} already processed`)
            break
          case 'amount-mismatch':
            console.error(`[PayOS Webhook] AMOUNT MISMATCH on IQ ${orderCode}`)
            break
          // Already logged in full by fulfilIqPayment, which is the only place that knows
          // a claimed payment failed to unlock or deliver.
          case 'delivery-failed':
            console.error(
              `[PayOS Webhook] IQ paid but undelivered: ${orderCode}`
            )
            break
          case 'unknown-order-code':
            console.info(
              `[PayOS Webhook] No payment for ${orderCode} (registration ping?)`
            )
            break
        }
        break
      }

      // Someone paid an amount we never asked for. Not fulfilled, and loud: this is either
      // a bug in our own amount handling or someone probing the endpoint.
      case 'amount-mismatch':
        console.error(
          `[PayOS Webhook] AMOUNT MISMATCH on ${orderCode}: ${result.message}`
        )
        break

      // Already logged in full by fulfilMbtiPayment, which is the only place that knows a
      // claimed payment failed to deliver.
      case 'delivery-failed':
        console.error(`[PayOS Webhook] Paid but undelivered: ${orderCode}`)
        break
    }

    // Always acknowledge a verified webhook, whatever the outcome. A non-2XX makes PayOS
    // retry a payload we have already recorded, and the retry would find the payment
    // claimed and report success - so the retry buys nothing and costs a duplicate.
    return NextResponse.json(
      { success: true, outcome: iqOutcome ?? result.outcome },
      { status: 200 }
    )
  } catch (error) {
    // A genuine server-side failure - database down, most likely. Let PayOS retry, because
    // this one really might succeed next time.
    console.error('[PayOS Webhook] Processing error:', error)
    return NextResponse.json({ message: 'Processing error' }, { status: 500 })
  }
}
