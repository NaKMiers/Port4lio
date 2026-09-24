import { NextResponse, type NextRequest } from 'next/server'

import { jsonError, serviceErrorResponse } from '@/lib/api-response'
import { listKindsWithCounts } from '@/lib/blog/kind-data'
import { createKind } from '@/lib/blog/taxonomy-service'
import { readJsonBody } from '@/lib/read-json-body'
import { requireOwner } from '@/lib/require-owner'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_BODY_BYTES = 8 * 1024

/**
 * [GET]  /api/admin/blog/kinds - the manage dialog's list, with post counts
 * [POST] /api/admin/blog/kinds - create one
 *
 * The mirror of `/api/admin/blog/series`, down to the shape of the responses. Kept as its own
 * route rather than a `?type=` parameter on that one: the two collections have different
 * delete rules (a post must always HAVE a kind, and may have no series), and a handler that
 * branched on a query string to decide which invariant to enforce is a handler where the
 * wrong branch is one typo away. The rules themselves live in `lib/blog/taxonomy-service.ts`.
 */
export async function GET(request: NextRequest) {
  const denied = requireOwner(request)
  if (denied) return denied

  try {
    return NextResponse.json({ kinds: await listKindsWithCounts() })
  } catch {
    return jsonError('Unable to load kinds right now.', 500)
  }
}

export async function POST(request: NextRequest) {
  const denied = requireOwner(request)
  if (denied) return denied

  const parsed = await readJsonBody<{
    slug?: unknown
    label?: unknown
    eyebrow?: unknown
  }>(request, { maxBytes: MAX_BODY_BYTES })
  if (!parsed.ok) return jsonError(parsed.error, parsed.status)

  try {
    const result = await createKind(parsed.body ?? {})
    if (!result.ok) return serviceErrorResponse(result)
    return NextResponse.json({ kind: result.value })
  } catch {
    return jsonError('Unable to create the kind right now.', 500)
  }
}
