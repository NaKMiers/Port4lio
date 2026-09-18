import { NextResponse, type NextRequest } from 'next/server'

import { jsonError } from '@/lib/api-response'
import { renderContactEmail } from '@/lib/email-templates'
import { sendMail } from '@/lib/mailer'
import { connectDatabase } from '@/lib/mongodb'
import { checkRateLimit, clientIpFrom, CONTACT_LIMIT } from '@/lib/rate-limit'
import { CONTACT_MAX_BODY_BYTES, readJsonBody } from '@/lib/read-json-body'
import { getRequiredEnv } from '@/lib/required-env'
import { ContactMessageModel } from '@/models/ContactMessage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * [POST] /api/contact
 *
 * ```
 *   connectDatabase()               ← FIRST. checkRateLimit writes to Mongo.
 *        ▼
 *   checkRateLimit(CONTACT_LIMIT)   3/hour/IP ──▶ 429
 *        ▼
 *   readJsonBody()                  byte cap on the REAL body ──▶ 413
 *        │                          guarded parse ──────────────▶ 400
 *        ▼
 *   field caps                      ──▶ 400, naming the field
 *        ▼
 *   ContactMessage.create()         ──▶ 500 "email me directly"
 *        ▼
 *   claimMailBudget() + sendMail()  best effort ──▶ STILL 200
 * ```
 *
 * ## The ordering is the point
 *
 * `connectDatabase()` comes first because `checkRateLimit` writes its counter to Mongo and
 * **fails open** on error. On a cold invocation with no connection yet, a limiter placed
 * above the connect would not throttle - it would log a caught error and wave every request
 * through, which looks exactly like a working limiter from the outside. Same ordering as
 * submit, checkout, payos/status and `api/event`.
 *
 * Persisting comes before mailing, and that is the fix this file exists for. `sendMail` used
 * to be the only write here: there was no `connectDatabase()` anywhere in the handler and no
 * collection to write to, so every submission that hit a mail failure was *destroyed* and the
 * visitor got a 500 telling them to try later. There was nothing to try again from. A message
 * lives in the database now, and mail is a notification about something already safe.
 *
 * ## Why a mail failure returns 200
 *
 * A deliberate behaviour change from the 500 this used to return. The visitor asked to send a
 * message; the message is stored and the owner will read it. Telling them it failed invites a
 * duplicate submission, or worse, makes them give up - and the one thing that was actually
 * broken (mail) is not something they can do anything about. `mailed: false` on the row is
 * how the owner finds the ones that never reached an inbox.
 *
 * The persist failing is different, and still a 500: nothing recorded the message anywhere,
 * so "email me directly" is the only honest thing to say.
 *
 * ## What bounds the mail path
 *
 * Two things, because `CONTACT_LIMIT` alone cannot. `checkRateLimit` fails open on a missing
 * client IP **and** on a Mongo error, so the rate limit is off in precisely the conditions
 * that make abuse likely - and each accepted submission sends mail with a visitor-controlled
 * subject, body and `replyTo` from the site's own Gmail account. `claimMailBudget` below is
 * the second door: it is process-local, so it holds when Mongo does not and when there is no
 * IP to bucket on.
 */

/** Trimmed lengths, in characters. The byte cap in `readJsonBody` is a separate bound. */
const FIELD_MAX = {
  email: 254,
  firstname: 100,
  lastname: 100,
  subject: 200,
  message: 5000,
} as const

/** Kept out of `FIELD_MAX` because it is optional, so it is checked on a different branch. */
const HEARD_ABOUT_MAX = 200

/** Matches the blog's slug charset. Not a length bound - `slice` is not enough here. */
const SOURCE_SLUG = /^[a-z0-9-]{1,80}$/

/**
 * A process-local ceiling on outbound contact mail.
 *
 * ```
 *   window = floor(now / 1h)
 *   sent++ per delivered mail;  reset when the window rolls
 * ```
 *
 * This exists because `CONTACT_LIMIT` fails open on the two cases that matter (see the
 * header), and it is deliberately NOT backed by Mongo - a Mongo-backed counter would fail
 * open on the same error, which is not a second door, it is the same door painted twice.
 *
 * Be clear about what it does not do. It is per process, so N warm lambda instances allow
 * N times this number, and a cold start resets it. It is a ceiling on how bad a single
 * instance can get, not a global quota, and the only true global bound is Gmail's own
 * sending limit. 20/hour is the number because a *real* hour on this site produces at most
 * one or two messages, so anything approaching 20 is already an incident - and the messages
 * are still persisted either way, so what gets dropped is a notification, never a message.
 */
const MAIL_BUDGET_PER_HOUR = 20
const MAIL_BUDGET_WINDOW_MS = 60 * 60 * 1000

let mailWindow = 0
let mailsSentInWindow = 0

