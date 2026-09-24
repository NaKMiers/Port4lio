import type { NextRequest } from 'next/server'

import { readJsonBody } from '@/lib/read-json-body'
import { requireOwner } from '@/lib/require-owner'
import { noStore, wbError, wbJson } from '@/lib/whiteboard/http'
import {
  editVocab,
  getVocab,
  getVocabUsage,
  isVocabKind,
} from '@/lib/whiteboard/vocab-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * [GET]  /api/admin/whiteboard/vocab - `{ vocab, usage }`: the meanings and statuses, and how
 *        many cards (every board) carry each key
 * [POST] /api/admin/whiteboard/vocab - `{ kind: 'meaning' | 'status', label, key?, tone?,
 *        icon?, tracksStatus? }`; the key defaults to one made from the label
 *
 * ```
 *   every verb ──▶ requireOwner ──▶ vocab-service (the one write path) ──▶ { vocab, usage }
 * ```
 *
 * Every answer carries the whole list and the usage, so the dialog renders what the server
 * now holds rather than guessing - same reason as the blog taxonomy dialog.
 */
export async function GET(request: NextRequest) {
  const denied = requireOwner(request)
  if (denied) return noStore(denied)
  try {
    const [vocab, usage] = await Promise.all([getVocab(), getVocabUsage()])
    return wbJson({ vocab, usage })
  } catch (error) {
    console.error('[whiteboard] vocab read failed', error)
    return wbError('Unable to load meanings and statuses right now.', 500)
  }
}

export async function POST(request: NextRequest) {
  const denied = requireOwner(request)
  if (denied) return noStore(denied)

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return wbError(parsed.error, parsed.status)
  const body = (parsed.body ?? {}) as Record<string, unknown>
  if (typeof body.kind !== 'string' || !isVocabKind(body.kind))
    return wbError("kind must be 'meaning' or 'status'.", 400)

  try {
    const result = await editVocab({
      type: 'create',
      kind: body.kind,
      entry: body,
    })
    if (!result.ok) return wbError(result.error, result.status)
    return wbJson({ vocab: result.vocab, usage: await getVocabUsage() })
  } catch (error) {
    console.error('[whiteboard] vocab create failed', error)
    return wbError('Unable to save that right now.', 500)
  }
}
