import 'server-only'

import crypto from 'node:crypto'

import { after, type NextRequest } from 'next/server'

import {
  DEFAULT_SCOPES,
  LEGACY_SCOPE,
  MCP_SCOPES,
  type ClientAgentToken,
  type McpScope,
  type TokenScope,
} from '@/lib/mcp/scopes'
import { agentError, noStore } from '@/lib/mcp/transport'
import { connectDatabase } from '@/lib/mongodb'
import { MCP_AGENT_LIMIT, checkRateLimit, clientIpFrom } from '@/lib/rate-limit'
import { isObjectIdString } from '@/lib/whiteboard/limits'
import { AgentTokenModel, type AgentTokenDocument } from '@/models/AgentToken'
import { WhiteboardTokenModel } from '@/models/WhiteboardToken'

/**
 * Agent tokens: verify, create, revoke, and a throttled "last used". The front door of every
 * agent route.
 *
 * ```
 *   create:  p4_ + 32 random bytes (base64url) ──▶ shown ONCE ──▶ only sha256(token) stored
 *
 *   guardAgent(request, { accept })
 *     1 checkRateLimit(MCP_AGENT_LIMIT, by IP)       ← before anything else: guesses count
 *     2 Authorization: Bearer p4_... | wbt_...       ← header only; ?token= is never read
 *          prefix not in `accept` ──▶ 401            ← no lookup at all: wbt_ on /api/mcp
 *     3 p4_  ──▶ AgentToken.findOne({ hash, revokedAt: null })    ──▶ its scopes
 *       wbt_ ──▶ WhiteboardToken.findOne({ hash, revokedAt: null }) ──▶ ['whiteboard:legacy']
 *          unknown and revoked: same query, same 401
 *          │ throws ──▶ 503                          ← FAIL CLOSED (the limiter fails open)
 *     4 after(): lastUsedAt if null or older than 5 min   (whiteboard D29)
 *     ──▶ { tokenId, name, scopes, kind }
 *
 *   who accepts what (premise 7):
 *     /api/mcp                      p4_ only
 *     /api/whiteboard/mcp (alias)   p4_ or wbt_   (tools accept read OR whiteboard:legacy, C5)
 *     /api/whiteboard/context.md    p4_ with read, or wbt_
 * ```
 *
 * ## Why this is not the owner cookie, and not `hasOwnerAccess`
 *
 * The cookie is a browser session behind an emailed OTP; an agent is a CLI process that needs
 * a long-lived, revocable credential that can be killed without logging the owner out. And
 * `hasOwnerAccess` honours `REQUIRE_ADMIN=false`, which is exactly the switch that must never
 * open these routes: a dev server started with it and exposed through a tunnel would hand the
 * whole site to anyone. So the agent routes go through `guardAgent` and nothing else.
 *
 * ## Why a wbt_ token is refused by /api/mcp without a lookup
 *
 * A `wbt_` token was created as "read-only, whiteboard only". Letting it into the site-wide
 * server would quietly give every existing token access nobody granted, so it keeps exactly
 * the two routes it had (premise 7) and gets the same 401 as garbage everywhere else.
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
 * would double that, for a timestamp the owner page shows as "~5 min ago" anyway. The
 * conditional update writes at most once per 5 minutes per token, and the first call always
 * writes (null is older than anything), which is what flips a fresh token to "Connected".
 * `after()` rather than an un-awaited promise, because Vercel may freeze the function the
 * moment the response is returned, and a fire-and-forget write would then silently never run.
 */

export type TokenKind = 'agent' | 'legacy'

/** Who is calling, as every tool sees it. Closed over per request (C1). */
export interface AgentContext {
  tokenId: string
  name: string
  scopes: TokenScope[]
  kind: TokenKind
}

const TOKEN_PREFIX = 'p4_'
const TOUCH_INTERVAL_MS = 5 * 60 * 1000
const BEARER = /^Bearer\s+((p4|wbt)_[A-Za-z0-9_-]{16,128})\s*$/
const KIND_OF_PREFIX: Record<string, TokenKind> = { p4: 'agent', wbt: 'legacy' }

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function toClientAgentToken(
  doc: Omit<AgentTokenDocument, 'hash'>
): ClientAgentToken {
  return {
    id: String(doc._id),
    name: doc.name,
    prefix: doc.prefix,
    scopes: MCP_SCOPES.filter(scope => doc.scopes.includes(scope)),
    createdAt: new Date(doc.createdAt).toISOString(),
    lastUsedAt: doc.lastUsedAt ? new Date(doc.lastUsedAt).toISOString() : null,
    revokedAt: doc.revokedAt ? new Date(doc.revokedAt).toISOString() : null,
  }
}

/** The plaintext is returned here and nowhere else, ever. */
export async function createAgentToken(
  name: string,
  scopes: readonly McpScope[] = DEFAULT_SCOPES
): Promise<{ token: string; record: ClientAgentToken }> {
  await connectDatabase()
  const token = `${TOKEN_PREFIX}${crypto.randomBytes(32).toString('base64url')}`
  const doc = await AgentTokenModel.create({
    name,
    prefix: token.slice(0, 8),
    hash: hashToken(token),
    // Canonical order and no duplicates, so two tokens with the same grants read the same.
    scopes: MCP_SCOPES.filter(scope => scopes.includes(scope)),
  })
  return { token, record: toClientAgentToken(doc.toObject()) }
}

