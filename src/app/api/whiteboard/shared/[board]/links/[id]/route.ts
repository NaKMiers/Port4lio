import type { NextRequest } from 'next/server'

import { deleteLinkRoute, patchLinkRoute } from '@/lib/whiteboard/canvas-routes'
import { sharedBoardFor } from '@/lib/whiteboard/share'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ board: string; id: string }> }

/**
 * [PATCH]  /api/whiteboard/shared/<slug|id>/links/<id> - `{ label }` (edit links only)
 * [DELETE] /api/whiteboard/shared/<slug|id>/links/<id> - edit links only
 */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { board, id } = await params
  const access = await sharedBoardFor(request, board, 'write')
  if (!access.ok) return access.response
  return patchLinkRoute(request, access.board.id, id)
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const { board, id } = await params
  const access = await sharedBoardFor(request, board, 'write')
  if (!access.ok) return access.response
  return deleteLinkRoute(access.board.id, id)
}
