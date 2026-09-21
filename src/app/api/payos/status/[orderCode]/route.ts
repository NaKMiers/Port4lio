import { NextResponse, type NextRequest } from 'next/server'

import { fulfilIqPayment, markIqPaymentCancelled } from '@/lib/iq/fulfil'
import { deliverIqResultEmail } from '@/lib/iq/result-email'
import { deliverResultEmail } from '@/lib/mbti/result-email'
import { connectDatabase } from '@/lib/mongodb'
import { getPaymentLinkInformation, isPayosConfigured } from '@/lib/payos'
import {
  fulfilMbtiPayment,
  markPayosPaymentCancelled,
} from '@/lib/payos-fulfil'
import { checkRateLimit, clientIpFrom, STATUS_LIMIT } from '@/lib/rate-limit'
import { IqPaymentModel, type IqPaymentDocument } from '@/models/IqPayment'
import {
  PaymentModel,
  type PaymentDocument,
  type PaymentStatus,
} from '@/models/Payment'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * [GET] /api/payos/status/:orderCode
 *
 * Polling fallback for the checkout panel. The webhook is the primary confirmation path;
 * this exists because local development has no public URL for PayOS to call, and because
 * a dropped webhook delivery must not strand a buyer who has already paid.
 *
 * Fulfilment runs through the same claim as the webhook, so the two racing can never
 * double-deliver.
 *
 * Serves BOTH products. Both share one PayOS merchant account, so an order code alone does
 * not say which collection it lives in, and `TestPaywall` polls one URL for both. MBTI is
 * looked up first and IQ only when that misses, which keeps the older, higher-volume path
 * at one query - the same routing order the webhook uses.
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

  if (!Number.isFinite(orderCode))
    return NextResponse.json({ message: 'Invalid order code' }, { status: 400 })

  await connectDatabase()

  const limit = await checkRateLimit(clientIpFrom(request), STATUS_LIMIT)
  if (!limit.ok)
    return NextResponse.json(
      { message: 'Too many requests' },
      {
        status: 429,
        headers: { 'Retry-After': String(limit.retryAfterSeconds) },
      }
    )

  const payment = (await PaymentModel.findOne({
    orderCode,
  }).lean()) as PaymentDocument | null

  if (!payment) {
    const iqPayment = (await IqPaymentModel.findOne({
      orderCode,
    }).lean()) as IqPaymentDocument | null

    if (!iqPayment)
      return NextResponse.json({ message: 'Not found' }, { status: 404 })

    return iqStatus(orderCode, iqPayment)
  }

  // Already settled locally - skip the outbound call entirely. This is the common case
  // once the webhook has landed, and it is what makes polling cheap.
  if (payment.status === 'paid')
    return NextResponse.json({ status: 'paid' }, { status: 200 })

  if (!isPayosConfigured())
    return NextResponse.json({ status: payment.status }, { status: 200 })

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

  return NextResponse.json(
    { status: refreshed?.status ?? status },
    { status: 200 }
  )
}

/**
 * The IQ half of the poller. Same three steps as the MBTI path above: short-circuit on a
 * locally settled payment, ask PayOS otherwise, then re-read so the answer reflects what
 * fulfilment actually wrote rather than what we hoped it would.
 */
async function iqStatus(orderCode: number, payment: IqPaymentDocument) {
  if (payment.status === 'paid')
    return NextResponse.json({ status: 'paid' }, { status: 200 })

  if (!isPayosConfigured())
    return NextResponse.json({ status: payment.status }, { status: 200 })

  let status: IqPaymentDocument['status'] = payment.status

  try {
    const info = await getPaymentLinkInformation(orderCode)

    if (info.status === 'PAID') {
      const latest = info.transactions?.[info.transactions.length - 1]
      const result = await fulfilIqPayment(
        {
          orderCode,
          amount: info.amountPaid ?? info.amount,
          reference: latest?.reference,
        },
        deliverIqResultEmail
      )

      // An amount mismatch is never "paid" as far as the buyer's UI is concerned, and the
      // webhook has already alerted on it.
      status = result.outcome === 'amount-mismatch' ? payment.status : 'paid'
    } else if (info.status === 'CANCELLED' || info.status === 'EXPIRED') {
      await markIqPaymentCancelled(orderCode)
      status = 'cancelled'
    }
  } catch (error) {
    // A gateway hiccup must not break the polling UI. Report the last known state and let
    // the next tick retry.
    console.error('[PayOS Status] IQ lookup failed:', error)
  }

  const refreshed = (await IqPaymentModel.findOne({ orderCode })
    .select('status')
    .lean()) as Pick<IqPaymentDocument, 'status'> | null

  return NextResponse.json(
    { status: refreshed?.status ?? status },
    { status: 200 }
  )
}
