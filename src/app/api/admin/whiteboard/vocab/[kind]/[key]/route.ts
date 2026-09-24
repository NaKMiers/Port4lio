import type { NextRequest } from 'next/server'

import { readJsonBody } from '@/lib/read-json-body'
import { requireOwner } from '@/lib/require-owner'
import { noStore, wbError, wbJson } from '@/lib/whiteboard/http'
import {
  editVocab,
  getVocabUsage,
  isVocabKind,
} from '@/lib/whiteboard/vocab-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ kind: string; key: string }> }

/**
 * [PATCH]  /api/admin/whiteboard/vocab/<meaning|status>/<key> - `{ label?, tone?, icon?,
 *          tracksStatus? }`, or `{ to: <index> }` to move it in the list. The key itself is
 *          permanent (items store it), so sending a different one is a 400.
 * [DELETE] /api/admin/whiteboard/vocab/<meaning|status>/<key> - 409 while any card uses it
 *
 * Both answer `{ vocab, usage }` - see the collection route.
 */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const denied = requireOwner(request)
  if (denied) return noStore(denied)

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return wbError(parsed.error, parsed.status)
  const body = (parsed.body ?? {}) as Record<string, unknown>

  const { kind, key } = await params
  if (!isVocabKind(kind)) return wbError('Not found.', 404)

  try {
    const result = await editVocab(
      'to' in body
        ? { type: 'move', kind, key, to: Number(body.to) }
        : { type: 'update', kind, key, changes: body }
    )
    if (!result.ok) return wbError(result.error, result.status)
    return wbJson({ vocab: result.vocab, usage: await getVocabUsage() })
  } catch (error) {
    console.error('[whiteboard] vocab update failed', error)
    return wbError('Unable to save that right now.', 500)
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const denied = requireOwner(request)
  if (denied) return noStore(denied)

  const { kind, key } = await params
  if (!isVocabKind(kind)) return wbError('Not found.', 404)

  try {
    const result = await editVocab({ type: 'delete', kind, key })
    if (!result.ok) return wbError(result.error, result.status)
    return wbJson({ vocab: result.vocab, usage: await getVocabUsage() })
  } catch (error) {
    console.error('[whiteboard] vocab delete failed', error)
    return wbError('Unable to delete that right now.', 500)
  }
}
