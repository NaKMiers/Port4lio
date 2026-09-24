import type { NextRequest } from 'next/server'

import { requireOwner } from '@/lib/require-owner'
import { streamCanvas } from '@/lib/whiteboard/canvas-routes'
import { boardParam, noStore } from '@/lib/whiteboard/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * [GET] /api/admin/whiteboard?board=<id> - one board for the canvas, streamed as NDJSON.
 *
 * ```
 *   {"t":"start","items":128,"links":40}
 *   {"t":"item",...}   frames first        (React Flow needs a parent before its children)
 *   {"t":"item",...}   then every other item
 *   {"t":"link",...}   then links          (a link needs both ends)
 *   {"t":"end","items":128,"links":40}     a stream without this line was cut
 * ```
 *
 * Streamed rather than one JSON body because Vercel refuses a non-streamed response over
 * 4.5 MB, and ink points make a board cross that without anyone noticing (D21). The order is
 * fixed by `streamBoard` (D28). Owner-only, and it includes hidden items: this is the owner's
 * own canvas, not an agent read. The body is `streamCanvas`, shared with the share link's
 * copy of this route (canvas-routes.ts).
 */
export async function GET(request: NextRequest) {
  const denied = requireOwner(request)
  if (denied) return noStore(denied)

  const scope = boardParam(request)
  if (!scope.ok) return scope.response
  return streamCanvas(scope.board)
}
