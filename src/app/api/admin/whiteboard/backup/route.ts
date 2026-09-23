import type { NextRequest } from 'next/server'

import { connectDatabase } from '@/lib/mongodb'
import { requireOwner } from '@/lib/require-owner'
import { streamBackup } from '@/lib/whiteboard/data'
import { noStore, streamText, wbError } from '@/lib/whiteboard/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * [GET] /api/admin/whiteboard/backup - `{ version: 1, exportedAt, items, links }`, streamed.
 *
 * Everything, hidden items included - it is the owner's backup and the only way back from a
 * hard delete (D20). Streamed for the same 4.5 MB reason as the canvas load (D21). The file
 * is plain JSON in the same shapes the routes accept, which is what makes it restorable
 * through `POST /restore` and the same validators.
 */
export async function GET(request: NextRequest) {
  const denied = requireOwner(request)
  if (denied) return noStore(denied)

  try {
    await connectDatabase()
  } catch {
    return wbError('Unable to build the backup right now.', 500)
  }

  const day = new Date().toISOString().slice(0, 10)
  return streamText(streamBackup(), {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Disposition': `attachment; filename="whiteboard-backup-${day}.json"`,
  })
}
