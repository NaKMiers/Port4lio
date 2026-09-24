import type { NextRequest } from 'next/server'
import { z } from 'zod'

import { listRecentActions } from '@/lib/mcp/audit'
import { MCP_SCOPES } from '@/lib/mcp/scopes'
import { createAgentToken, listAgentTokens } from '@/lib/mcp/token'
import { agentError, agentJson, noStore } from '@/lib/mcp/transport'
import { readJsonBody } from '@/lib/read-json-body'
import { requireOwner } from '@/lib/require-owner'
import { isSingleLine } from '@/lib/whiteboard/limits'
import { listTokens } from '@/lib/whiteboard/token'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * [GET]  /api/admin/agents/tokens - `{ tokens, legacy, actions }`
 * [POST] /api/admin/agents/tokens - `{ name, scopes }`, returns the plaintext `p4_` token ONCE
 *
 * ```
 *   GET  ──▶ requireOwner ──▶ p4_ tokens + legacy wbt_ tokens + the last 50 AgentAction rows
 *   POST ──▶ requireOwner ──▶ one-line name, 1+ known scopes ──▶ createAgentToken ──▶ { token, record }
 * ```
 *
 * The lists never carry a hash, and the plaintext exists only in the POST response - which is
 * why every response here is `no-store`. Legacy `wbt_` tokens are listed so they can be
 * revoked; no new one is created from here (premise 7). The page polls GET while a fresh
 * token is unused, to flip it to "Connected".
 */

const CREATE_BODY = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .refine(isSingleLine, 'must be a single line'),
  scopes: z.array(z.enum(MCP_SCOPES)).min(1, 'pick at least one scope'),
})

export async function GET(request: NextRequest) {
  const denied = requireOwner(request)
  if (denied) return noStore(denied)

  try {
    const [tokens, legacy, actions] = await Promise.all([
      listAgentTokens(),
      listTokens(),
      listRecentActions(),
    ])
    return agentJson({ tokens, legacy, actions })
  } catch (error) {
    console.error('[admin/agents] token list failed', error)
    return agentError('Unable to load agent tokens right now.', 500)
  }
}

export async function POST(request: NextRequest) {
  const denied = requireOwner(request)
  if (denied) return noStore(denied)

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return agentError(parsed.error, parsed.status)

  const body = CREATE_BODY.safeParse(parsed.body)
  if (!body.success)
    return agentError(
      'A token needs a one-line name of up to 80 characters and at least one scope.',
      400
    )

  try {
    const { token, record } = await createAgentToken(
      body.data.name,
      body.data.scopes
    )
    return agentJson({ token, record })
  } catch (error) {
    console.error('[admin/agents] token create failed', error)
    return agentError('Unable to create a token right now.', 500)
  }
}
