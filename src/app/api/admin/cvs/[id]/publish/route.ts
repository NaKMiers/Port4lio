import { NextResponse, type NextRequest } from 'next/server'

import { jsonError, serviceErrorResponse } from '@/lib/api-response'
import { isCvId, publishCv } from '@/lib/cv/cv-service'
import { requireOwner } from '@/lib/require-owner'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/cvs/<id>/publish - make this the CV `/cv` prints.
 *
 * ```
 *   requireOwner ──▶ id not an ObjectId ──▶ 404
 *                ──▶ cv-service.publishCv ──▶ { publishedId } · 404
 * ```
 *
 * No body. The settings editor only offers Publish on a saved CV, so what goes live is what
 * was saved; see `cv-service.ts` for why publishing is one `$currentDate` write.
 */

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: RouteContext) {
  const denied = requireOwner(request)
  if (denied) return denied

  const { id } = await params
  if (!isCvId(id)) return jsonError('CV not found.', 404)

  try {
    const result = await publishCv(id)
    if (!result.ok) return serviceErrorResponse(result)
    return NextResponse.json({ publishedId: result.value.publishedId })
  } catch (error) {
    console.error('[api/admin/cvs/[id]/publish] publish failed', error)
    return jsonError('Unable to publish the CV right now.', 500)
  }
}
