import type { NextRequest } from 'next/server'

import { readJsonBody } from '@/lib/read-json-body'
import { requireOwner } from '@/lib/require-owner'
import { deleteItem, patchItem } from '@/lib/whiteboard/data'
import { noStore, wbError, wbJson } from '@/lib/whiteboard/http'
import { ITEM_MAX_BODY_BYTES, validateItemPatch } from '@/lib/whiteboard/limits'

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
 */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const denied = requireOwner(request)
  if (denied) return noStore(denied)

  const parsed = await readJsonBody<Record<string, unknown>>(request, {
    maxBytes: ITEM_MAX_BODY_BYTES,
  })
  if (!parsed.ok) return wbError(parsed.error, parsed.status)

  const { keepChildrenPrivate, ...fields } = parsed.body ?? {}
  if (
    keepChildrenPrivate !== undefined &&
    typeof keepChildrenPrivate !== 'boolean'
  )
    return wbError('keepChildrenPrivate must be a boolean.', 400)

  const checked = validateItemPatch(fields)
  if (!checked.ok) return wbError(checked.error, checked.status)

  try {
    const { id } = await params
    const result = await patchItem(id, checked.value, {
      keepChildrenPrivate: keepChildrenPrivate === true,
    })
    if (!result.ok) return wbError(result.error, result.status)
    return wbJson({ item: result.value })
  } catch (error) {
    console.error('[whiteboard] patch failed', error)
    return wbError('Unable to save the item right now.', 500)
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const denied = requireOwner(request)
  if (denied) return noStore(denied)

  try {
    const { id } = await params
    const result = await deleteItem(id)
    if (!result.ok) return wbError(result.error, result.status)
    return wbJson(result.value)
  } catch (error) {
    console.error('[whiteboard] delete failed', error)
    return wbError('Unable to delete the item right now.', 500)
  }
}
