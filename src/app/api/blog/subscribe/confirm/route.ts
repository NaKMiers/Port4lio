import { NextResponse, type NextRequest } from 'next/server'

import { connectDatabase } from '@/lib/mongodb'
import { SubscriberModel } from '@/models/Subscriber'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * [GET] /api/blog/subscribe/confirm?token=… - step two of double opt-in.
 *
 * ## Why this is a GET that redirects, and not a POST
 *
 * It is reached by clicking a link in an email, and an email client can only issue a GET.
 * That makes it the one endpoint here that a preview-fetcher or a link scanner can trigger
 * without a human - some corporate mail gateways fetch every URL in a message to check it.
 *
 * That is accepted rather than defended against, and the reasoning is worth stating because
 * the obvious hardening is wrong: putting a "click to confirm" button behind this would mean
 * a second page and a POST, which stops a scanner and also stops roughly the fraction of
 * real people who do not click twice. The cost of a scanner-confirmed subscription is one
 * person receiving a digest they can unsubscribe from with one click; the cost of the extra
 * step is a measurable share of real signups. For a hand-sent digest that is not close.
 *
 * ## `confirmedAt` is stamped once
 *
 * The same write-once reasoning as `Post.publishedAt`. It is a consent record - the answer to
 * *when did this person agree* - and a second click on the same link must not rewrite it.
 *
 * ## Redirects rather than rendering
 *
 * So the reader lands on a real page with the site's chrome, and so this handler has no
 * opinion about copy. Every outcome redirects, including the failures: a token that does not
 * resolve is far more likely to be an expired bookmark or a mangled link than an attack, and
 * a bare JSON error is a dead end for somebody who was trying to subscribe.
 */
export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin
  const token = request.nextUrl.searchParams.get('token') ?? ''

  const back = (state: string) =>
    NextResponse.redirect(`${origin}/blog/subscribed?state=${state}`, {
      status: 303,
    })

  if (!token) return back('invalid')

  try {
    await connectDatabase()

    const subscriber = await SubscriberModel.findOne({ token })
    if (!subscriber) return back('invalid')

    // Somebody who left stays left. A confirm link from before they unsubscribed must not
    // put them back on the list.
    if (subscriber.status === 'unsubscribed') return back('unsubscribed')

    if (subscriber.status === 'pending') {
      subscriber.status = 'confirmed'
      subscriber.confirmedAt = new Date()
      await subscriber.save()
    }

    return back('confirmed')
  } catch (error) {
    console.error('[api/blog/subscribe/confirm] failed', error)
    return back('error')
  }
}
