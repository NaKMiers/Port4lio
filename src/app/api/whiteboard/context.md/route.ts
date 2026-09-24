import type { NextRequest } from 'next/server'

import { hasAnyScope } from '@/lib/mcp/run-tool'
import { LEGACY_SCOPE } from '@/lib/mcp/scopes'
import { guardAgent } from '@/lib/mcp/token'
import { agentError, noStore } from '@/lib/mcp/transport'
import { renderContext } from '@/lib/whiteboard/context'
import { loadAgentVisible } from '@/lib/whiteboard/data'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * [GET] /api/whiteboard/context.md - the whole agent-visible board as markdown.
 *
 * ```
 *   guardAgent({ accept: ['agent', 'legacy'] }) ──▶ 429 / 401 / 503
 *     p4_ without read ──▶ 403
 *     p4_ with read, or wbt_ ──▶ renderContext(loadAgentVisible({ kind: 'all' }))
 * ```
 *
 * Bearer token only: never the owner cookie and never `REQUIRE_ADMIN` - see
 * `lib/mcp/token.ts`. The body is exactly what the Export sheet's "All" scope shows, because
 * both are `renderContext` over `loadAgentVisible({ kind: 'all' })`. Kept after the alias
 * goes: a `p4_` token with `read` is its long-term credential (premise 7).
 */
export async function GET(request: NextRequest) {
  const guard = await guardAgent(request, { accept: ['agent', 'legacy'] })
  if (!guard.ok) return guard.response
  if (!hasAnyScope(['read', LEGACY_SCOPE], guard.token))
    return agentError('This token does not have the read scope.', 403)

  try {
    const { input } = await loadAgentVisible({ kind: 'all' })
    const { markdown } = renderContext(input)
    return noStore(
      new Response(markdown || '# Whiteboard\n\nNo visible items.\n', {
        headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
      })
    )
  } catch (error) {
    console.error('[whiteboard] context.md failed', error)
    return agentError('Unable to build the context right now.', 500)
  }
}
