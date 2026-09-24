import type { NextRequest } from 'next/server'

import { revokeAgentToken } from '@/lib/mcp/token'
import { agentError, agentJson, noStore } from '@/lib/mcp/transport'
import { requireOwner } from '@/lib/require-owner'
import { revokeToken } from '@/lib/whiteboard/token'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

/**
 * [DELETE] /api/admin/agents/tokens/<id> - revoke a `p4_` token, or a legacy `wbt_` one.
 *
 * ```
 *   requireOwner ──▶ revokeAgentToken(id) ──▶ found? { record, kind: 'agent' }
 *                         └─ not found ──▶ revokeToken(id) (legacy) ──▶ { record, kind: 'legacy' } | 404
 * ```
 *
 * Revoke sets `revokedAt` and keeps the record, so the list still shows the token, greyed
 * out, and the audit feed can still name it. From the next request on, the token gets the
 * same 401 as one that never existed. One handler for both kinds, so there is one owner gate
 * on this path; ObjectIds are unique across the two collections, so the id alone says which.
 */
export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const denied = requireOwner(request)
  if (denied) return noStore(denied)

  try {
    const { id } = await params
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
