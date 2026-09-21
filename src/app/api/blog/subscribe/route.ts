import { randomBytes } from 'node:crypto'

import { NextResponse, type NextRequest } from 'next/server'

import { jsonError } from '@/lib/api-response'
import { renderSubscribeConfirmEmail } from '@/lib/email-templates'
import { sendMail } from '@/lib/mailer'
import { connectDatabase } from '@/lib/mongodb'
import { checkRateLimit, clientIpFrom, SUBSCRIBE_LIMIT } from '@/lib/rate-limit'
import { readJsonBody } from '@/lib/read-json-body'
import { resolveSiteOrigin } from '@/lib/seo'
import { SubscriberModel } from '@/models/Subscriber'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SUBSCRIBE_MAX_BODY_BYTES = 2 * 1024
/** Deliberately loose. The confirmation round trip is the real validation. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/**
 * [POST] /api/blog/subscribe - step one of double opt-in.
 *
 * ```
 *   connectDatabase()   ← FIRST. checkRateLimit writes to Mongo and fails open.
 *        ▼
 *   checkRateLimit(SUBSCRIBE_LIMIT)  3/hour/IP ──▶ 429
 *        ▼
 *   readJsonBody + email shape       ──▶ 413 / 400
 *        ▼
 *   upsert a PENDING row, mint a token
 *        ▼
 *   email the confirm link   ──▶ 202, ALWAYS the same response
 * ```
 *
 * ## The response never reveals whether the address was already on the list
 *
 * Every path below that is not a malformed request returns the identical 202 and the
 * identical message. That is not politeness - a subscribe endpoint that answers "already
 * subscribed" differently from "added" is an **email address oracle**: anyone can test
 * whether a given person reads this blog, one address at a time, and the rate limit only
 * slows that down.
 *
 * The same reasoning covers the unsubscribed case. Somebody who left is not re-added and is
 * not emailed, and the caller cannot tell that apart from a fresh signup.
 *
 * ## Why mail failure still returns 202
 *
 * Same call as `/api/contact`: the row is written first and mail is a notification about
 * something already recorded. The difference is that here a failed confirmation email means
 * the subscription never completes - so it is logged as an error rather than shrugged off,
 * and the row sits in `pending`, which no digest ever reads. Nothing is lost except the
 * signup, and the person can simply try again.
 */
export async function POST(request: NextRequest) {
  try {
    await connectDatabase()
  } catch (error) {
    console.error('[api/blog/subscribe] database unreachable', error)
    return jsonError(
      'Unable to sign you up right now. Please try again later.',
      503
    )
  }

  const limit = await checkRateLimit(clientIpFrom(request), SUBSCRIBE_LIMIT)
  if (!limit.ok)
    return NextResponse.json(
      {
        error: 'Too many signups from this connection. Please try again later.',
      },
      {
        status: 429,
        headers: { 'Retry-After': String(limit.retryAfterSeconds) },
      }
    )

  const parsed = await readJsonBody<{ email?: unknown }>(request, {
    maxBytes: SUBSCRIBE_MAX_BODY_BYTES,
  })
  if (!parsed.ok) return jsonError(parsed.error, parsed.status)

  const raw =
    typeof parsed.body?.email === 'string' ? parsed.body.email.trim() : ''
  if (!raw || raw.length > 254 || !EMAIL.test(raw))
    return jsonError('That does not look like an email address.', 400)

  // Lowercased so `A@b.com` and `a@b.com` cannot become two rows and two confirmation emails.
  const email = raw.toLowerCase()

  /** The one response every non-malformed request gets. See the header. */
  const ACCEPTED = NextResponse.json(
    { ok: true, message: 'Check your inbox for a confirmation link.' },
    { status: 202 }
  )

  try {
    const existing = await SubscriberModel.findOne({ email }).lean()

    // Already confirmed, or deliberately gone. Neither is emailed, and neither is
    // distinguishable from a fresh signup by the caller.
    if (existing && existing.status !== 'pending') return ACCEPTED

    const token = existing?.token ?? randomBytes(24).toString('base64url')

    if (!existing)
      await SubscriberModel.create({ email, token, status: 'pending' })

    const origin = resolveSiteOrigin().replace(/\/$/, '')
    const rendered = renderSubscribeConfirmEmail({
      confirmUrl: `${origin}/api/blog/subscribe/confirm?token=${token}`,
    })

    await sendMail({
      to: email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    })
  } catch (error) {
    // Logged as an error, unlike the contact form's shrug: a failed confirmation email means
    // the signup never completes. The row stays `pending`, which no digest reads, so nothing
    // is on a list it should not be on.
    console.error(
      `[api/blog/subscribe] confirmation email failed for a pending signup`,
      error
    )
  }

  return ACCEPTED
}
