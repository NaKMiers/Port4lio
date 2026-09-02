import { FUNNEL_EVENTS, recordFunnelDetached } from '@/lib/test-events'
import { AttemptModel } from '@/models/Attempt'
import { PaymentModel, type PaymentDocument } from '@/models/Payment'

/**
 * The single fulfilment path, shared by the webhook and the polling fallback.
 *
 * Correctness hinges on the atomic `!= paid -> paid` claim below. The webhook, its
 * retries, and the status poller can all arrive at once, and exactly one must win.
 * Do NOT split it into a read-then-write.
 *
 * ```
 *   webhook ─┐
 *   retry   ─┼──▶ findOneAndUpdate({orderCode, status: {$ne:'paid'}})  ── exactly one wins
 *   poller  ─┘                    │
 *                                 ▼
 *                    Attempt.paid = true, expireAt = null
 *                                 ▼
 *                          send result email
 * ```
 */

export type FulfilOutcome =
  /** We claimed this payment and delivered it. */
  | 'fulfilled'
  /** Someone else claimed it first. A safe no-op. */
  | 'already-processed'
  /** Not ours - most often PayOS's webhook-registration test ping. */
  | 'unknown-order-code'
  /** Paid amount does not match what we signed. Never fulfilled. */
  | 'amount-mismatch'
  /** Money captured, the email did not go out. Needs a human. */
  | 'delivery-failed'

export type FulfilResult = {
  outcome: FulfilOutcome
  payment?: PaymentDocument
  message?: string
}

export type FulfilInput = {
  orderCode: number
  amount: number
  reference?: string
  transactionDateTime?: string
}

export async function payosOrderCodeIsTaken(orderCode: number): Promise<boolean> {
  return !!(await PaymentModel.findOne({ orderCode }).select('_id').lean())
}

/**
 * Delivery is injected so this module can be unit-tested without a mail server, and so the
 * import graph does not drag nodemailer into anything that merely wants the outcome type.
 */
export type ResultDeliverer = (payment: PaymentDocument) => Promise<void>

export async function fulfilMbtiPayment(
  input: FulfilInput,
  deliver: ResultDeliverer
): Promise<FulfilResult> {
  const { orderCode, amount, reference, transactionDateTime } = input

  const existing = (await PaymentModel.findOne({ orderCode }).lean()) as PaymentDocument | null

  // PayOS posts an arbitrary payload when the webhook URL is registered, and links can
  // outlive cleanup. Neither is an error, and both must still get a 2XX.
  if (!existing) return { outcome: 'unknown-order-code' }

  // Never trust the reported amount: it has to match the figure we signed.
  if (Math.round(amount) !== Math.round(existing.amount)) {
    return {
      outcome: 'amount-mismatch',
      payment: existing,
      message: `Amount mismatch (received ${amount}, expected ${existing.amount})`,
    }
  }

  if (existing.status === 'paid') {
    return { outcome: 'already-processed', payment: existing }
  }

  // `$ne: 'paid'` rather than `status: 'pending'`: a row we optimistically marked
  // cancelled or expired must still be claimable. Money confirmed by the bank outranks our
  // own guess about whether the link was still alive, and claiming on 'pending' alone
  // silently drops those payments.
  const claimed = (await PaymentModel.findOneAndUpdate(
    { orderCode, status: { $ne: 'paid' } },
    {
      $set: {
        status: 'paid',
        paidAt: new Date(),
        // A paid record is a financial record. Clearing the TTL anchor keeps it.
        expireAt: null,
        ...(reference ? { reference } : {}),
        ...(transactionDateTime ? { transactionDateTime } : {}),
      },
    },
    { new: true, lean: true }
  )) as PaymentDocument | null

  if (!claimed) return { outcome: 'already-processed', payment: existing }

  // From here nothing may escape as an exception.
  //
  // The row is already claimed. A throw would make the webhook answer 500, PayOS would
  // retry, and the retry would find the row already 'paid' and report success - so the
  // payment reads as delivered while the buyer never got anything and nobody was told.
  // Every step below is individually guarded for that reason.
  let failure: string | null = null
  let unlockedNow = false

  try {
    // Unlocking the result is what the buyer actually paid for, so it happens before the
    // email and is the thing worth retrying hardest.
    //
    // `expireAt` is deliberately NOT touched: a purchase unlocks the result, it does not
    // extend how long we keep the answers. The email below is the buyer's permanent copy,
    // and one retention rule for paid and free alike is what lets the privacy notice state
    // a single number.
    const unlocked = await AttemptModel.findByIdAndUpdate(
      claimed.attemptToken,
      { $set: { paid: true } },
      { new: true, lean: true }
    )

    if (!unlocked) {
      // The attempt expired or was deleted between checkout and payment. The money is
      // real, so this is a refund conversation, not something to swallow.
      failure = `Attempt ${claimed.attemptToken} no longer exists - paid result cannot be unlocked`
    } else {
      unlockedNow = true
    }
  } catch (error) {
    console.error(`[PayOS Fulfil] Unlock threw for ${orderCode}:`, error)
    failure = error instanceof Error ? error.message : 'Unknown error unlocking the attempt'
  }

  /**
   * The funnel's terminal event, counted here and ONLY here.
   *
   * Outside the try above, and detached, for two reasons. The webhook retries when
   * responses are slow, so it must not wait on a counter. And that `catch` sets `failure`,
   * which is what logs PAID BUT UNDELIVERED - a metrics blip must never be reported as a
   * payment that did not settle.
   *
   * Gated on `unlockedNow` so the atomic claim above is what decides: a duplicate webhook
   * that loses the claim race counts nothing.
   *
   * `paid` is the number a pricing decision gets made from, so it is written by server
   * code no request can reach - `/api/event` refuses it outright. A forged row would be
   * indistinguishable from a real one afterward, making the funnel quietly worthless
   * rather than obviously broken.
   */
  if (unlockedNow) {
    recordFunnelDetached('mbti', FUNNEL_EVENTS.paid)
  }

  if (!failure) {
    try {
      await deliver(claimed)
    } catch (error) {
      console.error(`[PayOS Fulfil] Result email failed for ${orderCode}:`, error)
      failure = error instanceof Error ? error.message : 'Unknown error sending the result email'
    }
  }

  if (failure) {
    // The result page still unlocks on the next visit if the attempt survived - the link
    // is a capability, not an email-gated one - so a failed email is degraded, not lost.
    // It is still loud, because the buyer may be waiting on an inbox that stays empty.
    console.error(
      `[PayOS Fulfil] PAID BUT UNDELIVERED orderCode=${orderCode} attempt=${claimed.attemptToken} amount=${claimed.amount}: ${failure}`
    )
    return { outcome: 'delivery-failed', payment: claimed, message: failure }
  }

  return { outcome: 'fulfilled', payment: claimed }
}

/** Only a still-pending payment can be cancelled; never downgrade a paid one. */
export async function markPayosPaymentCancelled(orderCode: number): Promise<void> {
  await PaymentModel.findOneAndUpdate(
    { orderCode, status: 'pending' },
    { $set: { status: 'cancelled' } }
  )
}
