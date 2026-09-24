import type { NextRequest } from 'next/server'

import { requireOwner } from '@/lib/require-owner'
import { bulkMoveRoute, createItemRoute } from '@/lib/whiteboard/canvas-routes'
import { boardParam, noStore } from '@/lib/whiteboard/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * [POST]  /api/admin/whiteboard/items?board=<id> - create one item (idempotent upsert by `_id`)
 * [PATCH] /api/admin/whiteboard/items?board=<id> - bulk `{ updates: [{ id, x, y, parentId }] }`
 *
 * The body cap is 256 KB, not the 16 KB default: an ink stroke is up to 2,000 points and
 * a points array at that size is well past 16 KB. The point cap itself (413) lives in
 * `limits.ts`, so the inspector and restore refuse the same stroke.
 *
 * Bulk PATCH is all-or-nothing and names the bad entry (`{ error, id, index }`), so the
 * save queue can mark that one card and re-queue the others (R3-15). Rule 8 is applied to
 * every entry inside the same write (R3-2). Bodies live in canvas-routes.ts, shared with the
 * share link's routes.
 */
export async function POST(request: NextRequest) {
  const denied = requireOwner(request)
  if (denied) return noStore(denied)

  const scope = boardParam(request)
  if (!scope.ok) return scope.response
  return createItemRoute(request, scope.board)
}

export async function PATCH(request: NextRequest) {
  const denied = requireOwner(request)
  if (denied) return noStore(denied)

  const scope = boardParam(request)
  if (!scope.ok) return scope.response
  return bulkMoveRoute(request, scope.board)
}
