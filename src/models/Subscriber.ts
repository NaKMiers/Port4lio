import mongoose, { Schema } from 'mongoose'

import { compileModel } from '@/lib/mongoose-model'

/**
 * Somebody who asked to hear when a new post goes up.
 *
 * ```
 *          POST /api/blog/subscribe
 *                    │
 *                    ▼
 *            ┌───────────────┐   confirmToken minted, emailed
 *            │   pending     │   NOT on any list. Never emailed a digest.
 *            └───────────────┘
 *                    │  GET /api/blog/subscribe/confirm?token=…
 *                    ▼
 *            ┌───────────────┐   confirmedAt stamped ONCE
 *            │  confirmed    │   the only state a digest ever reads
 *            └───────────────┘
 *                    │  GET /api/blog/unsubscribe?token=…
 *                    ▼
 *            ┌───────────────┐   retains the row, never emailed again
 *            │ unsubscribed  │
 *            └───────────────┘
 * ```
 *
 * ## Why the plan said "do not model this yet", and what changed
 *
 * The planning document was explicit: *"a schema written against zero requirements is a
 * schema you will rewrite."* That was correct advice for the planning stage and it is not a
 * reason to write a vague schema now - it is a reason to write this one only against the
 * four requirements that are actually decided, and to leave out everything that is not.
 *
 * The four: **double opt-in**, **unsubscribe**, **consent timestamp**, **manual digest**.
 * Every field below serves one of them. What is deliberately absent, despite being the
 * obvious thing to add: no `name`, no `tags`, no `preferences`, no `source`, no segmentation,
 * no send history, no bounce handling. Each would be a guess at a requirement, and the digest
 * is sent by hand.
 *
 * ## Double opt-in is not politeness, it is what makes the list defensible
 *
 * Anyone can type anyone's address into a form. Without confirmation this collection is a
 * list of addresses that other people submitted, and mailing it is unsolicited email to
 * people who never asked - which is a legal problem in most of the places a recruiter reads
 * from, and a reputational one everywhere else. `pending` rows are never read by a digest.
 *
 * `confirmedAt` is the consent timestamp: the record of *when* somebody agreed, which is the
 * thing you need if anybody ever asks. It is write-once for the same reason `Post.publishedAt`
 * is - a re-confirm must not rewrite history.
 *
 * ## Unsubscribing retains the row
 *
 * Deleting it would mean the same address could be re-added by a form submission and land in
 * `pending` again, which is how somebody who unsubscribed starts receiving confirmation
 * emails. The row stays, `status: 'unsubscribed'` is terminal, and the unique index on email
 * is what makes it stick.
 *
 * ## No TTL, and it is the ContactMessage reasoning rather than the PostEvent reasoning
 *
 * A subscription is a standing request, not a behavioural trace. Expiring it would silently
 * unsubscribe somebody who never asked to leave. `tests/api` asserts the absence, the same
 * way it does for `ContactMessage`, so nobody restores symmetry with the collections this is
 * deliberately not symmetric with.
 */

export const SUBSCRIBER_STATUSES = [
  'pending',
  'confirmed',
  'unsubscribed',
] as const
export type SubscriberStatus = (typeof SUBSCRIBER_STATUSES)[number]

export type SubscriberDocument = {
  /** Lowercased at the handler. The unique key. */
  email: string
  status: SubscriberStatus
  /**
   * Single-use for confirm, long-lived for unsubscribe.
   *
   * One token, both jobs, because every digest has to carry an unsubscribe link and minting a
   * second token per send is a second thing to store and expire. It is high-entropy and it
   * only ever acts on the row it belongs to, so the worst a leaked one does is unsubscribe
   * somebody - which is exactly what the link is for.
   */
  token: string
  /** The consent record. Write-once - see the header. */
  confirmedAt: Date | null
  unsubscribedAt: Date | null
  createdAt: Date
}

const subscriberSchema = new Schema<SubscriberDocument>(
  {
    email: { type: String, required: true },
    status: {
      type: String,
      enum: SUBSCRIBER_STATUSES,
      required: true,
      default: 'pending',
    },
    token: { type: String, required: true },
    confirmedAt: { type: Date, default: null },
    unsubscribedAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  { collection: 'subscribers', versionKey: false }
)

/**
 * One row per address, forever.
 *
 * This is what makes `unsubscribed` terminal: without it, a second form submission from the
 * same address creates a second `pending` row and starts emailing somebody who already left.
 */
subscriberSchema.index({ email: 1 }, { unique: true })

/** Confirm and unsubscribe both look a row up by token and nothing else. */
subscriberSchema.index({ token: 1 }, { unique: true })

subscriberSchema.on('index', (error: unknown) => {
  if (error)
    console.error(
      '[Subscriber] index build FAILED - unsubscribes are not sticking and duplicates are possible',
      error
    )
})

export const SubscriberModel: mongoose.Model<SubscriberDocument> = compileModel(
  'Subscriber',
  subscriberSchema
)
