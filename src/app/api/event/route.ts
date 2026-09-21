import { NextResponse, type NextRequest } from 'next/server'

import { jsonError } from '@/lib/api-response'
import { connectDatabase } from '@/lib/mongodb'
import { checkRateLimit, clientIpFrom, EVENT_LIMIT } from '@/lib/rate-limit'
import { recordAttribution, recordShare } from '@/lib/share'
import {
  assertClientPostable,
  ServerOnlyEventError,
  recordEvent,
} from '@/lib/test-events'
import { isTokenShaped } from '@/lib/tokens'
import { dayBucket, testEventId } from '@/models/TestEvent'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** A tagged event is a few dozen bytes. Anything approaching this is not one. */
const MAX_BODY_BYTES = 2 * 1024

/** Bounds a client-supplied session id before it becomes part of a document `_id`. */
const MAX_SESSION_ID = 64

/**
 * [POST] /api/event
 *
 * The single public write path for measurement, for every test.
 *
 * ```
 *   size cap ──▶ rate limit ──▶ parse ──▶ assertClientPostable ──▶ upsert
 *      │             │            │              │                   │
 *     413           429          400            403                 204
 * ```
 *
 * ## One route, not three
 *
 * Share, attribution and progress all do the same thing: take a small tagged body from an
 * anonymous visitor and append one row. Three routes would mean three copies of the rate
 * limit, three validation paths and three places to get the trust boundary wrong - and
 * three more the moment the IQ test wants the same thing. `product` is in the body rather
 * than the path for the same reason: this endpoint is not `mbti`-shaped.
 *
 * ## What this route refuses
 *
 * `assertClientPostable` is the whole security story. `paid` and `checkout-started` are
 * written by server code that never touches this handler, so there is no request that can
 * reach them. That matters more than it looks: `paid` is the number a pricing decision
 * gets made from, and a forged row is indistinguishable from a real one after the fact -
 * the funnel would be quietly worthless rather than obviously broken.
 *
 * ## Why it returns 204 and never a body
 *
 * The caller is a beacon. It cannot act on a response, and most of the time the page is
 * already unloading. Anything other than "received" is noise, and an error body would be
 * one more thing to accidentally depend on.
 */
export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (contentLength > MAX_BODY_BYTES) return jsonError('Payload too large', 413)

  // Before the rate-limit check, not after: `checkRateLimit` writes its counter to Mongo
  // and fails OPEN on error, so a cold invocation with no connection yet would silently
  // skip the limit entirely. Same ordering as submit, checkout and payos/status.
  await connectDatabase()

  const limit = await checkRateLimit(clientIpFrom(request), EVENT_LIMIT)
  if (!limit.ok)
    return NextResponse.json(
      { error: 'Too many requests' },
      {
        status: 429,
        headers: { 'Retry-After': String(limit.retryAfterSeconds) },
      }
    )

  // Read as text rather than `request.json()`. `navigator.sendBeacon` sends `text/plain`
  // unless the caller wraps the payload in a typed `Blob`, and a beacon that silently
  // fails to parse is exactly the bug this endpoint exists to avoid - it would look like
  // "nobody abandoned the test" rather than like a broken content type.
  let body: unknown
  try {
    body = JSON.parse(await request.text())
  } catch {
    return jsonError('Invalid JSON body', 400)
  }

  const { product, kind, event, sessionId, shareToken, furthest, total } =
    (body ?? {}) as {
      product?: unknown
      kind?: unknown
      event?: unknown
      sessionId?: unknown
      shareToken?: unknown
      furthest?: unknown
      total?: unknown
    }

  if (typeof product !== 'string' || !/^[a-z]{2,16}$/.test(product))
    return jsonError('Invalid product', 400)

  if (typeof kind !== 'string') return jsonError('Invalid kind', 400)

  const eventName = typeof event === 'string' ? event : null

  try {
    assertClientPostable(kind, eventName)
  } catch (error) {
    if (error instanceof ServerOnlyEventError) {
      // 403 rather than 400: the request is well-formed, it is just not something a
      // browser is allowed to assert. Logged because a real one means either a bug in our
      // own client or somebody probing the funnel.
      console.warn(
        `[api/event] refused server-authoritative event: ${kind}:${eventName ?? ''}`
      )
      return jsonError('Not client-reportable', 403)
    }
    throw error
  }

  const session =
    typeof sessionId === 'string' ? sessionId.slice(0, MAX_SESSION_ID) : ''

  if (kind === 'share') {
    // `type` is whatever public artifact the share points at - an MBTI type today. Bounded
    // because it lands in a document, and never trusted for anything but display.
    const shareType =
      typeof (body as { type?: unknown })?.type === 'string'
        ? String((body as { type?: unknown }).type).slice(0, 32)
        : ''
    if (typeof shareToken !== 'string' || !isTokenShaped(shareToken))
      return jsonError('Invalid share token', 400)

    await recordShare(product, shareToken, { type: shareType })
    return new NextResponse(null, { status: 204 })
  }

  if (kind === 'attribute') {
    if (
      typeof shareToken !== 'string' ||
      !isTokenShaped(shareToken) ||
      !session
    )
      return jsonError('Invalid attribution', 400)

    await recordAttribution(product, shareToken, session)
    return new NextResponse(null, { status: 204 })
  }

  if (kind === 'progress') {
    if (!session) return jsonError('Missing sessionId', 400)
    const furthestQuestion = Number.isFinite(Number(furthest))
      ? Math.max(0, Math.floor(Number(furthest)))
      : 0
    const totalQuestions = Number.isFinite(Number(total))
      ? Math.max(0, Math.floor(Number(total)))
      : 0
    await recordEvent({
      id: testEventId.progress(product, session),
      product,
      kind: 'progress',
      clientReported: true,
      data: { total: totalQuestions },
      // `$max`, not `$set`: `visibilitychange` fires on every tab switch, so a later
      // beacon can carry a *smaller* value than one already recorded if the visitor
      // navigated back. The furthest point reached must never regress.
      max: { furthest: furthestQuestion },
    })
    return new NextResponse(null, { status: 204 })
  }

  if (kind === 'funnel' && eventName) {
    await recordEvent({
      id: testEventId.funnel(product, eventName, dayBucket(new Date())),
      product,
      kind: 'funnel',
      event: eventName,
      clientReported: true,
    })
    return new NextResponse(null, { status: 204 })
  }

  return jsonError('Unsupported event', 400)
}
