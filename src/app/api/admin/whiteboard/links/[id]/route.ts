import type { NextRequest } from 'next/server'

import { requireOwner } from '@/lib/require-owner'
import { deleteLinkRoute, patchLinkRoute } from '@/lib/whiteboard/canvas-routes'
import { boardParam, noStore } from '@/lib/whiteboard/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

/**
 * [PATCH]  /api/admin/whiteboard/links/<id> - `{ label }`, the only editable field (D19)
 * [DELETE] /api/admin/whiteboard/links/<id>
 *
 * A label edit keeps the link's id, so an id an agent cited earlier still resolves. That is
 * why this exists instead of delete-and-recreate.
 */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const denied = requireOwner(request)
  if (denied) return noStore(denied)

  const scope = boardParam(request)
  if (!scope.ok) return scope.response

  const { id } = await params
  return patchLinkRoute(request, scope.board, id)
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const denied = requireOwner(request)
  if (denied) return noStore(denied)

  const scope = boardParam(request)
  if (!scope.ok) return scope.response

  const { id } = await params
  return deleteLinkRoute(scope.board, id)
}
