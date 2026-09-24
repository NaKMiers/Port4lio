import 'server-only'

import { connectDatabase } from '@/lib/mongodb'
import { IqPaymentModel } from '@/models/IqPayment'
import { PaymentModel } from '@/models/Payment'

/**
 * `find_order`: ONE order by its PayOS order code, for a support question - is it paid, and did
 * the result email go out (mcp.md premise 5, acceptance.md ask 10).
 *
 * ```
 *   orderCode ──▶ Payment (MBTI) ──▶ IqPayment (IQ)        an explicit ALLOWLIST projection:
 *                                                          orderCode amount status createdAt
 *                                                          paidAt resultEmailedAt
 *   resultEmailedAt   Date     ──▶ sent at <time>
 *                     null     ──▶ not sent (fulfilment logged a delivery failure)
 *                     absent   ──▶ not recorded (paid before the field existed, D2)
 * ```
 *
 * Never the buyer's email, never the certificate name, never the attempt token (which is the
 * capability that opens someone's result page). The projection is an allowlist so a field added
 * to the payment models later is private by default, the same rule as `PUBLIC_PROFILE_FIELDS`.
 * Lookup by email is deliberately absent until the privacy pages disclose AI-assisted support
 * lookups (mcp-plan.md "NOT in scope").
 */

const ORDER_FIELDS = {
  _id: 0,
  orderCode: 1,
  amount: 1,
  status: 1,
  createdAt: 1,
  paidAt: 1,
  resultEmailedAt: 1,
} as const

export interface OrderSummary {
  product: 'mbti' | 'iq'
  orderCode: number
  amount: number
  currency: 'VND'
  status: string
  createdAt: string | null
  paidAt: string | null
  resultEmail: string
}

type OrderRow = {
  orderCode: number
  amount: number
  status: string
  createdAt?: Date
  paidAt?: Date | null
  resultEmailedAt?: Date | null
}

function describeEmail(row: OrderRow): string {
  if (row.status !== 'paid') return 'not applicable - the order is not paid'
  if (row.resultEmailedAt instanceof Date)
    return `sent at ${row.resultEmailedAt.toISOString()}`
  if (!('resultEmailedAt' in row))
    return 'not recorded - this order was paid before result emails were tracked'
  return 'not sent - fulfilment logged a delivery failure; the result page still opens from its link'
}

export async function findOrder(
  orderCode: number
): Promise<OrderSummary | null> {
  await connectDatabase()
  const [mbti, iq] = await Promise.all([
    PaymentModel.findOne({ orderCode }, ORDER_FIELDS).lean<OrderRow>(),
    IqPaymentModel.findOne({ orderCode }, ORDER_FIELDS).lean<OrderRow>(),
  ])
  const row = mbti ?? iq
  if (!row) return null
  return {
    product: mbti ? 'mbti' : 'iq',
    orderCode: row.orderCode,
    amount: row.amount,
    currency: 'VND',
    status: row.status,
    createdAt: row.createdAt ? row.createdAt.toISOString() : null,
    paidAt: row.paidAt ? row.paidAt.toISOString() : null,
    resultEmail: describeEmail(row),
  }
}
