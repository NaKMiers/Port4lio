import type { NextRequest } from 'next/server'

import { renderContext } from '@/lib/whiteboard/context'
import { loadAgentVisible } from '@/lib/whiteboard/data'
import { noStore, wbError } from '@/lib/whiteboard/http'
import { guardAgent } from '@/lib/whiteboard/token'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * [GET] /api/whiteboard/context.md - the whole agent-visible board as markdown.
 *
 * Bearer token only (`guardAgent`: rate limit, then token, fail closed). Never the owner
 * cookie and never `REQUIRE_ADMIN` - see `lib/whiteboard/token.ts`. The body is exactly what
 * the Export sheet's "All" scope shows, because both are `renderContext` over
 * `loadAgentVisible({ kind: 'all' })`.
 */
export async function GET(request: NextRequest) {
  const denied = await guardAgent(request)
  if (denied) return denied

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
    return wbError('Unable to build the context right now.', 500)
  }
}
