import type { NextRequest } from 'next/server'

import { streamCanvas } from '@/lib/whiteboard/canvas-routes'
import { sharedBoardFor } from '@/lib/whiteboard/share'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ board: string }> }

/**
 * [GET] /api/whiteboard/shared/<slug|id> - a shared board for the canvas, streamed as NDJSON.
 *
 * The same stream as the owner's `/api/admin/whiteboard?board=<id>` (canvas-routes.ts), and
 * the whole board, hidden-from-AI cards included: "Include in AI" is about the owner's
 * agents, not about people, and a link the owner shared is a board they chose to show.
 * A board that is not shared is a 404 (share.ts).
 */
export async function GET(request: NextRequest, { params }: RouteContext) {
  const { board } = await params
  const access = await sharedBoardFor(request, board, 'read')
  if (!access.ok) return access.response
  return streamCanvas(access.board.id)
}
