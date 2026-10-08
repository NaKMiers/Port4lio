import { NextResponse, type NextRequest } from 'next/server'

import { jsonError, serviceErrorResponse } from '@/lib/api-response'
import { inspectPost } from '@/lib/blog/index-status-service'
import { requireOwner } from '@/lib/require-owner'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * [POST] /api/admin/blog/<id>/index-status - ask Google whether this post is indexed.
 *
 * ```
 *   requireOwner ──▶ inspectPost(id) ──▶ 200 { indexStatus }
 *                                   ├─▶ 429 / 502 { error, code, indexStatus }   written lastError, prior result kept
 *                                   └─▶ 404 / 409 / 503 { error, code }          nothing written
 * ```
 *
 * One URL Inspection call per request. The board's Check all calls this once per published
 * post from the browser, so no single invocation has to outlive a long list. Read-only on
 * Google's side: it reports status and never requests indexing (there is no API for that).
 * The failure bodies carry the `indexStatus` that was just written so the board can update
 * the row in place instead of reloading.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = requireOwner(request)
  if (denied) return denied

  const { id } = await params
  try {
    const result = await inspectPost(id)
    if (!result.ok) return serviceErrorResponse(result)
    return NextResponse.json({ indexStatus: result.value })
  } catch (error) {
    console.error('[api/admin/blog/index-status] check failed', error)
    return jsonError('Unable to check this post right now.', 500)
  }
}
