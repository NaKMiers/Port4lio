import type { NextRequest } from 'next/server'

import { requireOwner } from '@/lib/require-owner'
import { createLinkRoute } from '@/lib/whiteboard/canvas-routes'
import { boardParam, noStore } from '@/lib/whiteboard/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * [POST] /api/admin/whiteboard/links - create a labelled link, idempotent by client `_id`.
 *
 * A replay of the same id is a 200 (R3-4). A different id with the same `{from, to, label}`
 * is a 400: duplicates are rejected, not merged. Both ends must already exist, which the
 * save queue guarantees by holding a link until both creates have resolved.
 */
export async function POST(request: NextRequest) {
  const denied = requireOwner(request)
  if (denied) return noStore(denied)

  const scope = boardParam(request)
  if (!scope.ok) return scope.response
  return createLinkRoute(request, scope.board)
}
