import 'server-only'

import crypto from 'node:crypto'

import { hashToken } from '@/lib/mcp/token'
import { connectDatabase } from '@/lib/mongodb'
import { isObjectIdString } from '@/lib/whiteboard/limits'
import type { ClientToken } from '@/lib/whiteboard/types'
import {
  WhiteboardTokenModel,
  type WhiteboardTokenDocument,
} from '@/models/WhiteboardToken'

/**
 * Legacy `wbt_` tokens: create, list, revoke, delete forever. Kept for one release, then
 * removed with the `/api/whiteboard/mcp` alias (mcp-plan.md T11).
 *
 * ```
 *   create:  wbt_ + 32 random bytes (base64url) ──▶ shown ONCE ──▶ only sha256(token) stored
 *   verify:  lib/mcp/token.ts guardAgent        ──▶ scope 'whiteboard:legacy'
 *            accepted ONLY by /api/whiteboard/mcp and /api/whiteboard/context.md
 * ```
 *
 * Verification, the rate limit and the throttled `lastUsedAt` touch moved to
 * `lib/mcp/token.ts` when the MCP became site-wide, because one front door serves both token
 * kinds. What stays here is the owner-side management of the old tokens.
 *
 * `createToken` still works (owner decision D4 in `docs/designs/mcp/acceptance.md`): the
 * `POST /api/admin/whiteboard/tokens` route keeps answering until the alias is removed, but
 * nothing in the UI calls it any more - the whiteboard's Agents button is a link to
 * `/admin/agents`, which only creates `p4_` tokens.
 */

const TOKEN_PREFIX = 'wbt_'

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

/**
 * Delete a revoked token's record for good, so it leaves the list. Only a revoked one: the
 * filter carries `revokedAt: { $ne: null }`, so an active token cannot be removed this way -
 * revoking is the one way a live key dies, and it is the step that shows up greyed out in the
 * list first. Deleting after that changes nothing an agent can observe: `verifyBearer` already
 * answers a revoked hash exactly like an unknown one.
 */
export async function deleteRevokedToken(
  id: string
): Promise<'deleted' | 'active' | 'missing'> {
  await connectDatabase()
  if (!isObjectIdString(id)) return 'missing'
  const { deletedCount } = await WhiteboardTokenModel.deleteOne({
    _id: id,
    revokedAt: { $ne: null },
  })
  if (deletedCount) return 'deleted'
  return (await WhiteboardTokenModel.exists({ _id: id })) ? 'active' : 'missing'
}
