import type { NextRequest } from 'next/server'

import { requireOwner } from '@/lib/require-owner'
import { noStore, wbError, wbJson } from '@/lib/whiteboard/http'
import { deleteRevokedToken, revokeToken } from '@/lib/whiteboard/token'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

/**
 * [DELETE] /api/admin/whiteboard/tokens/<id>            - revoke
 * [DELETE] /api/admin/whiteboard/tokens/<id>?forever=1  - delete a REVOKED token's record
 *
 * Revoke sets `revokedAt` and keeps the record, so the list still shows the token, greyed
 * out. From the next request on, the token gets the same 401 as one that never existed.
 *
 * `?forever=1` removes that greyed-out record for good, and refuses an active token with a
 * 409: revoking stays the one way a live key dies (`deleteRevokedToken`). One handler for
 * both, so there is still exactly one owner gate on this path.
 */
export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const denied = requireOwner(request)
  if (denied) return noStore(denied)

  try {
    const { id } = await params

    if (request.nextUrl.searchParams.get('forever') === '1') {
      const result = await deleteRevokedToken(id)
      if (result === 'missing') return wbError('Token not found.', 404)
      if (result === 'active')
        return wbError('Revoke the token before deleting it.', 409)
      return wbJson({ deleted: true })
    }

    const record = await revokeToken(id)
    if (!record) return wbError('Token not found.', 404)
    return wbJson({ record })
  } catch (error) {
    console.error('[whiteboard] token delete failed', error)
    return wbError('Unable to change the token right now.', 500)
  }
}
