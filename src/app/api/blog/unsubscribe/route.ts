import { NextResponse, type NextRequest } from 'next/server'

import { connectDatabase } from '@/lib/mongodb'
import { SubscriberModel } from '@/models/Subscriber'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * [GET] /api/blog/unsubscribe?token=…
 *
 * ## One click, no confirmation step, no login
 *
 * Every digest carries this link. It has to work on the first click from a mail client, from
 * any device, with no account - anything else and the practical route out of a mailing list
 * becomes "mark as spam", which costs the sending domain's reputation rather than one
 * subscriber.
 *
 * ## The row is retained, never deleted
 *
 * Deleting it frees the unique email index, so the same address could be re-added by any
 * later form submission and would land in `pending` - meaning somebody who unsubscribed
 * starts receiving confirmation emails again. `unsubscribed` is terminal, and the subscribe
 * handler checks for it.
 *
 * ## An unknown token still reports success
 *
 * Deliberately. The person clicking wants to not receive email; an "unknown token" error page
 * tells them they failed at something they cannot fix and sends them to the spam button. And
 * distinguishing a valid token from an invalid one here would let somebody probe which tokens
 * exist.
 */
export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin
  const token = request.nextUrl.searchParams.get('token') ?? ''

  const done = NextResponse.redirect(
    `${origin}/blog/subscribed?state=unsubscribed`,
    {
      status: 303,
    }
  )

  if (!token) return done

  try {
    await connectDatabase()

    await SubscriberModel.updateOne(
      { token, status: { $ne: 'unsubscribed' } },
      { $set: { status: 'unsubscribed', unsubscribedAt: new Date() } }
    )
  } catch (error) {
    // Logged, but the reader is still told they are unsubscribed, because retrying is not
    // something they can usefully do. The log is how this gets noticed and fixed by hand.
    console.error(
      '[api/blog/unsubscribe] FAILED - this person still receives the digest',
      error
    )
  }

  return done
}
