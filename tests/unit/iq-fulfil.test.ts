import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fulfilIqPayment } from '@/lib/iq/fulfil'

/**
 * IQ fulfilment decisions, the sibling of `payos-fulfil.test.ts`.
 *
 * The two functions are near-identical by design, so this file deliberately asserts the
 * same properties: who wins the claim, what a mismatched amount does, and what happens when
 * delivery fails after the money has landed. If one of these passes here and fails there,
 * the two products have drifted and one of them is losing payments.
 *
 * What is specific to IQ is the write: paying unlocks the result AND issues the certificate
 * in one update, because they are one purchase.
 */

const { paymentModel, attemptModel } = vi.hoisted(() => ({
  paymentModel: {
    findOne: vi.fn(),
    findOneAndUpdate: vi.fn(),
  },
  attemptModel: {
    findById: vi.fn(),
    findByIdAndUpdate: vi.fn(),
  },
}))

vi.mock('@/models/IqPayment', () => ({
  IqPaymentModel: paymentModel,
}))
vi.mock('@/models/IqAttempt', () => ({
  IqAttemptModel: attemptModel,
}))

const ORDER_CODE = 1_700_000_000_123
const TOKEN = 'AbCd1234EfGh5678IjKl90'

function payment(overrides: Record<string, unknown> = {}) {
  return {
    orderCode: ORDER_CODE,
    attemptToken: TOKEN,
    email: 'buyer@example.com',
    certificateName: 'Nguyen Van A',
    amount: 5000,
    status: 'pending',
    locale: 'vi',
    ...overrides,
  }
}

