import type { NextRequest } from 'next/server'

import { readJsonBody } from '@/lib/read-json-body'
import { requireOwner } from '@/lib/require-owner'
import { restoreBatch } from '@/lib/whiteboard/data'
import {
  boardParam,
  noStore,
  wbEntryError,
  wbError,
  wbJson,
} from '@/lib/whiteboard/http'
import { RESTORE_MAX_BODY_BYTES } from '@/lib/whiteboard/limits'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * [POST] /api/admin/whiteboard/restore - one batch `{ dryRun, overwrite, items, links }`.
 *
 * ```
 *   client: validateBackupFile(whole file) ── fail ──▶ "which entry and why", zero writes
 *        │ ok
 *        ▼
 *   dry run, batch by batch  ──▶ counts ("N items, M links, K already exist") ──▶ confirm
 *        ▼
 *   real run, <= 2 MB batches: frames, items, links   (each re-validated here)
 *        │ batch 3 of 5 fails
 *        ▼
 *   "Stopped at 3/5 - Run again"  ──▶ upserts by _id, so the re-run converges
 * ```
 *
 * One 2 MB batch per request, because Vercel refuses a request body over 4.5 MB (D21 - this
 * superseded D20's single 16 MB request). The server trusts nothing the client checked.
 */
export async function POST(request: NextRequest) {
  const denied = requireOwner(request)
  if (denied) return noStore(denied)

  const scope = boardParam(request)
  if (!scope.ok) return scope.response

  const parsed = await readJsonBody<Record<string, unknown>>(request, {
    maxBytes: RESTORE_MAX_BODY_BYTES,
  })
  if (!parsed.ok) return wbError(parsed.error, parsed.status)

  const { dryRun, overwrite, items = [], links = [] } = parsed.body ?? {}
  if (typeof dryRun !== 'boolean' || typeof overwrite !== 'boolean')
    return wbError('dryRun and overwrite must be booleans.', 400)
  if (!Array.isArray(items) || !Array.isArray(links))
    return wbError('items and links must be arrays.', 400)

  try {
    const result = await restoreBatch(scope.board, {
      dryRun,
      overwrite,
      items,
      links,
    })
    if (!result.ok)
      return wbEntryError(result.error, result.status, { index: result.index })
    return wbJson(result.value)
  } catch (error) {
    console.error('[whiteboard] restore failed', error)
    return wbError('Unable to restore right now.', 500)
  }
}
