import mongoose, { Schema } from 'mongoose'

import { compileModel } from '@/lib/mongoose-model'

/**
 * One message somebody sent through the contact form.
 *
 * ```
 *   POST /api/contact
 *        │
 *        ├─▶ ContactMessage.create()   ← the write that must survive
 *        │        │
 *        │        ▼
 *        └─▶ sendMail()  best effort ──▶ mailed: true | false
 * ```
 *
 * ## Why this collection exists at all
 *
 * It did not, and that was a live data-loss bug. `sendMail` was the only write in the
 * handler, so every submission that hit a mail failure - an expired app password, a Gmail
 * rate limit, a network blip - was destroyed, and the visitor was told to try again later
 * by a 500. There was nothing to retry *from*. The message existed for the length of one
 * function call and then did not.
 *
 * That inverts the ordering above: persisting is the operation the response reports on, and
 * mail is a notification about a message that is already safe. `mailed` records which of
 * those two happened, so a row with `mailed: false` is the exact set the owner never saw in
 * an inbox and would otherwise have no way to discover.
 *
 * ## Attribution: three optional fields, and why all three are optional
 *
 * `sourceSlug` names the blog post a reader came from. `heardAbout` is what the visitor
 * typed into "How did you hear about me?" on the portfolio form. Both are the instruments
 * the blog's kill criterion reads, and they measure *different* things: `sourceSlug` only
 * fires when the reader submits the form themselves, while a referral is a third person,
 * weeks later, who never saw the post - which can never carry a slug and can only ever
 * arrive as a sentence a human typed.
 *
 * All of them are optional because the portfolio form at `/` predates them and must keep
 * working unchanged. A required attribution field would mean the existing form submits a
 * document that fails validation, which is the same data loss in a new costume.
 *
 * ## Retention: there is no TTL index here, deliberately
 *
 * Every other collection in this repo that holds stranger data has one - `Attempt`,
 * `IqAttempt`, `TestEvent`, `RateLimit` - and `tests/api/retention.test.ts` exists because
 * a TTL index that fails to build is silent. So the absence of one here looks like the
 * omission those tests were written to catch, and a future reader pattern-matching the
 * other models would "fix" it in good faith.
 *
 * It is not an omission. A contact message is correspondence: someone deliberately wrote to
 * a person and is waiting for a reply, and a conversation that resumes four months later is
 * normal rather than exceptional. Expiring it would delete the owner's own inbox on a timer.
 * `tests/api/contact.test.ts` asserts the absence so that nobody restores
 * symmetry with the collections this is deliberately not symmetric with.
 *
 * What makes that defensible rather than negligent is disclosure plus an exit: the privacy
 * notice says messages are kept until deleted, and the owner board gets a delete action.
 * Both are Phase 1 (T14, T11). Until they ship, this collection holds what an email inbox
 * already holds, for the same reason and with the same lifetime.
 */

export type ContactMessageDocument = {
  email: string
  firstname: string
  lastname: string
  subject: string
  message: string
  /** The blog post this reader came from, when they came from one. `^[a-z0-9-]{1,80}$`. */
  sourceSlug: string | null
  /** Free text the visitor typed. The only field that can catch a referral. */
  heardAbout: string | null
  /** Whether the notification email went out. `false` means the owner never saw it. */
  mailed: boolean
  createdAt: Date
}

const contactMessageSchema = new Schema<ContactMessageDocument>(
  {
    email: { type: String, required: true },
    firstname: { type: String, required: true },
    lastname: { type: String, required: true },
    subject: { type: String, required: true },
    message: { type: String, required: true },
    sourceSlug: { type: String, default: null },
    heardAbout: { type: String, default: null },
    mailed: { type: Boolean, required: true, default: false },
    createdAt: { type: Date, default: Date.now },
  },
  {
    collection: 'contactMessages',
    versionKey: false,
  }
)

/**
 * Newest first, which is the only order the owner board ever reads this in.
 *
 * Not indexed: `sourceSlug`. The kill criterion asks "is there at least one message with a
 * slug", which is a question asked by a human a handful of times over six weeks against a
 * collection whose success case is measured in tens of documents. An index would be a
 * guess at a read pattern that does not exist yet - and note the shape here is
 * present-and-null, the one `IqAttempt` proved needs a *partial* filter rather than
 * `sparse` if it ever becomes unique. See `tests/api/retention.test.ts:90-99`.
 */
contactMessageSchema.index({ createdAt: -1 })

// `compileModel`, not `mongoose.models.X ?? ...`: this schema will gain fields (the owner
// board, a `readAt`, a reply marker) and the plain cached lookup drops them silently under
// dev HMR - a write returns 200 with the new field simply absent. See `mongoose-model.ts`.
export const ContactMessageModel: mongoose.Model<ContactMessageDocument> = compileModel(
  'ContactMessage',
  contactMessageSchema
)
