import type { NextRequest } from 'next/server'

import { wbError, wbJson } from '@/lib/whiteboard/http'
import { sharedBoardFor } from '@/lib/whiteboard/share'
import { peekVocab } from '@/lib/whiteboard/vocab-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ board: string }> }

/**
 * [GET] /api/whiteboard/shared/<slug|id>/vocab - the meanings and statuses, to draw the chips.
 *
 * The list only. The owner's route also answers how many cards carry each key, counted
 * across EVERY board, which says something about boards this link was never for - and the
 * shared canvas has no Manage dialog to show it in. Editing the list stays owner-only, and
 * the read is `peekVocab`, which never seeds: an anonymous GET must not write.
 */
export async function GET(request: NextRequest, { params }: RouteContext) {
  const { board } = await params
  const access = await sharedBoardFor(request, board, 'read')
  if (!access.ok) return access.response
  try {
    return wbJson({ vocab: await peekVocab() })
  } catch (error) {
    console.error('[whiteboard] shared vocab read failed', error)
    return wbError('Unable to load meanings and statuses right now.', 500)
  }
}
