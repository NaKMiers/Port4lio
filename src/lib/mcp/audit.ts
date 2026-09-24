import 'server-only'

import type { ClientAgentAction } from '@/lib/mcp/scopes'
import { connectDatabase } from '@/lib/mongodb'
import { AgentActionModel } from '@/models/AgentAction'

/**
 * The AgentAction feed for `/admin/agents`: newest first, writes, refusals and `find_order`
 * lookups alike. `resultPreview` is never sent to the page - it is the replay store, and it
 * can hold a whole draft. `argsPreview` is already bounded and email-masked at write time.
 */
export async function listRecentActions(
  limit = 50
): Promise<ClientAgentAction[]> {
  await connectDatabase()
  const rows = await AgentActionModel.find(
    {},
    { resultPreview: 0, argsHash: 0 }
  )
    .sort({ at: -1 })
    .limit(limit)
    .lean()
  return rows.map(row => ({
    id: String(row._id),
    tokenName: row.tokenName,
    tool: row.tool,
    outcome: row.outcome,
    reason: row.reason ?? null,
    target: row.target ?? null,
    argsPreview: row.argsPreview,
    at: row.at.toISOString(),
  }))
}
