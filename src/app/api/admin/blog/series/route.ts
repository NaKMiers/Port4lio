import { NextResponse, type NextRequest } from 'next/server'

import { jsonError, serviceErrorResponse } from '@/lib/api-response'
import { listSeriesWithCounts } from '@/lib/blog/series-data'
import { createSeries } from '@/lib/blog/taxonomy-service'
import { readJsonBody } from '@/lib/read-json-body'
import { requireOwner } from '@/lib/require-owner'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** A series is a slug, a title and one line of blurb. Nothing large. */
const MAX_BODY_BYTES = 8 * 1024

/**
 * [GET]  /api/admin/blog/series - the manage dialog's list, with post counts
 * [POST] /api/admin/blog/series - create one
 *
 * Gated by `requireOwner` as the first statement, matching the six handlers that came before
 * it - a 401 should cost an unauthorised caller nothing of ours.
 *
 * ## Why the editor reads its dropdown from here and not from a constant
 *
 * It used to import `POST_SERIES` directly, which was correct while the list was frozen at
 * build time. Now the list lives in a collection, and a client component cannot import
 * `SeriesModel` without pulling mongoose into the browser bundle - the exact failure
 * `lib/blog/constants.ts` documents at the top. So the dropdown is fetched, and this is the
 * only route that serves it.
 */
export async function GET(request: NextRequest) {
  const denied = requireOwner(request)
  if (denied) return denied

  try {
    return NextResponse.json({ series: await listSeriesWithCounts() })
  } catch {
    return jsonError('Unable to load series right now.', 500)
  }
}

export async function POST(request: NextRequest) {
  const denied = requireOwner(request)
  if (denied) return denied

  const parsed = await readJsonBody<{
    slug?: unknown
    title?: unknown
    blurb?: unknown
  }>(request, { maxBytes: MAX_BODY_BYTES })
  if (!parsed.ok) return jsonError(parsed.error, parsed.status)

  try {
    const result = await createSeries(parsed.body ?? {})
    if (!result.ok) return serviceErrorResponse(result)
    return NextResponse.json({ series: result.value })
  } catch {
    return jsonError('Unable to create the series right now.', 500)
  }
}
