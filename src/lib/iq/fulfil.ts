import { FUNNEL_EVENTS, recordFunnelDetached } from '@/lib/test-events'
import { mintToken } from '@/lib/tokens'
import { IqAttemptModel } from '@/models/IqAttempt'
import { IqPaymentModel, type IqPaymentDocument } from '@/models/IqPayment'

/**
 * Turning a paid IQ order into an unlocked result and its certificate.
 *
 * ```
 *   webhook ─┐
 *   retry   ─┼──▶ findOneAndUpdate({orderCode, status: {$ne:'paid'}})  ── exactly one wins
 *   poller  ─┘                    │
 *                                 ▼
 *              IqAttempt.paid = true, email, certificateId, certificateName
 *                                 ▼
 *                          send result email
 * ```
 *
 * A deliberate mirror of `payos-fulfil.ts`, step for step, because both products now sell
 * the same thing: the result. The two are separate functions only because they write to
 * different collections - if you change the claim logic in one, change it in the other.
 *
 * ## The atomic claim
 *
 * The webhook, its retries, and the status poller can all arrive at once. `findOneAndUpdate`
 * with the status in the FILTER is what makes exactly one of them the winner. A
 * read-then-write here would mint two certificate ids for one payment, and the unique
 * partial index on `certificateId` would reject the second write - turning a race into a
 * 500 on a payment that already succeeded.
 *
 * `$ne: 'paid'` rather than `status: 'pending'`: a row we optimistically marked cancelled
 * or expired must still be claimable. Money confirmed by the bank outranks our own guess
 * about whether the link was still alive.
 *
 * ## Why the certificate id is minted here and not at checkout
 *
 * A certificate id is public and permanent. Minting it at checkout would create a
 * verifiable-looking id for an order that may never be paid, and `/iq/verify/<id>` would
 * have to decide what to say about it. Minting on payment means the id exists only for
 * certificates that are real.
 */

export type IqFulfilOutcome =
  /** We claimed this payment and delivered it. */
  | 'fulfilled'
  /** Someone else claimed it first. A safe no-op. */
  | 'already-processed'
  /** Not ours - most often PayOS's webhook-registration test ping. */
  | 'unknown-order-code'
  /** Paid amount does not match what we signed. Never fulfilled. */
  | 'amount-mismatch'
  /** Money captured, the result could not be unlocked or mailed. Needs a human. */
  | 'delivery-failed'

export type IqFulfilResult = {
  outcome: IqFulfilOutcome
  payment?: IqPaymentDocument
  certificateId?: string
  message?: string
}

export type IqFulfilInput = {
  orderCode: number
  amount: number
  reference?: string
}

/**
 * Delivery is injected so this module can be unit-tested without a mail server, and so the
 * import graph does not drag nodemailer and React into anything that merely wants the
 * outcome type.
 */
export type IqResultDeliverer = (payment: IqPaymentDocument) => Promise<void>

