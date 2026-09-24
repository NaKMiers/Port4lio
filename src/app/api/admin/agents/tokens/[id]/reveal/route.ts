import type { NextRequest } from 'next/server'

import { revealAgentToken } from '@/lib/mcp/token'
import { agentError, agentJson, noStore } from '@/lib/mcp/transport'
import { requireOwner } from '@/lib/require-owner'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

/**
 * [POST] /api/admin/agents/tokens/<id>/reveal - `{ token }`, the plaintext `p4_` token
 *
 * ```
 *   requireOwner ──▶ revealAgentToken(id) ──▶ { token }
 *                                        ├─ 404 unknown
 *                                        ├─ 409 revoked
 *                                        └─ 409 unavailable (not sealed, or unopenable)
 * ```
 *
 * The owner's Copy button on each token row (token-vault.ts has why a sealed copy exists at
 * all). POST rather than GET so no prefetch, link preview or history entry ever asks for a
 * secret by accident, and `no-store` like every agents response. The list itself never
 * carries a token - only `copyable` - so the plaintext crosses the wire only when the owner
 * clicks.
 */
export async function POST(request: NextRequest, { params }: RouteContext) {
  const denied = requireOwner(request)
  if (denied) return noStore(denied)

  try {
    const { id } = await params
    const result = await revealAgentToken(id)
    if (result === null) return agentError('Token not found.', 404)
    if (result === 'revoked')
      return agentError('A revoked token cannot be copied.', 409)
    if (result === 'unavailable')
      return agentError(
        'This token cannot be copied again - it was created before tokens were kept for copying. Create a new one.',
        409
      )
    return agentJson({ token: result })
  } catch (error) {
    console.error('[admin/agents] token reveal failed', error)
    return agentError('Unable to copy the token right now.', 500)
  }
}
