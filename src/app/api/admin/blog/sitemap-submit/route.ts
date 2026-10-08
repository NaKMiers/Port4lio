import { NextResponse, type NextRequest } from 'next/server'

import { jsonError, serviceErrorResponse } from '@/lib/api-response'
import { resubmitSitemap } from '@/lib/blog/index-status-service'
import { requireOwner } from '@/lib/require-owner'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * [POST] /api/admin/blog/sitemap-submit - resubmit `/sitemap.xml` to Search Console.
 *
 * ```
 *   requireOwner ──▶ resubmitSitemap('manual') ──▶ 200 { sitemap }
 *                                              ├─▶ 429 / 502 { error, code, sitemap }
 *                                              └─▶ 503 { error, code }   not configured, nothing written
 * ```
 *
 * A prompt for Google to re-read a sitemap it already knows about through `robots.txt`, not a
 * request to index anything. Publishing does the same thing automatically
 * (`sitemap-resubmit.ts`); this button is for after a batch of edits, or to retry a failed
 * automatic one.
 */
export async function POST(request: NextRequest) {
  const denied = requireOwner(request)
  if (denied) return denied

  try {
    const result = await resubmitSitemap('manual')
    if (!result.ok) return serviceErrorResponse(result)
    return NextResponse.json({ sitemap: result.value })
  } catch (error) {
    console.error('[api/admin/blog/sitemap-submit] submit failed', error)
    return jsonError('Unable to resubmit the sitemap right now.', 500)
  }
}
