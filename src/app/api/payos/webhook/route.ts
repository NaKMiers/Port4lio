import { NextResponse, type NextRequest } from 'next/server'

import { deliverResultEmail } from '@/lib/mbti/result-email'
import { connectDatabase } from '@/lib/mongodb'
import { verifyPayosData, type PayosWebhookBody } from '@/lib/payos'
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

  if (!Number.isFinite(orderCode) || !Number.isFinite(amount)) {
    return NextResponse.json({ message: 'Invalid payload' }, { status: 400 })
  }

  try {
    await connectDatabase()

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

      // PayOS posts an arbitrary payload when the webhook URL is registered, and it must
      // still receive a 2XX or registration fails.
      case 'unknown-order-code':
        console.info(`[PayOS Webhook] No payment for ${orderCode} (registration ping?)`)
        break

      // Someone paid an amount we never asked for. Not fulfilled, and loud: this is either
      // a bug in our own amount handling or someone probing the endpoint.
      case 'amount-mismatch':
        console.error(`[PayOS Webhook] AMOUNT MISMATCH on ${orderCode}: ${result.message}`)
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
    return NextResponse.json({ success: true, outcome: result.outcome }, { status: 200 })
  } catch (error) {
    // A genuine server-side failure - database down, most likely. Let PayOS retry, because
    // this one really might succeed next time.
    console.error('[PayOS Webhook] Processing error:', error)
    return NextResponse.json({ message: 'Processing error' }, { status: 500 })
  }
}
