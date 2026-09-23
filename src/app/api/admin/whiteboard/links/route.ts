import type { NextRequest } from 'next/server'

import { readJsonBody } from '@/lib/read-json-body'
import { requireOwner } from '@/lib/require-owner'
import { createLink } from '@/lib/whiteboard/data'
import { boardParam, noStore, wbError, wbJson } from '@/lib/whiteboard/http'
import { validateLink } from '@/lib/whiteboard/limits'

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

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return wbError(parsed.error, parsed.status)

  const checked = validateLink(parsed.body)
  if (!checked.ok) return wbError(checked.error, checked.status)

  try {
    const result = await createLink(scope.board, checked.value)
    if (!result.ok) return wbError(result.error, result.status)
    return wbJson({ link: result.value })
  } catch (error) {
    console.error('[whiteboard] link create failed', error)
    return wbError('Unable to save the link right now.', 500)
  }
}
