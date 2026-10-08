import type { NextRequest } from 'next/server'

import { requireOwner } from '@/lib/require-owner'
import { getSharePassword } from '@/lib/whiteboard/data'
import { noStore, wbError, wbJson } from '@/lib/whiteboard/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

/**
 * [GET] /api/admin/whiteboard/boards/<id>/password - the share link's password, in plain text
 *
 * The Share menu's eye button, and the only route that ever answers with the password
 * (share-password.ts explains the encrypted copy it comes from). Owner only and `no-store`, and
 * never folded into the board list: that list is fetched on every canvas load, and the
 * password should cross the wire only when the Share panel is open.
 *
 * `{ passwordSet, password }` - `password: null` with `passwordSet: true` is a password whose
 * copy cannot be read back, which the menu asks the owner to type again.
 */
export async function GET(request: NextRequest, { params }: RouteContext) {
  const denied = requireOwner(request)
  if (denied) return noStore(denied)

  try {
    const { id } = await params
    const result = await getSharePassword(id)
    if (!result.ok) return wbError(result.error, result.status)
    return wbJson(result.value)
  } catch (error) {
    console.error('[whiteboard] share password read failed', error)
    return wbError('Unable to read the password right now.', 500)
  }
}