export async function fulfilIqPayment(
  input: IqFulfilInput,
  deliver: IqResultDeliverer
): Promise<IqFulfilResult> {
  const { orderCode, amount, reference } = input

  const existing = (await IqPaymentModel.findOne({
    orderCode,
  }).lean()) as IqPaymentDocument | null

  // PayOS pings an arbitrary order code when a webhook URL is registered, and it must get a
  // 2XX or registration fails. So this is a normal outcome, not an error.
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
    const attempt = await IqAttemptModel.findById(existing.attemptToken).lean()
    return {
      outcome: 'already-processed',
      payment: existing,
      certificateId: attempt?.certificateId ?? undefined,
    }
  }

  const claimed = (await IqPaymentModel.findOneAndUpdate(
    { orderCode, status: { $ne: 'paid' } },
    {
      $set: {
        status: 'paid',
        paidAt: new Date(),
        // A paid record is a financial record. Clearing the TTL anchor keeps it.
        expireAt: null,
        ...(reference ? { reference } : {}),
      },
    },
    { new: true, lean: true }
  )) as IqPaymentDocument | null

  // Lost the race. Whoever won is completing it, so this is success from here.
  if (!claimed) {
    const attempt = await IqAttemptModel.findById(existing.attemptToken).lean()
    return {
      outcome: 'already-processed',
      payment: existing,
      certificateId: attempt?.certificateId ?? undefined,
    }
  }

  // From here nothing may escape as an exception.
  //
  // The row is already claimed. A throw would make the webhook answer 500, PayOS would
  // retry, and the retry would find the row already 'paid' and report success - so the
  // payment reads as delivered while the buyer never got anything and nobody was told.
  // Every step below is individually guarded for that reason.
  let failure: string | null = null
  let unlockedNow = false
  let certificateId: string | undefined

  try {
    const mintedId = mintToken()

    /**
     * One write for the whole purchase: the unlock, the buyer's address, and the
     * certificate.
     *
     * They go together because they are one product. Unlocking the result but failing to
     * mint the certificate would leave a buyer who paid for both holding one, with no
     * record of which half is missing.
     *
     * `expireAt` is deliberately NOT touched: a purchase unlocks the result, it does not
     * extend how long we keep the answers. The email is the buyer's permanent copy, and one
     * retention rule for paid and free alike is what lets the privacy notice state a single
     * number. The certificate outlives the attempt on its own row.
     */
    const unlocked = await IqAttemptModel.findByIdAndUpdate(
      claimed.attemptToken,
      {
        $set: {
          paid: true,
          email: claimed.email,
          certificateId: mintedId,
          certificateName: claimed.certificateName,
          certificateIssuedAt: new Date(),
        },
      },
      { new: true, lean: true }
    )

    if (!unlocked) {
      // The attempt expired or was deleted between checkout and payment. The money is
      // real, so this is a refund conversation, not something to swallow.
      failure = `Attempt ${claimed.attemptToken} no longer exists - paid result cannot be unlocked`
    } else {
      unlockedNow = true
      // Read back rather than trusting `mintedId`: if a concurrent path already issued a
      // certificate for this attempt, the stored id is the one that is public.
      certificateId = unlocked.certificateId ?? mintedId
    }
  } catch (error) {
    console.error(`[IQ Fulfil] Unlock threw for ${orderCode}:`, error)
    failure = error instanceof Error ? error.message : 'Unknown error unlocking the attempt'
  }

  /**
   * The funnel's terminal event, counted here and ONLY here.
   *
   * Outside the try above, and detached, for the same two reasons as MBTI: the webhook
   * retries when responses are slow, so it must not wait on a counter; and that `catch`
   * sets `failure`, which is what logs PAID BUT UNDELIVERED - a metrics blip must never be
   * reported as a payment that did not settle.
   */
  if (unlockedNow) {
    recordFunnelDetached('iq', FUNNEL_EVENTS.paid)
  }

  if (!failure) {
    try {
      await deliver(claimed)
    } catch (error) {
      console.error(`[IQ Fulfil] Result email failed for ${orderCode}:`, error)
      failure = error instanceof Error ? error.message : 'Unknown error sending the result email'
    }
  }

  if (failure) {
    // The result page still unlocks on the next visit if the attempt survived - the link is
    // a capability - so a failed email is degraded, not lost. It is still loud, because the
    // buyer may be waiting on an inbox that stays empty.
    console.error(
      `[IQ Fulfil] PAID BUT UNDELIVERED orderCode=${orderCode} attempt=${claimed.attemptToken} amount=${claimed.amount}: ${failure}`
    )
    return { outcome: 'delivery-failed', payment: claimed, certificateId, message: failure }
  }

  return { outcome: 'fulfilled', payment: claimed, certificateId }
}

/** Only a still-pending payment can be cancelled; never downgrade a paid one. */
export async function markIqPaymentCancelled(orderCode: number): Promise<void> {
  await IqPaymentModel.findOneAndUpdate(
    { orderCode, status: 'pending' },
    { $set: { status: 'cancelled' } }
  )
}

/** Whether an order code is already in use, so checkout can retry with a fresh one. */
export async function iqOrderCodeIsTaken(orderCode: number): Promise<boolean> {
  return Boolean(await IqPaymentModel.exists({ orderCode }))
}