/** Never includes the hash. Newest first; revoked tokens stay in the list, greyed out. */
export async function listAgentTokens(): Promise<ClientAgentToken[]> {
  await connectDatabase()
  const docs = await AgentTokenModel.find({}, { hash: 0 })
    .sort({ createdAt: -1 })
    .lean()
  return docs.map(toClientAgentToken)
}

export async function revokeAgentToken(
  id: string
): Promise<ClientAgentToken | null> {
  await connectDatabase()
  if (!isObjectIdString(id)) return null
  const doc = await AgentTokenModel.findOneAndUpdate(
    { _id: id, revokedAt: null },
    { $set: { revokedAt: new Date() } },
    { returnDocument: 'after', lean: true, projection: { hash: 0 } }
  )
  if (doc) return toClientAgentToken(doc)
  // Already revoked is still a success for the caller; unknown is not.
  const existing = await AgentTokenModel.findById(id, { hash: 0 }).lean()
  return existing ? toClientAgentToken(existing) : null
}

export type VerifyResult =
  { ok: true; token: AgentContext } | { ok: false; status: 401 | 503 }

/**
 * Header only. A token in the query string is not looked at, so it cannot be accepted. A
 * prefix the route does not accept is refused before any query, so `/api/mcp` never even
 * looks a `wbt_` token up.
 */
export async function verifyBearer(
  request: Request,
  accept: readonly TokenKind[]
): Promise<VerifyResult> {
  const match = BEARER.exec(request.headers.get('authorization') ?? '')
  if (!match) return { ok: false, status: 401 }
  const kind = KIND_OF_PREFIX[match[2]]
  if (!accept.includes(kind)) return { ok: false, status: 401 }

  const hash = hashToken(match[1])
  try {
    await connectDatabase()
    if (kind === 'legacy') {
      const doc = await WhiteboardTokenModel.findOne(
        { hash, revokedAt: null },
        { _id: 1, name: 1 }
      ).lean()
      if (!doc) return { ok: false, status: 401 }
      return {
        ok: true,
        token: {
          tokenId: String(doc._id),
          name: doc.name,
          scopes: [LEGACY_SCOPE],
          kind,
        },
      }
    }

    const doc = await AgentTokenModel.findOne(
      { hash, revokedAt: null },
      { _id: 1, name: 1, scopes: 1 }
    ).lean()
    if (!doc) return { ok: false, status: 401 }
    return {
      ok: true,
      token: {
        tokenId: String(doc._id),
        name: doc.name,
        scopes: MCP_SCOPES.filter(scope => doc.scopes.includes(scope)),
        kind,
      },
    }
  } catch (error) {
    console.error('[mcp] token lookup failed - refusing', error)
    return { ok: false, status: 503 }
  }
}

/**
 * Writes only when `lastUsedAt` is null or older than 5 minutes (D29).
 *
 * The guard always passes `kind`. Without it both collections are tried: an ObjectId is
 * unique across them, so at most one can match, and the legacy whiteboard tests touch a
 * `wbt_` record by id alone.
 */
export async function touchLastUsed(
  tokenId: string,
  now = new Date(),
  kind?: TokenKind
) {
  const filter = {
    _id: tokenId,
    $or: [
      { lastUsedAt: null },
      { lastUsedAt: { $lt: new Date(now.getTime() - TOUCH_INTERVAL_MS) } },
    ],
  }
  const update = { $set: { lastUsedAt: now } }
  await Promise.all([
    kind !== 'legacy' ? AgentTokenModel.updateOne(filter, update) : null,
    kind !== 'agent' ? WhiteboardTokenModel.updateOne(filter, update) : null,
  ])
}

export type GuardResult =
  { ok: true; token: AgentContext } | { ok: false; response: Response }

/**
 * The front door of every agent route: rate limit, then the bearer token, then a deferred
 * touch. Returns the verified token, or a response to send as-is.
 */
export async function guardAgent(
  request: NextRequest,
  { accept }: { accept: readonly TokenKind[] }
): Promise<GuardResult> {
  const limit = await checkRateLimit(clientIpFrom(request), MCP_AGENT_LIMIT)
  if (!limit.ok) {
    const res = agentError('Too many requests. Try again shortly.', 429)
    res.headers.set('Retry-After', String(limit.retryAfterSeconds))
    return { ok: false, response: res }
  }

  const verified = await verifyBearer(request, accept)
  if (!verified.ok) {
    if (verified.status === 503)
      return {
        ok: false,
        response: agentError('The agent API is unavailable right now.', 503),
      }
    // Same answer for missing, malformed, unknown, revoked and not-accepted-here.
    const res = agentError('Unauthorized', 401)
    res.headers.set('WWW-Authenticate', 'Bearer realm="port4lio"')
    return { ok: false, response: noStore(res) }
  }

  const { tokenId, kind } = verified.token
  after(async () => {
    try {
      await touchLastUsed(tokenId, new Date(), kind)
    } catch (error) {
      console.error('[mcp] lastUsedAt touch failed', error)
    }
  })
  return { ok: true, token: verified.token }
}
