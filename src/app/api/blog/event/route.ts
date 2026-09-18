import { NextResponse, type NextRequest } from 'next/server'

import { jsonError } from '@/lib/api-response'
import { recordPostEvent } from '@/lib/blog/post-events'
import { connectDatabase } from '@/lib/mongodb'
import { BLOG_EVENT_LIMIT, checkRateLimit, clientIpFrom } from '@/lib/rate-limit'
import { readJsonBody } from '@/lib/read-json-body'
import { SLUG_PATTERN } from '@/lib/blog/constants'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** A slug, a session id and a kind. Anything approaching this is not a beacon. */
const EVENT_MAX_BODY_BYTES = 2 * 1024

/**
 * [POST] /api/blog/event - the only public write the blog has.
 *
 * ```
 *   connectDatabase()               ← FIRST. checkRateLimit writes to Mongo.
 *        ▼
 *   checkRateLimit(BLOG_EVENT_LIMIT)  60/min/IP ──▶ 429
 *        ▼
 *   readJsonBody()                  byte cap on the REAL body ──▶ 413
 *        │                          guarded parse ──────────────▶ 400
 *        ▼
 *   kind ∈ {view, share, attribute} ──▶ 400
 *   slug  ^[a-z0-9-]{1,80}$         ──▶ 400
 *   sessionId ^[A-Za-z0-9_-]{1,64}$ ──▶ 400   ← charset AND length, before it enters an _id
 *        ▼
 *   recordPostEvent()               fire-and-forget ──▶ 204 regardless
 * ```
 *
 * ## All five steps, because the first draft had two
 *
 * This endpoint is an **anonymous, unauthenticated Mongo write reachable from the open
 * internet** - the only one the blog has. The first version of this plan copied `api/event`'s
 * two input-bounding rules and dropped its three volume controls, which would have shipped
 * exactly that with no throttle.
 *
 * `connectDatabase()` comes first because `checkRateLimit` writes its counter to Mongo and
 * **fails open** on error. Placed above the connect, on a cold invocation with no connection
 * yet, the limiter would log a caught error and wave every request through while looking
 * identical to a working limiter from outside. Same ordering as `/api/contact`, submit,
 * checkout and `api/event`.
 *
 * The byte cap is on the body as measured, never on `Content-Length` - that header is
 * client-supplied and absent entirely on a chunked request.
 *
 * ## Why `sessionId` is validated before it is used, not after
 *
 * It goes straight into a document `_id`. An unvalidated one lets a caller choose the primary
 * key of a row in our database: pick a 10MB string and the `_id` index carries it; pick one
 * containing the `:` separator and the id grammar `blog:<kind>:<subject>` stops being
 * parseable, so a crafted session can impersonate a different kind's row. The charset here
 * excludes `:` for that reason and the length bound is what stops the first.
 *
 * ## Why it always returns 204, even when the write fails
 *
 * `recordPostEvent` is fire-and-forget. These rows are worth nothing next to the page they
 * instrument, and the caller is a `fetch` in a reader's browser that cannot do anything useful
 * with an error. A 500 here would produce console noise on a post somebody arrived at from a
 * cross-post - the exact reader this whole feature exists for.
 *
 * Validation failures DO return 4xx, because those are our own client being wrong and that is
 * worth finding out about.
 */

const KINDS = new Set(['view', 'share', 'attribute'])

/** No `:` - it is the id separator, and a session containing one can forge a kind. */
const SESSION_ID = /^[A-Za-z0-9_-]{1,64}$/

export async function POST(request: NextRequest) {
  // Before the rate-limit check, not after. See the header.
  try {
    await connectDatabase()
  } catch (error) {
    // 204, not 503. A reader's browser can do nothing with either, and the page is fine.
    console.error('[api/blog/event] database unreachable - event dropped', error)
    return new NextResponse(null, { status: 204 })
  }

  const limit = await checkRateLimit(clientIpFrom(request), BLOG_EVENT_LIMIT)
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'Too many events from this connection.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
    )
  }

  const parsed = await readJsonBody<{ kind?: unknown; slug?: unknown; sessionId?: unknown; token?: unknown }>(
    request,
    { maxBytes: EVENT_MAX_BODY_BYTES }
  )
  if (!parsed.ok) return jsonError(parsed.error, parsed.status)

  const { kind, slug, sessionId, token } = parsed.body ?? {}

  if (typeof kind !== 'string' || !KINDS.has(kind)) {
    return jsonError('Unknown event kind.', 400)
  }
  if (typeof slug !== 'string' || !SLUG_PATTERN.test(slug)) {
    return jsonError('Invalid slug.', 400)
  }
  if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) {
    return jsonError('Invalid session id.', 400)
  }
  if (kind !== 'view' && (typeof token !== 'string' || !SESSION_ID.test(token))) {
    return jsonError('Invalid share token.', 400)
  }

  /**
   * The subject is what makes the `_id` idempotent, and it differs per kind.
   *
   * `view` is per reader per post, so one person refreshing five times updates one document
   * rather than adding five. `share` is per minted token - one link, one row, however many
   * times it is clicked. `attribute` is per token per arriving session, so ten people
   * arriving from one shared link produce ten documents and one of them refreshing produces
   * none extra.
   */
  const subject =
    kind === 'view'
      ? `${slug}:${sessionId}`
      : kind === 'share'
        ? String(token)
        : `${String(token)}:${sessionId}`

  await recordPostEvent({ kind: kind as 'view' | 'share' | 'attribute', slug, subject })

  return new NextResponse(null, { status: 204 })
}
