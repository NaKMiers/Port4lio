import { NextResponse, type NextRequest } from 'next/server'

import { deliverResultEmail } from '@/lib/mbti/result-email'
import { connectDatabase } from '@/lib/mongodb'
import { getPaymentLinkInformation, isPayosConfigured } from '@/lib/payos'
import { fulfilMbtiPayment, markPayosPaymentCancelled } from '@/lib/payos-fulfil'
import { checkRateLimit, clientIpFrom, STATUS_LIMIT } from '@/lib/rate-limit'
import { PaymentModel, type PaymentDocument, type PaymentStatus } from '@/models/Payment'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * [GET] /api/payos/status/:orderCode
 *
 * Polling fallback for the checkout panel. The webhook is the primary confirmation path;
 * this exists because local development has no public URL for PayOS to call, and because
 * a dropped webhook delivery must not strand a buyer who has already paid.
 *
 * Fulfilment runs through the same `fulfilMbtiPayment` claim as the webhook, so the two
 * racing can never double-deliver.
 *
 * Returns only a status string. The order code is guessable in principle - it is a
 * timestamp - so this must never leak the buyer's email or the result itself.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orderCode: string }> }
) {
  const { orderCode: rawOrderCode } = await params
  const orderCode = Number(rawOrderCode)

  if (!Number.isFinite(orderCode)) {
    return NextResponse.json({ message: 'Invalid order code' }, { status: 400 })
  }

  await connectDatabase()

  const limit = await checkRateLimit(clientIpFrom(request), STATUS_LIMIT)
  if (!limit.ok) {
    return NextResponse.json(
      { message: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
    )
  }

  const payment = (await PaymentModel.findOne({ orderCode }).lean()) as PaymentDocument | null

  if (!payment) {
    return NextResponse.json({ message: 'Not found' }, { status: 404 })
  }

  // Already settled locally - skip the outbound call entirely. This is the common case
  // once the webhook has landed, and it is what makes polling cheap.
  if (payment.status === 'paid') {
    return NextResponse.json({ status: 'paid' }, { status: 200 })
  }

  if (!isPayosConfigured()) {
    return NextResponse.json({ status: payment.status }, { status: 200 })
  }

  // Annotated because the `=== 'paid'` early return above narrows `payment.status` down to
  // the unpaid states, and this variable has to be able to hold 'paid' again.
  let status: PaymentStatus = payment.status

  try {
    const info = await getPaymentLinkInformation(orderCode)

    if (info.status === 'PAID') {
      const latest = info.transactions?.[info.transactions.length - 1]
      const result = await fulfilMbtiPayment(
        {
          orderCode,
          amount: info.amountPaid ?? info.amount,
          reference: latest?.reference,
          transactionDateTime: latest?.transactionDateTime,
        },
        deliverResultEmail
      )

      // An amount mismatch is never "paid" as far as the buyer's UI is concerned, and the
      // webhook has already alerted on it.
      status = result.outcome === 'amount-mismatch' ? payment.status : 'paid'
    } else if (info.status === 'CANCELLED' || info.status === 'EXPIRED') {
      await markPayosPaymentCancelled(orderCode)
      status = 'cancelled'
    }
  } catch (error) {
    // A gateway hiccup must not break the polling UI. Report the last known state and let
    // the next tick retry.
    console.error('[PayOS Status] Lookup failed:', error)
  }

  const refreshed = (await PaymentModel.findOne({ orderCode })
    .select('status')
    .lean()) as Pick<PaymentDocument, 'status'> | null

  return NextResponse.json({ status: refreshed?.status ?? status }, { status: 200 })
}
