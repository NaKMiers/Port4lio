import type { NextRequest } from 'next/server'

import { readJsonBody } from '@/lib/read-json-body'
import { requireOwner } from '@/lib/require-owner'
import { createBoard, listBoards } from '@/lib/whiteboard/data'
import { noStore, wbError, wbJson } from '@/lib/whiteboard/http'
import { validateBoard } from '@/lib/whiteboard/limits'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * [GET]  /api/admin/whiteboard/boards - every board, oldest first, with item counts (D32)
 * [POST] /api/admin/whiteboard/boards - `{ title, includeInAi }`
 *
 * The GET is also what guarantees there is a board at all: `listBoards` creates the first
 * one and adopts the items written before boards existed. Owner-only, like everything under
 * `/api/admin`.
 */
export async function GET(request: NextRequest) {
  const denied = requireOwner(request)
  if (denied) return noStore(denied)

  try {
    return wbJson({ boards: await listBoards() })
  } catch (error) {
    console.error('[whiteboard] board list failed', error)
    return wbError('Unable to load your boards right now.', 500)
  }
}

export async function POST(request: NextRequest) {
  const denied = requireOwner(request)
  if (denied) return noStore(denied)

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return wbError(parsed.error, parsed.status)

  const checked = validateBoard(parsed.body)
  if (!checked.ok) return wbError(checked.error, checked.status)

  try {
    const result = await createBoard(checked.value)
    if (!result.ok) return wbError(result.error, result.status)
    return wbJson({ board: result.value }, { status: 201 })
  } catch (error) {
    console.error('[whiteboard] board create failed', error)
    return wbError('Unable to create the board right now.', 500)
  }
}
