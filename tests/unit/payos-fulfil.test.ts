import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fulfilMbtiPayment } from '@/lib/payos-fulfil'

/**
 * Fulfilment decisions: who wins the claim, what happens on a mismatched amount, and what
 * happens when delivery fails after the money has already landed.
 *
 * The Mongoose models are mocked so this runs with no database, mirroring
 * `AnphaShop/src/utils/payosFulfil.test.ts`. The behaviour under test is not "does Mongo
 * work" - it is the ordering, which is what decides whether a real payment can be silently
 * lost.
 */

/**
 * `vi.hoisted`, not plain consts: vitest lifts `vi.mock` factories above every import in
 * the file, so a factory closing over a normal `const` would run before that const is
 * initialised. This makes the mocks part of the hoisted block, which lets the module under
 * test be imported statically rather than through a top-level `await import()`.
 */
const { paymentModel, attemptModel } = vi.hoisted(() => ({
  paymentModel: {
    findOne: vi.fn(),
    findOneAndUpdate: vi.fn(),
  },
  attemptModel: {
    findByIdAndUpdate: vi.fn(),
  },
}))

vi.mock('@/models/Payment', () => ({
  PaymentModel: paymentModel,
}))
vi.mock('@/models/Attempt', () => ({
  AttemptModel: attemptModel,
}))

const ORDER_CODE = 1_700_000_000_123
const TOKEN = 'AbCd1234EfGh5678IjKl90'

function payment(overrides: Record<string, unknown> = {}) {
  return {
    _id: 'payment-id',
    orderCode: ORDER_CODE,
    attemptToken: TOKEN,
    email: 'buyer@example.com',
    amount: 2000,
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
  attemptModel.findByIdAndUpdate.mockResolvedValue({ _id: TOKEN, paid: true })
})

describe('fulfilMbtiPayment', () => {
  it('fulfils a pending payment and delivers the result', async () => {
    findOneReturns(payment())
    paymentModel.findOneAndUpdate.mockResolvedValueOnce(
      payment({ status: 'paid' })
    )
    const deliver = vi.fn().mockResolvedValue(undefined)

    const result = await fulfilMbtiPayment(
      { orderCode: ORDER_CODE, amount: 2000 },
      deliver
    )

    expect(result.outcome).toBe('fulfilled')
    expect(deliver).toHaveBeenCalledOnce()
  })

  it('claims atomically on "not already paid", not on "pending"', async () => {
    // A row we optimistically marked cancelled or expired must still be claimable: money
    // confirmed by the bank outranks our own guess about whether the link was alive.
    findOneReturns(payment({ status: 'cancelled' }))
    paymentModel.findOneAndUpdate.mockResolvedValueOnce(
      payment({ status: 'paid' })
    )

    await fulfilMbtiPayment({ orderCode: ORDER_CODE, amount: 2000 }, vi.fn())

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

    await fulfilMbtiPayment({ orderCode: ORDER_CODE, amount: 2000 }, vi.fn())

    const update = paymentModel.findOneAndUpdate.mock.calls[0][1]
    expect(update.$set.expireAt).toBeNull()
    expect(update.$set.status).toBe('paid')
  })

  it('unlocks the attempt without extending its retention', async () => {
    findOneReturns(payment())
    paymentModel.findOneAndUpdate.mockResolvedValueOnce(
      payment({ status: 'paid' })
    )

    await fulfilMbtiPayment({ orderCode: ORDER_CODE, amount: 2000 }, vi.fn())

    // Paying unlocks the result; it does not buy indefinite storage of the answers. An
    // earlier version cleared `expireAt` here, which meant a purchase silently opted the
    // buyer out of the retention promise the privacy notice makes. The email is their
    // permanent copy instead.
    expect(attemptModel.findByIdAndUpdate).toHaveBeenCalledWith(
      TOKEN,
      { $set: { paid: true } },
      expect.anything()
    )

    const update = attemptModel.findByIdAndUpdate.mock.calls[0][1]
    expect(Object.keys(update.$set)).not.toContain('expireAt')
  })

  it('reports an unknown order code without throwing', async () => {
    // PayOS posts a test payload when the webhook URL is registered. It must get a 2XX.
    findOneReturns(null)

    const result = await fulfilMbtiPayment(
      { orderCode: 1, amount: 2000 },
      vi.fn()
    )

    expect(result.outcome).toBe('unknown-order-code')
    expect(paymentModel.findOneAndUpdate).not.toHaveBeenCalled()
  })

  it('refuses to fulfil when the amount does not match', async () => {
    // Never trust the reported figure: it has to match the one we signed.
    findOneReturns(payment({ amount: 2000 }))
    const deliver = vi.fn()

    const result = await fulfilMbtiPayment(
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

    const result = await fulfilMbtiPayment(
      { orderCode: ORDER_CODE, amount: 2000 },
      deliver
    )

    expect(result.outcome).toBe('already-processed')
    // The buyer must not get a second copy because PayOS retried.
    expect(deliver).not.toHaveBeenCalled()
  })

  it('does not double-deliver when another worker wins the claim', async () => {
    // The webhook and the poller racing: findOne saw it unpaid, findOneAndUpdate lost.
    findOneReturns(payment())
    paymentModel.findOneAndUpdate.mockResolvedValueOnce(null)
    const deliver = vi.fn()

    const result = await fulfilMbtiPayment(
      { orderCode: ORDER_CODE, amount: 2000 },
      deliver
    )

    expect(result.outcome).toBe('already-processed')
    expect(deliver).not.toHaveBeenCalled()
  })

  it('returns delivery-failed rather than throwing when the email fails', async () => {
    // The critical one. A throw here makes the webhook answer 500, PayOS retries, the retry
    // finds the row already paid and reports success - so the payment reads as delivered
    // while the buyer got nothing and nobody was told.
    findOneReturns(payment())
    paymentModel.findOneAndUpdate.mockResolvedValueOnce(
      payment({ status: 'paid' })
    )
    const deliver = vi.fn().mockRejectedValue(new Error('SMTP down'))

    const result = await fulfilMbtiPayment(
      { orderCode: ORDER_CODE, amount: 2000 },
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

    const result = await fulfilMbtiPayment(
      { orderCode: ORDER_CODE, amount: 2000 },
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

    const result = await fulfilMbtiPayment(
      { orderCode: ORDER_CODE, amount: 2000 },
      vi.fn()
    )

    expect(result.outcome).toBe('delivery-failed')
  })
})
