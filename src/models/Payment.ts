import mongoose, { Schema } from 'mongoose'

/**
 * One PayOS payment intent for one MBTI attempt.
 *
 * ```
 *   POST /api/mbti/checkout {token, email}
 *        │
 *        ▼
 *   Payment { orderCode, attemptToken, email, amount, status: 'pending' }
 *        │                                          │
 *        │  PayOS webhook / status poll             │
 *        ▼                                          ▼
 *   status: 'paid'  ──▶  Attempt.paid = true,  result email sent
 * ```
 *
 * `orderCode` is the join key with PayOS and the only thing their webhook sends us that
 * identifies an order, so it carries the unique index. `attemptToken` is deliberately NOT
 * unique: someone can abandon a checkout and start another, and refusing the second
 * attempt would strand them with a payment link they already closed.
 *
 * This is the only collection in the MBTI feature that stores personal data. Keeping email
 * here rather than on `Attempt` means an attempt that never enters checkout holds nothing
 * identifying, which is what lets the privacy notice keep promising the free test is
 * anonymous.
 */

export type PaymentStatus = 'pending' | 'paid' | 'cancelled' | 'expired'

export type PaymentDocument = {
  _id: mongoose.Types.ObjectId
  /** PayOS's unique integer order reference. */
  orderCode: number
  /** The `Attempt._id` this pays for. */
  attemptToken: string
  email: string
  /** OUR authoritative amount. The webhook's figure is checked against this, never trusted. */
  amount: number
  status: PaymentStatus
  locale: string
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
   * When the PayOS payment link stops being payable. Drives the countdown in the checkout
   * panel.
   *
   * Distinct from `expireAt` below, and the names are easy to confuse: this one is minutes
   * away and governs whether the QR still works; `expireAt` is days away and governs when
   * Mongo deletes the row.
   */
  linkExpiresAt: Date
  /** TTL anchor. See the index note below - `null` means keep forever. */
  expireAt: Date | null
}

/** How long an abandoned checkout is kept before Mongo deletes it. */
export const UNPAID_PAYMENT_TTL_DAYS = 7

export function unpaidPaymentExpiryFrom(now: Date): Date {
  return new Date(now.getTime() + UNPAID_PAYMENT_TTL_DAYS * 24 * 60 * 60 * 1000)
}

const paymentSchema = new Schema(
  {
    orderCode: { type: Number, required: true, unique: true },
    attemptToken: { type: String, required: true, index: true },
    email: { type: String, required: true },
    amount: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      required: true,
      enum: ['pending', 'paid', 'cancelled', 'expired'],
      default: 'pending',
    },
    locale: { type: String, required: true },

    // From the create-link response.
    paymentLinkId: { type: String },
    checkoutUrl: { type: String },
    qrCode: { type: String },
    bin: { type: String },
    accountNumber: { type: String },
    accountName: { type: String },
    transferDescription: { type: String },

    // Filled in on fulfilment.
    reference: { type: String },
    paidAt: { type: Date, default: null },
    resultEmailedAt: { type: Date, default: null },

    linkExpiresAt: { type: Date, required: true },
    createdAt: { type: Date, default: Date.now },
    expireAt: { type: Date, default: null },
  },
  {
    collection: 'mbtiPayments',
    versionKey: false,
  }
)

/**
 * Tiered retention, the same `expireAfterSeconds: 0` trick `Attempt` uses: Mongo deletes a
 * document once `expireAt` passes, and skips documents where it is `null`.
 *
 * Abandoned checkouts carry an expiry and are cleaned up, because they hold an email
 * address for a purchase that never happened. A PAID payment has `expireAt` cleared and is
 * kept indefinitely - it is a financial record, and being unable to answer "did this person
 * pay?" six months later is how a refund dispute becomes unresolvable.
 */
paymentSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 })

/**
 * Paid orders by date, for the briefing's orders and revenue (mcp-plan.md R11). Paid rows are
 * kept forever, so without this "paid between two dates" scans every payment ever made.
 */
paymentSchema.index({ status: 1, paidAt: -1 })

/**
 * Index builds report failures through an event rather than a rejected promise, so without
 * this listener a failed build is silent. The unique index on `orderCode` is the one that
 * matters: without it, two concurrent checkouts could share an order code and a single
 * payment would settle the wrong one.
 */
paymentSchema.on('index', (error: unknown) => {
  if (error)
    console.error(
      '[Payment] Index build FAILED - orderCode uniqueness is not enforced',
      error
    )
})

export const PaymentModel: mongoose.Model<PaymentDocument> =
  (mongoose.models.Payment as mongoose.Model<PaymentDocument>) ??
  mongoose.model<PaymentDocument>('Payment', paymentSchema)
