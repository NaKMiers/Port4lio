import mongoose, { Schema } from 'mongoose'

/**
 * One PayOS payment intent for one paid IQ result.
 *
 * ```
 *   POST /api/iq/checkout {token, email, name}
 *        │
 *        ▼
 *   IqPayment { orderCode, attemptToken, email, certificateName, amount, status: 'pending' }
 *        │
 *        │  PayOS webhook / status poll
 *        ▼
 *   status: 'paid' ──▶ IqAttempt.paid = true, email, certificateId = <new public id>
 *                  └─▶ /[lang]/iq/result/<token>  +  /[lang]/iq/certificate/<publicId>
 * ```
 *
 * ## Its own collection, not a `purpose` field on `Payment`
 *
 * The CEO review cut the collection migration from this phase, so `Payment` keeps its MBTI
 * shape and IQ gets `iqPayments`. The two documents now hold nearly the same fields, which
 * is the cost of that decision and a deliberate one: merging them would mean migrating
 * live MBTI payment records, and a bug in that migration is unrecoverable in a way a
 * duplicated schema is not.
 *
 * ## What is stored
 *
 * `email` is required, exactly as on `Payment`: the buyer is paying for a result and gets a
 * permanent copy mailed to them, so an address is part of the purchase rather than an
 * extra.
 *
 * `certificateName` is the display name for the certificate that comes with the result. It
 * is held here rather than on the attempt until payment lands, so an attempt that never
 * completes checkout leaves nothing identifying behind - the same rule `Attempt` follows.
 *
 * `orderCode` carries the unique index: it is the only field PayOS's webhook sends that
 * identifies an order, and two concurrent checkouts sharing one would settle the wrong
 * result.
 */

export type IqPaymentStatus = 'pending' | 'paid' | 'cancelled' | 'expired'

export type IqPaymentDocument = {
  orderCode: number
  attemptToken: string
  /** Where the buyer's permanent copy is sent. */
  email: string
  /** The name that goes on the certificate. Public by the buyer's choice, once paid. */
  certificateName: string
  amount: number
  status: IqPaymentStatus
  /** The locale the buyer was reading when they paid. Decides the email's language. */
  locale: string

  // From the create-link response, so the checkout panel can render a QR and the transfer
  // details without calling PayOS again on every poll.
  paymentLinkId?: string
  checkoutUrl?: string
  qrCode?: string
  bin?: string
  accountNumber?: string
  accountName?: string
  /** PayOS's own memo string. A manual transfer must carry it verbatim to be matched. */
  transferDescription?: string

  reference?: string
  paidAt?: Date | null
  /**
   * When the result email was handed to the mail server, stamped by the fulfilment path after
   * `deliver` succeeds (acceptance.md D2). `null` on a paid order means it was not sent - or
   * that the order was paid before this field existed, which `find_order` reports as "not
   * recorded". Never the address itself.
   */
  resultEmailedAt?: Date | null
  createdAt: Date
  /**
   * When the PayOS link stops being payable. Drives the countdown in the checkout panel.
   *
   * Easy to confuse with `expireAt` below: this one is minutes away and governs whether the
   * QR still works; `expireAt` is days away and governs when Mongo deletes the row.
   */
  linkExpiresAt: Date
  /** Unpaid intents self-clean. A paid one is kept as a financial record. */
  expireAt: Date | null
}

/** An abandoned checkout is worthless after a week; the PayOS link is long dead by then. */
const UNPAID_TTL_DAYS = 7

export function unpaidIqPaymentExpiryFrom(now: Date): Date {
  return new Date(now.getTime() + UNPAID_TTL_DAYS * 24 * 60 * 60 * 1000)
}

const iqPaymentSchema = new Schema(
  {
    orderCode: { type: Number, required: true, unique: true },
    attemptToken: { type: String, required: true, index: true },
    email: { type: String, required: true },
    certificateName: { type: String, required: true },
    amount: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      required: true,
      enum: ['pending', 'paid', 'cancelled', 'expired'],
      default: 'pending',
    },
    locale: { type: String, required: true },

    paymentLinkId: { type: String },
    checkoutUrl: { type: String },
    qrCode: { type: String },
    bin: { type: String },
    accountNumber: { type: String },
    accountName: { type: String },
    transferDescription: { type: String },

    reference: { type: String },
    paidAt: { type: Date, default: null },
    resultEmailedAt: { type: Date, default: null },

    linkExpiresAt: { type: Date, required: true },
    createdAt: { type: Date, default: Date.now },
    expireAt: { type: Date, default: null },
  },
  {
    collection: 'iqPayments',
    versionKey: false,
  }
)

/**
 * Tiered retention, the same `expireAfterSeconds: 0` trick `Attempt` uses: Mongo deletes a
 * document once `expireAt` passes and skips documents where it is `null`.
 *
 * Abandoned checkouts carry an expiry and are cleaned up, because they hold an email
 * address and a name for a purchase that never happened. A PAID payment has `expireAt`
 * cleared and is kept indefinitely - it is a financial record, and being unable to answer
 * "did this person pay?" six months later is how a refund dispute becomes unresolvable.
 */
iqPaymentSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 })

/**
 * Paid orders by date, for the briefing's orders and revenue (mcp-plan.md R11). Paid rows are
 * kept forever, so without this "paid between two dates" scans every payment ever made.
 */
iqPaymentSchema.index({ status: 1, paidAt: -1 })

iqPaymentSchema.on('index', (error: unknown) => {
  if (error)
    console.error(
      '[IqPayment] index build FAILED - orderCode uniqueness may not be enforced',
      error
    )
})

export const IqPaymentModel: mongoose.Model<IqPaymentDocument> =
  (mongoose.models.IqPayment as mongoose.Model<IqPaymentDocument>) ??
  mongoose.model<IqPaymentDocument>('IqPayment', iqPaymentSchema)
