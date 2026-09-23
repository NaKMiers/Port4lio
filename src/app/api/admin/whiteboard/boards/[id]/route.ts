import type { NextRequest } from 'next/server'

import { readJsonBody } from '@/lib/read-json-body'
import { requireOwner } from '@/lib/require-owner'
import { deleteBoard, patchBoard } from '@/lib/whiteboard/data'
import { noStore, wbError, wbJson } from '@/lib/whiteboard/http'
import { validateBoardPatch } from '@/lib/whiteboard/limits'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

/**
 * [PATCH]  /api/admin/whiteboard/boards/<id> - `{ title }` and/or `{ includeInAi }` (D32)
 * [DELETE] /api/admin/whiteboard/boards/<id> - the board and everything on it
 *
 * The delete is hard and is not undoable from the canvas - undo lives inside a board and
 * dies with it - so the dialog in front of it is the real guard, and the last board cannot
 * be deleted at all (see `deleteBoard`).
 */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const denied = requireOwner(request)
  if (denied) return noStore(denied)

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return wbError(parsed.error, parsed.status)

  const checked = validateBoardPatch(parsed.body)
  if (!checked.ok) return wbError(checked.error, checked.status)

  try {
    const { id } = await params
    const result = await patchBoard(id, checked.value)
    if (!result.ok) return wbError(result.error, result.status)
    return wbJson({ board: result.value })
  } catch (error) {
    console.error('[whiteboard] board patch failed', error)
    return wbError('Unable to save the board right now.', 500)
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const denied = requireOwner(request)
  if (denied) return noStore(denied)

  try {
    const { id } = await params
    const result = await deleteBoard(id)
    if (!result.ok) return wbError(result.error, result.status)
    return wbJson(result.value)
  } catch (error) {
    console.error('[whiteboard] board delete failed', error)
    return wbError('Unable to delete the board right now.', 500)
  }
}
