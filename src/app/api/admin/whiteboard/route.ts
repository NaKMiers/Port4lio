import type { NextRequest } from 'next/server'

import { connectDatabase } from '@/lib/mongodb'
import { requireOwner } from '@/lib/require-owner'
import { streamBoard } from '@/lib/whiteboard/data'
import { boardParam, noStore, streamText, wbError } from '@/lib/whiteboard/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * [GET] /api/admin/whiteboard?board=<id> - one board for the canvas, streamed as NDJSON.
 *
 * ```
 *   {"t":"start","items":128,"links":40}
 *   {"t":"item",...}   frames first        (React Flow needs a parent before its children)
 *   {"t":"item",...}   then every other item
 *   {"t":"link",...}   then links          (a link needs both ends)
 *   {"t":"end","items":128,"links":40}     a stream without this line was cut
 * ```
 *
 * Streamed rather than one JSON body because Vercel refuses a non-streamed response over
 * 4.5 MB, and ink points make a board cross that without anyone noticing (D21). The order is
 * fixed by `streamBoard` (D28). Owner-only, and it includes hidden items: this is the owner's
 * own canvas, not an agent read.
 */
export async function GET(request: NextRequest) {
  const denied = requireOwner(request)
  if (denied) return noStore(denied)

  const scope = boardParam(request)
  if (!scope.ok) return scope.response
  const { board } = scope

  try {
    // Connect before the stream starts, so "database down" is a clean 500 rather than a
    // stream that dies on its first line.
    await connectDatabase()
  } catch {
    return wbError('Unable to load the whiteboard right now.', 500)
  }

  async function* lines() {
    for await (const line of streamBoard(board))
      yield `${JSON.stringify(line)}\n`
  }
  return streamText(lines(), {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
  })
}
