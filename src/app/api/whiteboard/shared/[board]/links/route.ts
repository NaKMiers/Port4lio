import type { NextRequest } from 'next/server'

import { createLinkRoute } from '@/lib/whiteboard/canvas-routes'
import { sharedBoardFor } from '@/lib/whiteboard/share'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ board: string }> }

/** [POST] /api/whiteboard/shared/<slug|id>/links - create a labelled link (edit links only). */
export async function POST(request: NextRequest, { params }: RouteContext) {
  const { board } = await params
  const access = await sharedBoardFor(request, board, 'write')
  if (!access.ok) return access.response
  return createLinkRoute(request, access.board.id)
}
