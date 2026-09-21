import { NextResponse, type NextRequest } from 'next/server'

import { hasOwnerAccess } from '@/lib/admin-gate'
import { jsonError } from '@/lib/api-response'
import { getAuthCookieName } from '@/lib/auth'
import { sanitizeState } from '@/lib/ccaf/progress'
import { loadCcafState } from '@/lib/ccaf/progress-data'
import { connectDatabase } from '@/lib/mongodb'
import { CCAF_SAVE_LIMIT, checkRateLimit, clientIpFrom } from '@/lib/rate-limit'
import {
  CCAF_PROGRESS_DOCUMENT_ID,
  CcafProgressModel,
} from '@/models/CcafProgress'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** A full state body is a few KB at the cap; this only stops something pathological. */
const MAX_BODY_BYTES = 64 * 1024

/**
 * [GET] /api/ccaf
 *
 * Owner-only, like the page it belongs to.
 *
 * It used to be open, and the reasoning was sound while it lasted: the plan and how far
 * along it is were both things the portfolio was happy to show, so only writes needed a
 * gate. The page is behind `OwnerAuthGate` now, and an open read of the same document
 * would make that gate decorative - the state is the page. So the cookie check moved up
 * from the write to the route.
 */
export async function GET(request: NextRequest) {
  if (!hasOwnerAccess(request.cookies.get(getAuthCookieName())?.value))
    return jsonError('Unauthorized', 401)

  return NextResponse.json({ state: await loadCcafState() })
}

/**
 * [PUT] /api/ccaf
 *
 * ```
 *   size ─▶ connect ─▶ rate limit ─▶ owner cookie ─▶ JSON ─▶ sanitize ─▶ upsert
 *     │                     │             │            │         │          │
 *    413                   429           401          400       400        200
 * ```
 *
 * ## Why PUT, and why it replaces rather than merges
 *
 * The body is the entire state. Unticking the last task and sending no tasks at all have
 * to be distinguishable, and with a merge they are not - `{}` would mean "change nothing"
 * and there would be no way left to express "nothing is ticked". Replacement also makes
 * the endpoint idempotent, which matters because the client retries a failed autosave.
 *
 * Last write wins, and that is correct here: one owner, one document, and two tabs open on
 * the same plan is a mistake to notice rather than a conflict to merge.
 *
 * ## Why the gate is here and not only on the page
 *
 * The rule this repo states plainly in `api/admin/metrics`: a client-side gate hides a
 * page, a server-side gate protects data. `OwnerAuthGate` on `/admin/ccaf` is the first kind.
 * This check is the second, and it is the one that matters.
 */
export async function PUT(request: NextRequest) {
  const contentType = request.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json'))
    return jsonError('Expected Content-Type: application/json', 415)

  const raw = await request.text()
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES)
    return jsonError('Payload too large', 413)

  // Before the rate-limit check, not after: `checkRateLimit` writes its counter to Mongo
  // and fails open on error, so a cold invocation with no connection yet would skip the
  // limit entirely. Same ordering as `api/event`.
  await connectDatabase()

  const limit = await checkRateLimit(clientIpFrom(request), CCAF_SAVE_LIMIT)
  if (!limit.ok)
    return NextResponse.json(
      { error: 'Too many requests' },
      {
        status: 429,
        headers: { 'Retry-After': String(limit.retryAfterSeconds) },
      }
    )

  if (!hasOwnerAccess(request.cookies.get(getAuthCookieName())?.value))
    return jsonError('Unauthorized', 401)

  let body: unknown
  try {
    body = JSON.parse(raw || 'null')
  } catch {
    return jsonError('Invalid JSON body', 400)
  }

  const state = sanitizeState(
    (body as { state?: unknown } | null)?.state ?? body
  )
  if (!state) return jsonError('Invalid progress state', 400)

  const now = new Date()
  try {
    await CcafProgressModel.findOneAndUpdate(
      { _id: CCAF_PROGRESS_DOCUMENT_ID },
      {
        $set: { ...state, updatedAt: now },
        $setOnInsert: { _id: CCAF_PROGRESS_DOCUMENT_ID, createdAt: now },
      },
      { upsert: true, new: true, lean: true, runValidators: true }
    )
  } catch (error) {
    console.error('[ccaf] failed to save progress', error)
    return jsonError('Could not save progress', 500)
  }

  // No `revalidatePath` here any more. Both pages render under the admin layout's
  // `force-dynamic` - a per-request cookie check cannot share a cached render - so there is
  // no window left to bust, and calling it would only look like there was.

  // Echo the sanitised state back rather than `{ ok: true }`: the client has just had ids
  // it does not know about dropped, and reconciling against the server's answer is how it
  // finds that out without a second round trip.
  return NextResponse.json({ ok: true, state })
}
