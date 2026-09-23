import type { NextRequest } from 'next/server'

import { readJsonBody } from '@/lib/read-json-body'
import { requireOwner } from '@/lib/require-owner'
import { renderContext } from '@/lib/whiteboard/context'
import { loadAgentVisible } from '@/lib/whiteboard/data'
import { noStore, wbError, wbJson } from '@/lib/whiteboard/http'
import { parseExportScope } from '@/lib/whiteboard/scope'
import type { ContextResponse } from '@/lib/whiteboard/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * [POST] /api/admin/whiteboard/context - the Export sheet's live preview.
 *
 * Body `{ scope }`, response `{ markdown, excludedCount, scopeHidden, ... }` (D25).
 *
 * Rendered on the server, through `loadAgentVisible`, although the owner's browser already
 * holds every item. That is the point: the owner's copy button and an agent's MCP call must
 * produce the same text through the same privacy filter, and a client-side renderer would be
 * a second filter that can drift. `excludedCount` / `scopeHidden` let the sheet say what the
 * filter dropped, so a pasted export is never silently missing cards.
 */
export async function POST(request: NextRequest) {
  const denied = requireOwner(request)
  if (denied) return noStore(denied)

  const parsed = await readJsonBody<{ scope?: unknown }>(request, {
    maxBytes: 64 * 1024,
  })
  if (!parsed.ok) return wbError(parsed.error, parsed.status)

  const scope = parseExportScope(parsed.body?.scope)
  if (!scope.ok) return wbError(scope.error, 400)

  try {
    const load = await loadAgentVisible(scope.value)
    const rendered = renderContext(load.input)
    const body: ContextResponse = {
      markdown: rendered.markdown,
      excludedCount: load.excludedCount,
      scopeHidden: load.scopeHidden,
      totalCount: rendered.totalCount,
      renderedCount: rendered.renderedCount,
      truncated: rendered.truncated,
    }
    return wbJson(body)
  } catch (error) {
    console.error('[whiteboard] context failed', error)
    return wbError('Unable to build the export right now.', 500)
  }
}
