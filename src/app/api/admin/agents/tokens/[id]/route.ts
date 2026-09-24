import type { NextRequest } from 'next/server'
import { z } from 'zod'

import { MCP_SCOPES } from '@/lib/mcp/scopes'
import {
  deleteRevokedAgentToken,
  revokeAgentToken,
  updateAgentTokenScopes,
} from '@/lib/mcp/token'
import { agentError, agentJson, noStore } from '@/lib/mcp/transport'
import { readJsonBody } from '@/lib/read-json-body'
import { requireOwner } from '@/lib/require-owner'
import { deleteRevokedToken, revokeToken } from '@/lib/whiteboard/token'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

/**
 * [PATCH]  /api/admin/agents/tokens/<id>            - `{ scopes }` for an unrevoked `p4_` token
 * [DELETE] /api/admin/agents/tokens/<id>            - revoke a `p4_` token, or a legacy `wbt_` one
 * [DELETE] /api/admin/agents/tokens/<id>?forever=1  - delete a REVOKED token's record, either kind
 *
 * ```
 *   PATCH  ──▶ requireOwner ──▶ 1+ known scopes ──▶ updateAgentTokenScopes
 *                                   ──▶ { record } | 409 revoked | 404
 *   DELETE ──▶ requireOwner ──▶ revokeAgentToken(id) ──▶ found? { record, kind: 'agent' }
 *                         └─ not found ──▶ revokeToken(id) (legacy) ──▶ { record, kind: 'legacy' } | 404
 *   DELETE ?forever=1 ──▶ requireOwner ──▶ deleteRevokedAgentToken ──▶ missing? deleteRevokedToken
 *                                   ──▶ { deleted, kind } | 409 still active | 404
 * ```
 *
 * Revoke sets `revokedAt` and keeps the record, so the list still shows the token, greyed
 * out. From the next request on, the token gets the same 401 as one that never existed.
 * `?forever=1` then removes that greyed-out record, and refuses an active token with a 409:
 * revoking stays the one way a live key dies, the same rule as the whiteboard's own route.
 * The Activity feed is unaffected, because each AgentAction row carries its own token name.
 *
 * A scope change is `p4_` only - a legacy token holds `whiteboard:legacy`, which is never
 * grantable - and the same body rule as create (1+ of the four scopes) applies. One handler
 * per path for both kinds, so there is one owner gate on it; ObjectIds are unique across the
 * two collections, so the id alone says which.
 */

const SCOPES_BODY = z.object({
  scopes: z.array(z.enum(MCP_SCOPES)).min(1, 'pick at least one scope'),
})

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const denied = requireOwner(request)
  if (denied) return noStore(denied)

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return agentError(parsed.error, parsed.status)

  const body = SCOPES_BODY.safeParse(parsed.body)
  if (!body.success)
    return agentError('A token needs at least one known scope.', 400)

  try {
    const { id } = await params
    const record = await updateAgentTokenScopes(id, body.data.scopes)
    if (record === 'revoked')
      return agentError('A revoked token cannot be changed.', 409)
    if (!record) return agentError('Token not found.', 404)
    return agentJson({ record })
  } catch (error) {
    console.error('[admin/agents] token scope change failed', error)
    return agentError('Unable to change the token right now.', 500)
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const denied = requireOwner(request)
  if (denied) return noStore(denied)

  try {
    const { id } = await params

    if (request.nextUrl.searchParams.get('forever') === '1') {
      let kind: 'agent' | 'legacy' = 'agent'
      let result = await deleteRevokedAgentToken(id)
      if (result === 'missing') {
        kind = 'legacy'
        result = await deleteRevokedToken(id)
      }
      if (result === 'missing') return agentError('Token not found.', 404)
      if (result === 'active')
        return agentError('Revoke the token before deleting it.', 409)
      return agentJson({ deleted: true, kind })
    }

    const agent = await revokeAgentToken(id)
    if (agent) return agentJson({ record: agent, kind: 'agent' })
    const legacy = await revokeToken(id)
    if (legacy) return agentJson({ record: legacy, kind: 'legacy' })
    return agentError('Token not found.', 404)
  } catch (error) {
    console.error('[admin/agents] token revoke failed', error)
    return agentError('Unable to change the token right now.', 500)
  }
}
