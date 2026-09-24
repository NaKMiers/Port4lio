import type { NextRequest } from 'next/server'

import { requireOwner } from '@/lib/require-owner'
import { deleteItemRoute, patchItemRoute } from '@/lib/whiteboard/canvas-routes'
import { boardParam, noStore } from '@/lib/whiteboard/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

/**
 * [PATCH]  /api/admin/whiteboard/items/<id> - the fields that changed, and only those (R3-1)
 * [DELETE] /api/admin/whiteboard/items/<id> - hard delete, in the safe order (see data.ts)
 *
 * A PATCH to a missing item is a 404, which the save queue discards rather than retries
 * (R3-6). The response is the whole resulting document, because the server may have
 * written more than was sent: leaving a hidden frame sets `includeInAi: false` (rule 8),
 * and the client merges that back so its badge and toggle tell the truth.
 *
 * `keepChildrenPrivate` rides along on a frame un-hide (D24) and is not an item field.
 * The owner has `aiControls`; the share link's copy of this route does not (canvas-routes.ts).
 */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const denied = requireOwner(request)
  if (denied) return noStore(denied)

  const scope = boardParam(request)
  if (!scope.ok) return scope.response

  const { id } = await params
  return patchItemRoute(request, scope.board, id, { aiControls: true })
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const denied = requireOwner(request)
  if (denied) return noStore(denied)

  const scope = boardParam(request)
  if (!scope.ok) return scope.response

  const { id } = await params
  return deleteItemRoute(scope.board, id)
}