function claimMailBudget(nowMs: number): boolean {
  const window = Math.floor(nowMs / MAIL_BUDGET_WINDOW_MS)
  if (window !== mailWindow) {
    mailWindow = window
    mailsSentInWindow = 0
  }

  if (mailsSentInWindow >= MAIL_BUDGET_PER_HOUR) {
    return false
  }

  mailsSentInWindow += 1
  return true
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export async function POST(request: NextRequest) {
  // Before the rate-limit check, not after. See "The ordering is the point" above.
  try {
    await connectDatabase()
  } catch (error) {
    // Nothing downstream can work without this: the limiter would be silently off and the
    // message would have nowhere to go. Fail loudly rather than fall through to mail-only,
    // which is the behaviour this handler was rewritten to remove.
    console.error('[api/contact] database unreachable - submission refused', error)
    return jsonError(
      'Unable to accept your message right now. Please email me directly at the address on this page.',
      503
    )
  }

  const limit = await checkRateLimit(clientIpFrom(request), CONTACT_LIMIT)
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'Too many messages from this connection. Please try again later.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
    )
  }

  const parsed = await readJsonBody<Record<string, unknown>>(request, {
    maxBytes: CONTACT_MAX_BODY_BYTES,
  })
  if (!parsed.ok) {
    return jsonError(parsed.error, parsed.status)
  }

  const { email, firstname, lastname, subject, message, sourceSlug, heardAbout } =
    parsed.body ?? {}

  if (
    !isNonEmptyString(email) ||
    !isNonEmptyString(firstname) ||
    !isNonEmptyString(lastname) ||
    !isNonEmptyString(subject) ||
    !isNonEmptyString(message)
  ) {
    return jsonError('Please complete all contact form fields.', 400)
  }

  const fields = {
    email: email.trim(),
    firstname: firstname.trim(),
    lastname: lastname.trim(),
    subject: subject.trim(),
    message: message.trim(),
  }

  // Rejected rather than truncated, and named rather than generic. Every one of these is a
  // field the visitor typed and can see, so an error that says which one is too long is
  // something they can act on - whereas silently storing 5000 of their 6000 characters
  // sends a message that ends mid-sentence and looks like our bug.
  for (const [name, max] of Object.entries(FIELD_MAX)) {
    if (fields[name as keyof typeof fields].length > max) {
      return jsonError(`The ${name} field is too long (maximum ${max} characters).`, 400)
    }
  }

  const heardAboutText = isNonEmptyString(heardAbout) ? heardAbout.trim() : null
  if (heardAboutText !== null && heardAboutText.length > HEARD_ABOUT_MAX) {
    return jsonError(
      `The "how did you hear about me" field is too long (maximum ${HEARD_ABOUT_MAX} characters).`,
      400
    )
  }

  /**
   * A malformed `sourceSlug` is DROPPED, not rejected - the one asymmetry in this handler.
   *
   * Every field above is typed by the visitor, so a 400 naming it is actionable. This one is
   * supplied by our own client from the URL of the post they were reading. A visitor cannot
   * see it, cannot fix it, and would not know what it meant - so turning a bad value into a
   * 400 destroys a real message to protect an analytics field. That is the same trade this
   * file was rewritten to stop making, one field smaller.
   *
   * Logged, because the only way a bad value gets here is our own bug or somebody probing,
   * and both are worth knowing about.
   */
  let slug: string | null = null
  if (isNonEmptyString(sourceSlug)) {
    const candidate = sourceSlug.trim()
    if (SOURCE_SLUG.test(candidate)) {
      slug = candidate
    } else {
      console.warn('[api/contact] dropped a malformed sourceSlug - message kept')
    }
  }

  let savedId: unknown
  try {
    const saved = await ContactMessageModel.create({
      ...fields,
      sourceSlug: slug,
      heardAbout: heardAboutText,
      mailed: false,
      createdAt: new Date(),
    })
    savedId = saved._id
  } catch (error) {
    console.error('[api/contact] could not persist the message', error)
    return jsonError(
      'Unable to save your message right now. Please try again later or email me directly.',
      500
    )
  }

  // Everything from here on is best effort. The message is stored; the response is already
  // decided. A throw in this block must not reach the visitor, so it is caught and logged
  // rather than allowed to turn a saved message into a 500 - the exact bug this file had.
  try {
    if (!claimMailBudget(Date.now())) {
      console.error(
        `[api/contact] mail budget exhausted (${MAIL_BUDGET_PER_HOUR}/hour in this process) - message ${String(savedId)} saved but NOT emailed`
      )
    } else {
      // The renderer escapes every one of these - they are anonymous visitor input, and
      // they used to be interpolated into the email HTML raw.
      const rendered = renderContactEmail({
        ...fields,
        sourceSlug: slug,
        heardAbout: heardAboutText,
      })

      await sendMail({
        to: getRequiredEnv('MAIL_TO'),
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        // Replying to the notification should reach the visitor, not the no-reply mailbox.
        replyTo: fields.email,
      })
      await ContactMessageModel.updateOne({ _id: savedId }, { $set: { mailed: true } })
    }
  } catch (error) {
    // Deliberately not a 500. See "Why a mail failure returns 200" above. The row keeps
    // `mailed: false`, which is how the owner finds what never reached the inbox.
    console.error(
      `[api/contact] message ${String(savedId)} saved but mail failed - it is NOT lost`,
      error
    )
  }

  return NextResponse.json({ ok: true })
}

export function GET() {
  return jsonError('Method Not Allowed', 405)
}
