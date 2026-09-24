import type { NextRequest } from 'next/server'

import { SITE_SERVER, handleMcpRequest } from '@/lib/mcp/server'
import { guardAgent } from '@/lib/mcp/token'
import { methodNotAllowed } from '@/lib/mcp/transport'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 300 s, the Vercel Pro ceiling: `illustrate_post` answers at once and keeps drawing in
 * `after()`, which runs inside this same budget and stops starting images at 85% of it
 * (mcp-plan.md R2). Every other tool answers in seconds.
 */
export const maxDuration = 300

/**
 * [POST] /api/mcp - the site-wide MCP server. Stateless streamable HTTP, JSON responses.
 *
 * ```
 *   POST ──▶ guardAgent({ accept: ['agent'] })      429 / 401 / 503; a wbt_ token is a 401
 *          ──▶ handleMcpRequest(SITE_SERVER)         tools + prompts filtered by the token's scopes
 *                 out-of-scope registry tool ──▶ isError + refused row (R1)
 *                 initialize, ping, tools/*, prompts/* ──▶ 200 JSON
 *                 any notification (no id)           ──▶ 202, no body
 *   GET, DELETE ──▶ 405                     (no session, no server-initiated stream)
 * ```
 *
 * Thin on purpose: the guard is `lib/mcp/token.ts`, the tool list and every call are
 * `lib/mcp/server.ts` and `lib/mcp/run-tool.ts`. GET and DELETE are answered without touching
 * the database or the token - there is no session to operate on, so nothing to authorise.
 */
export async function POST(request: NextRequest) {
  const guard = await guardAgent(request, { accept: ['agent'] })
  if (!guard.ok) return guard.response
  return handleMcpRequest(request, guard.token, SITE_SERVER)
}

export async function GET() {
  return methodNotAllowed()
}

export async function DELETE() {
  return methodNotAllowed()
}
