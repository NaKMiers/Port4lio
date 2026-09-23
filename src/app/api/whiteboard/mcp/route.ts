import type { NextRequest } from 'next/server'

import { noStore, wbJson } from '@/lib/whiteboard/http'
import { mcpHandler, sseToJson, withAcceptBoth } from '@/lib/whiteboard/mcp'
import { guardAgent } from '@/lib/whiteboard/token'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * [POST] /api/whiteboard/mcp - stateless streamable-HTTP MCP, JSON responses (D17).
 *
 * ```
 *   POST ──▶ guardAgent (429 / 401 / 503) ──▶ mcp-handler ──▶ SSE unwrapped to JSON
 *              initialize, ping, tools/list, tools/call           200 JSON
 *              any notification (no id)                           202, no body
 *              an unknown request (with an id)                    JSON-RPC -32601
 *   GET, DELETE ──▶ 405                     (no session, no server-initiated stream)
 * ```
 *
 * Measured against mcp-handler 2.2 before this was written: it already answers 405 / 202 /
 * -32601 as approved, but replies to requests as `text/event-stream`, which `sseToJson`
 * unwraps. GET and DELETE are answered here without touching the database or the token -
 * there is no session to operate on, so there is nothing to authorise.
 */
export async function POST(request: NextRequest) {
  const denied = await guardAgent(request)
  if (denied) return denied

  const response = await mcpHandler(withAcceptBoth(request))
  return noStore(await sseToJson(response))
}

function methodNotAllowed() {
  const res = wbJson(
    {
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed.' },
      id: null,
    },
    { status: 405 }
  )
  res.headers.set('Allow', 'POST')
  return res
}

export async function GET() {
  return methodNotAllowed()
}

export async function DELETE() {
  return methodNotAllowed()
}
