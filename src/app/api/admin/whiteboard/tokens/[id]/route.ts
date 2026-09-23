import type { NextRequest } from 'next/server'

import { requireOwner } from '@/lib/require-owner'
import { noStore, wbError, wbJson } from '@/lib/whiteboard/http'
import { revokeToken } from '@/lib/whiteboard/token'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

/**
 * [DELETE] /api/admin/whiteboard/tokens/<id> - revoke. Sets `revokedAt` and keeps the record,
 * so the list still shows the token, greyed out. From the next request on, the token gets the
 * same 401 as one that never existed.
 */
export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const denied = requireOwner(request)
  if (denied) return noStore(denied)

  try {
    const { id } = await params
    const record = await revokeToken(id)
    if (!record) return wbError('Token not found.', 404)
    return wbJson({ record })
  } catch (error) {
    console.error('[whiteboard] token revoke failed', error)
    return wbError('Unable to revoke the token right now.', 500)
  }
}
