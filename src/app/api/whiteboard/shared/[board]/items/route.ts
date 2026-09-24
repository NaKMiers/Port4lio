import type { NextRequest } from 'next/server'

import { bulkMoveRoute, createItemRoute } from '@/lib/whiteboard/canvas-routes'
import { SHARED_BOARD_MAX_ITEMS } from '@/lib/whiteboard/limits'
import { sharedBoardFor } from '@/lib/whiteboard/share'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ board: string }> }

/**
 * [POST]  /api/whiteboard/shared/<slug|id>/items - create one item (edit links only)
 * [PATCH] /api/whiteboard/shared/<slug|id>/items - bulk positions (edit links only)
 *
 * The owner routes' bodies (canvas-routes.ts) behind the share gate (share.ts). A create
 * is refused with 409 once the board holds SHARED_BOARD_MAX_ITEMS - a 4xx the save queue
 * marks as refused rather than retrying.
 */
export async function POST(request: NextRequest, { params }: RouteContext) {
  const { board } = await params
  const access = await sharedBoardFor(request, board, 'write')
  if (!access.ok) return access.response
  return createItemRoute(request, access.board.id, {
    maxItems: SHARED_BOARD_MAX_ITEMS,
  })
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { board } = await params
  const access = await sharedBoardFor(request, board, 'write')
  if (!access.ok) return access.response
  return bulkMoveRoute(request, access.board.id)
}
