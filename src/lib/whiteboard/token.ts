import 'server-only'

import crypto from 'node:crypto'

import { after, type NextRequest } from 'next/server'

import { connectDatabase } from '@/lib/mongodb'
import {
  WHITEBOARD_AGENT_LIMIT,
  checkRateLimit,
  clientIpFrom,
} from '@/lib/rate-limit'
import { noStore, wbError } from '@/lib/whiteboard/http'
import { isObjectIdString } from '@/lib/whiteboard/limits'
import type { ClientToken } from '@/lib/whiteboard/types'
import {
  WhiteboardTokenModel,
  type WhiteboardTokenDocument,
} from '@/models/WhiteboardToken'

/**
 * Agent tokens: create, verify, revoke, and a throttled "last used".
 *
 * ```
 *   create:  wbt_ + 32 random bytes (base64url) ──▶ shown ONCE ──▶ only sha256(token) stored
 *
 *   agent request (context.md / mcp)
 *     1 checkRateLimit(WHITEBOARD_AGENT_LIMIT)      ← before anything else: guesses count
 *     2 Authorization: Bearer wbt_...               ← header only; ?token= is never read
 *     3 findOne({ hash, revokedAt: null })          ← unknown and revoked: same query, same 401
 *          │ throws ──▶ 503                        ← FAIL CLOSED (the limiter fails open)
 *     4 after(): updateOne lastUsedAt if null or older than 5 min   (D29)
 * ```
 *
 * ## Why this is not the owner cookie, and not `hasOwnerAccess`
 *
 * The cookie is a browser session behind an emailed OTP; an agent is a CLI process that needs
 * a long-lived, revocable credential that can be killed without logging the owner out. And
 * `hasOwnerAccess` honours `REQUIRE_ADMIN=false`, which is exactly the switch that must never
 * open these routes: a dev server started with it and exposed through a tunnel would hand the
 * whole private board to anyone. So the agent routes go through `guardAgent` and nothing else.
 *
 * ## Why verification fails closed
 *
 * `checkRateLimit` fails OPEN on a database error, deliberately, for the public funnel. If the
 * token lookup behaved the same way, "Mongo is having a bad minute" would mean "no rate limit
 * and no auth". A lookup that throws is a 503, never a pass.
 *
 * ## Why the touch is throttled and scheduled with `after()`
 *
 * Every tool call already writes once for the rate limit. An unconditional `lastUsedAt` write
 * would double that, for a timestamp the panel shows as "~5 min ago" anyway. The conditional
 * update writes at most once per 5 minutes per token, and the first call always writes (null
 * is older than anything), which is what flips the Agents panel to "Connected" (DR5).
 * `after()` rather than an un-awaited promise, because Vercel may freeze the function the
 * moment the response is returned, and a fire-and-forget write would then silently never run.
 */

const TOKEN_PREFIX = 'wbt_'
const TOUCH_INTERVAL_MS = 5 * 60 * 1000
const BEARER = /^Bearer\s+(wbt_[A-Za-z0-9_-]{16,128})\s*$/

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function toClientToken(
  doc: Omit<WhiteboardTokenDocument, 'hash'>
): ClientToken {
  return {
    id: String(doc._id),
    name: doc.name,
    prefix: doc.prefix,
    createdAt: new Date(doc.createdAt).toISOString(),
    lastUsedAt: doc.lastUsedAt ? new Date(doc.lastUsedAt).toISOString() : null,
    revokedAt: doc.revokedAt ? new Date(doc.revokedAt).toISOString() : null,
  }
}

/** The plaintext is returned here and nowhere else, ever. */
export async function createToken(
  name: string
): Promise<{ token: string; record: ClientToken }> {
  await connectDatabase()
  const token = `${TOKEN_PREFIX}${crypto.randomBytes(32).toString('base64url')}`
  const doc = await WhiteboardTokenModel.create({
    name,
    prefix: token.slice(0, 8),
    hash: hashToken(token),
  })
  return { token, record: toClientToken(doc.toObject()) }
}

/** Never includes the hash. Newest first; revoked tokens stay in the list, greyed out. */
export async function listTokens(): Promise<ClientToken[]> {
  await connectDatabase()
  const docs = await WhiteboardTokenModel.find({}, { hash: 0 })
    .sort({ createdAt: -1 })
    .lean()
  return docs.map(toClientToken)
}

export async function revokeToken(id: string): Promise<ClientToken | null> {
  await connectDatabase()
  if (!isObjectIdString(id)) return null
  const doc = await WhiteboardTokenModel.findOneAndUpdate(
    { _id: id, revokedAt: null },
    { $set: { revokedAt: new Date() } },
    { returnDocument: 'after', lean: true, projection: { hash: 0 } }
  )
  if (doc) return toClientToken(doc)
  // Already revoked is still a success for the caller; unknown is not.
  const existing = await WhiteboardTokenModel.findById(id, { hash: 0 }).lean()
  return existing ? toClientToken(existing) : null
}

export type VerifyResult =
  { ok: true; tokenId: string } | { ok: false; status: 401 | 503 }

/** Header only. A token in the query string is not looked at, so it cannot be accepted. */
export async function verifyBearer(request: Request): Promise<VerifyResult> {
  const match = BEARER.exec(request.headers.get('authorization') ?? '')
  if (!match) return { ok: false, status: 401 }

  try {
    await connectDatabase()
    const doc = await WhiteboardTokenModel.findOne(
      { hash: hashToken(match[1]), revokedAt: null },
      { _id: 1 }
    ).lean()
    if (!doc) return { ok: false, status: 401 }
    return { ok: true, tokenId: String(doc._id) }
  } catch (error) {
    console.error('[whiteboard] token lookup failed - refusing', error)
    return { ok: false, status: 503 }
  }
}

/** Writes only when `lastUsedAt` is null or older than 5 minutes (D29). */
export async function touchLastUsed(tokenId: string, now = new Date()) {
  await WhiteboardTokenModel.updateOne(
    {
      _id: tokenId,
      $or: [
        { lastUsedAt: null },
        { lastUsedAt: { $lt: new Date(now.getTime() - TOUCH_INTERVAL_MS) } },
      ],
    },
    { $set: { lastUsedAt: now } }
  )
}

/**
 * The front door of both agent routes: rate limit, then the bearer token, then a deferred
 * touch. Returns a response to send as-is, or `null` to continue.
 */
export async function guardAgent(
  request: NextRequest
): Promise<Response | null> {
  const limit = await checkRateLimit(
    clientIpFrom(request),
    WHITEBOARD_AGENT_LIMIT
  )
  if (!limit.ok) {
    const res = wbError('Too many requests. Try again shortly.', 429)
    res.headers.set('Retry-After', String(limit.retryAfterSeconds))
    return res
  }

  const verified = await verifyBearer(request)
  if (!verified.ok) {
    if (verified.status === 503)
      return wbError('The whiteboard is unavailable right now.', 503)
    // Same answer for missing, malformed, unknown and revoked.
    const res = wbError('Unauthorized', 401)
    res.headers.set('WWW-Authenticate', 'Bearer realm="whiteboard"')
    return noStore(res)
  }

  after(async () => {
    try {
      await touchLastUsed(verified.tokenId)
    } catch (error) {
      console.error('[whiteboard] lastUsedAt touch failed', error)
    }
  })
  return null
}
