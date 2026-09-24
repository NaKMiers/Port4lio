import type { NextRequest } from 'next/server'

import { WHITEBOARD_ALIAS_SERVER, handleMcpRequest } from '@/lib/mcp/server'
import { guardAgent } from '@/lib/mcp/token'
import { methodNotAllowed } from '@/lib/mcp/transport'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * [POST] /api/whiteboard/mcp - the old whiteboard MCP, kept as an alias for one release.
 *
 * ```
 *   POST ──▶ guardAgent({ accept: ['agent', 'legacy'] })     429 / 401 / 503
 *          ──▶ handleMcpRequest(WHITEBOARD_ALIAS_SERVER)
 *                get_overview · search_context · get_item      the same functions as
 *                                                               whiteboard_* on /api/mcp
 *                each accepts read OR whiteboard:legacy (C5)
 *   GET, DELETE ──▶ 405
 * ```
 *
 * Existing `claude mcp add` configs point here with a `wbt_` token, and they keep exactly the
 * access they had (premise 7): these three tools and `context.md`, nothing else. A `p4_`
 * token with `read` works here too, so a config can move to the new token before it moves to
 * the new URL. Removed, together with `WhiteboardToken`, one release later (mcp-plan.md T11).
 */
export async function POST(request: NextRequest) {
  const guard = await guardAgent(request, { accept: ['agent', 'legacy'] })
  if (!guard.ok) return guard.response
  return handleMcpRequest(request, guard.token, WHITEBOARD_ALIAS_SERVER)
}

export async function GET() {
  return methodNotAllowed()
}

export async function DELETE() {
  return methodNotAllowed()
}
