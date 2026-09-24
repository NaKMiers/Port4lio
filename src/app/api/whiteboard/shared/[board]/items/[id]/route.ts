import type { NextRequest } from 'next/server'

import { deleteItemRoute, patchItemRoute } from '@/lib/whiteboard/canvas-routes'
import { sharedBoardFor } from '@/lib/whiteboard/share'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ board: string; id: string }> }

/**
 * [PATCH]  /api/whiteboard/shared/<slug|id>/items/<id> - edit links only, no AI switch
 * [DELETE] /api/whiteboard/shared/<slug|id>/items/<id> - edit links only
 *
 * `aiControls: false`: what the owner's agents can read is the owner's call, so the
 * `includeInAi` field is dropped here (canvas-routes.ts).
 */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { board, id } = await params
  const access = await sharedBoardFor(request, board, 'write')
  if (!access.ok) return access.response
  return patchItemRoute(request, access.board.id, id, { aiControls: false })
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const { board, id } = await params
  const access = await sharedBoardFor(request, board, 'write')
  if (!access.ok) return access.response
  return deleteItemRoute(access.board.id, id)
}
