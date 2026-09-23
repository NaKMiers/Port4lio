import type { NextRequest } from 'next/server'

import { readJsonBody } from '@/lib/read-json-body'
import { requireOwner } from '@/lib/require-owner'
import { deleteLink, patchLink } from '@/lib/whiteboard/data'
import { noStore, wbError, wbJson } from '@/lib/whiteboard/http'
import { validateLinkPatch } from '@/lib/whiteboard/limits'

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

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return wbError(parsed.error, parsed.status)

  const checked = validateLinkPatch(parsed.body)
  if (!checked.ok) return wbError(checked.error, checked.status)

  try {
    const { id } = await params
    const result = await patchLink(id, checked.value)
    if (!result.ok) return wbError(result.error, result.status)
    return wbJson({ link: result.value })
  } catch (error) {
    console.error('[whiteboard] link patch failed', error)
    return wbError('Unable to save the link right now.', 500)
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const denied = requireOwner(request)
  if (denied) return noStore(denied)

  try {
    const { id } = await params
    const result = await deleteLink(id)
    if (!result.ok) return wbError(result.error, result.status)
    return wbJson({ ok: true })
  } catch (error) {
    console.error('[whiteboard] link delete failed', error)
    return wbError('Unable to delete the link right now.', 500)
  }
}
