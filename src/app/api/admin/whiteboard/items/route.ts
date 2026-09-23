import type { NextRequest } from 'next/server'

import { readJsonBody } from '@/lib/read-json-body'
import { requireOwner } from '@/lib/require-owner'
import { bulkMoveItems, createItem } from '@/lib/whiteboard/data'
import { noStore, wbEntryError, wbError, wbJson } from '@/lib/whiteboard/http'
import {
  ITEM_MAX_BODY_BYTES,
  validateBulkUpdates,
  validateItem,
} from '@/lib/whiteboard/limits'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * [POST]  /api/admin/whiteboard/items - create one item (idempotent upsert by client `_id`)
 * [PATCH] /api/admin/whiteboard/items - bulk position update `{ updates: [{ id, x, y, parentId }] }`
 *
 * The body cap is 256 KB, not the 16 KB default: an ink stroke is up to 2,000 points and
 * a points array at that size is well past 16 KB. The point cap itself (413) lives in
 * `limits.ts`, so the inspector and restore refuse the same stroke.
 *
 * Bulk PATCH is all-or-nothing and names the bad entry (`{ error, id, index }`), so the
 * save queue can mark that one card and re-queue the others (R3-15). Rule 8 is applied to
 * every entry inside the same write (R3-2).
 */
export async function POST(request: NextRequest) {
  const denied = requireOwner(request)
  if (denied) return noStore(denied)

  const parsed = await readJsonBody(request, { maxBytes: ITEM_MAX_BODY_BYTES })
  if (!parsed.ok) return wbError(parsed.error, parsed.status)

  const checked = validateItem(parsed.body)
  if (!checked.ok) return wbError(checked.error, checked.status)

  try {
    const result = await createItem(checked.value)
    if (!result.ok) return wbError(result.error, result.status)
    return wbJson({ item: result.value })
  } catch (error) {
    console.error('[whiteboard] create failed', error)
    return wbError('Unable to save the item right now.', 500)
  }
}

export async function PATCH(request: NextRequest) {
  const denied = requireOwner(request)
  if (denied) return noStore(denied)

  const parsed = await readJsonBody(request, { maxBytes: ITEM_MAX_BODY_BYTES })
  if (!parsed.ok) return wbError(parsed.error, parsed.status)

  const checked = validateBulkUpdates(parsed.body)
  if (!checked.ok)
    return wbEntryError(checked.error, checked.status, {
      id: checked.id,
      index: checked.index,
    })

  try {
    const result = await bulkMoveItems(checked.value)
    if (!result.ok)
      return wbEntryError(result.error, result.status, {
        id: result.id,
        index: result.index,
      })
    return wbJson({ items: result.value })
  } catch (error) {
    console.error('[whiteboard] bulk move failed', error)
    return wbError('Unable to save the positions right now.', 500)
  }
}