/** `findOne(...).lean()` */
function findOneReturns(value: unknown) {
  paymentModel.findOne.mockReturnValueOnce({
    lean: () => Promise.resolve(value),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  attemptModel.findById.mockReturnValue({ lean: () => Promise.resolve(null) })
  attemptModel.findByIdAndUpdate.mockResolvedValue({
    _id: TOKEN,
    paid: true,
    certificateId: 'cert-id',
  })
})

describe('fulfilIqPayment', () => {
  it('fulfils a pending payment and delivers the result', async () => {
    findOneReturns(payment())
    paymentModel.findOneAndUpdate.mockResolvedValueOnce(
      payment({ status: 'paid' })
    )
    const deliver = vi.fn().mockResolvedValue(undefined)

    const result = await fulfilIqPayment(
      { orderCode: ORDER_CODE, amount: 5000 },
      deliver
    )

    expect(result.outcome).toBe('fulfilled')
    expect(deliver).toHaveBeenCalledOnce()
  })

  it('unlocks the result and issues the certificate in one write', async () => {
    // One update, because it is one purchase. Unlocking without minting would leave a buyer
    // who paid for both holding one, with no record of which half is missing.
    findOneReturns(payment())
    paymentModel.findOneAndUpdate.mockResolvedValueOnce(
      payment({ status: 'paid' })
    )

    await fulfilIqPayment({ orderCode: ORDER_CODE, amount: 5000 }, vi.fn())

    const [token, update] = attemptModel.findByIdAndUpdate.mock.calls[0]
    expect(token).toBe(TOKEN)
    expect(update.$set.paid).toBe(true)
    expect(update.$set.email).toBe('buyer@example.com')
    expect(update.$set.certificateName).toBe('Nguyen Van A')
    expect(typeof update.$set.certificateId).toBe('string')
    expect(update.$set.certificateId).not.toBe(TOKEN)
  })

  it('does not extend the attempt retention', async () => {
    // Paying opens the result; it does not buy indefinite storage of the answers. The email
    // is the buyer's permanent copy, and the certificate lives on its own id.
    findOneReturns(payment())
    paymentModel.findOneAndUpdate.mockResolvedValueOnce(
      payment({ status: 'paid' })
    )

    await fulfilIqPayment({ orderCode: ORDER_CODE, amount: 5000 }, vi.fn())

    const update = attemptModel.findByIdAndUpdate.mock.calls[0][1]
    expect(Object.keys(update.$set)).not.toContain('expireAt')
  })

  it('claims atomically on "not already paid", not on "pending"', async () => {
    findOneReturns(payment({ status: 'cancelled' }))
    paymentModel.findOneAndUpdate.mockResolvedValueOnce(
      payment({ status: 'paid' })
    )

    await fulfilIqPayment({ orderCode: ORDER_CODE, amount: 5000 }, vi.fn())

    expect(paymentModel.findOneAndUpdate).toHaveBeenCalledWith(
      { orderCode: ORDER_CODE, status: { $ne: 'paid' } },
      expect.anything(),
      expect.anything()
    )
  })

  it('clears the payment TTL so a paid record is kept', async () => {
    findOneReturns(payment())
    paymentModel.findOneAndUpdate.mockResolvedValueOnce(
      payment({ status: 'paid' })
    )

    await fulfilIqPayment({ orderCode: ORDER_CODE, amount: 5000 }, vi.fn())

    const update = paymentModel.findOneAndUpdate.mock.calls[0][1]
    expect(update.$set.expireAt).toBeNull()
    expect(update.$set.status).toBe('paid')
  })

  it('reports an unknown order code without throwing', async () => {
    // The webhook is shared with MBTI and also receives PayOS's registration ping, which
    // must get a 2XX.
    findOneReturns(null)

    const result = await fulfilIqPayment(
      { orderCode: 1, amount: 5000 },
      vi.fn()
    )

    expect(result.outcome).toBe('unknown-order-code')
    expect(paymentModel.findOneAndUpdate).not.toHaveBeenCalled()
  })

  it('refuses to fulfil when the amount does not match', async () => {
    findOneReturns(payment({ amount: 5000 }))
    const deliver = vi.fn()

    const result = await fulfilIqPayment(
      { orderCode: ORDER_CODE, amount: 1 },
      deliver
    )

    expect(result.outcome).toBe('amount-mismatch')
    expect(paymentModel.findOneAndUpdate).not.toHaveBeenCalled()
    expect(deliver).not.toHaveBeenCalled()
  })

  it('is idempotent for an already-paid payment', async () => {
    findOneReturns(payment({ status: 'paid' }))
    const deliver = vi.fn()

    const result = await fulfilIqPayment(
      { orderCode: ORDER_CODE, amount: 5000 },
      deliver
    )

    expect(result.outcome).toBe('already-processed')
    // No second certificate, and no second email because PayOS retried.
    expect(attemptModel.findByIdAndUpdate).not.toHaveBeenCalled()
    expect(deliver).not.toHaveBeenCalled()
  })

  it('does not double-deliver when another worker wins the claim', async () => {
    findOneReturns(payment())
    paymentModel.findOneAndUpdate.mockResolvedValueOnce(null)
    const deliver = vi.fn()

    const result = await fulfilIqPayment(
      { orderCode: ORDER_CODE, amount: 5000 },
      deliver
    )

    expect(result.outcome).toBe('already-processed')
    expect(attemptModel.findByIdAndUpdate).not.toHaveBeenCalled()
    expect(deliver).not.toHaveBeenCalled()
  })

  it('returns delivery-failed rather than throwing when the email fails', async () => {
    // A throw here makes the webhook answer 500, PayOS retries, the retry finds the row
    // already paid and reports success - so the payment reads as delivered while the buyer
    // got nothing and nobody was told.
    findOneReturns(payment())
    paymentModel.findOneAndUpdate.mockResolvedValueOnce(
      payment({ status: 'paid' })
    )
    const deliver = vi.fn().mockRejectedValue(new Error('SMTP down'))

    const result = await fulfilIqPayment(
      { orderCode: ORDER_CODE, amount: 5000 },
      deliver
    )

    expect(result.outcome).toBe('delivery-failed')
    expect(result.message).toContain('SMTP down')
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('PAID BUT UNDELIVERED')
    )
  })

  it('reports delivery-failed, and does not email, when the attempt has vanished', async () => {
    // Paid for a result that expired between checkout and settlement. Real money, nothing
    // to unlock - a refund conversation, not something to swallow.
    findOneReturns(payment())
    paymentModel.findOneAndUpdate.mockResolvedValueOnce(
      payment({ status: 'paid' })
    )
    attemptModel.findByIdAndUpdate.mockResolvedValueOnce(null)
    const deliver = vi.fn()

    const result = await fulfilIqPayment(
      { orderCode: ORDER_CODE, amount: 5000 },
      deliver
    )

    expect(result.outcome).toBe('delivery-failed')
    expect(deliver).not.toHaveBeenCalled()
  })

  it('never throws, whatever the database does', async () => {
    findOneReturns(payment())
    paymentModel.findOneAndUpdate.mockResolvedValueOnce(
      payment({ status: 'paid' })
    )
    attemptModel.findByIdAndUpdate.mockRejectedValueOnce(
      new Error('connection lost')
    )

    const result = await fulfilIqPayment(
      { orderCode: ORDER_CODE, amount: 5000 },
      vi.fn()
    )

    expect(result.outcome).toBe('delivery-failed')
  })
})
