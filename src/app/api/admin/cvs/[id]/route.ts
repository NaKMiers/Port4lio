import { NextResponse, type NextRequest } from 'next/server'

import { jsonError, serviceErrorResponse } from '@/lib/api-response'
import { deleteCv, isCvId, saveCv } from '@/lib/cv/cv-service'
import { readJsonBody } from '@/lib/read-json-body'
import { requireOwner } from '@/lib/require-owner'
import { MAX_CV_JSON_BYTES } from '@/lib/upload-limits'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * [PATCH|DELETE] /api/admin/cvs/<id> - Save CV, Rename, Delete.
 *
 * ```
 *   PATCH   requireOwner ──▶ id not an ObjectId ──▶ 404
 *                        ──▶ readJsonBody (256 KB) ──▶ 413 / 400
 *                        ──▶ base: the updatedAt the editor loaded, or '*' ──▶ else 400
 *                        ──▶ cv-service.saveCv ──▶ { cv } · 409 stale + updatedAt · 409 labelTaken · 404
 *   DELETE  requireOwner ──▶ cv-service.deleteCv ──▶ { ok } · 409 published · 404
 * ```
 *
 * `base` is required rather than optional, unlike the profile's header: every caller of this
 * route is the CV editor, which always has one, so an absent base can only be a bug - and
 * treating it as "overwrite" would turn that bug into silently lost work (OV-5).
 */

type RouteContext = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const denied = requireOwner(request)
  if (denied) return denied

  const { id } = await params
  if (!isCvId(id)) return jsonError('CV not found.', 404)

  const parsed = await readJsonBody<{
    label?: unknown
    resume?: unknown
    base?: unknown
  }>(request, { maxBytes: MAX_CV_JSON_BYTES })
  if (!parsed.ok) return jsonError(parsed.error, parsed.status)
  const body = parsed.body ?? {}

  let base: Date | '*'
  if (body.base === '*') base = '*'
  else {
    base = new Date(typeof body.base === 'string' ? body.base : Number.NaN)
    if (Number.isNaN(base.getTime()))
      return jsonError(
        '`base` must be the updatedAt the editor loaded, or *',
        400
      )
  }

  try {
    const result = await saveCv(id, {
      resume: body.resume,
      label: body.label,
      base,
    })
    if (!result.ok) return serviceErrorResponse(result)
    return NextResponse.json({ cv: result.value })
  } catch (error) {
    console.error('[api/admin/cvs/[id]] save failed', error)
    return jsonError('Unable to save the CV right now.', 500)
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const denied = requireOwner(request)
  if (denied) return denied

  const { id } = await params
  if (!isCvId(id)) return jsonError('CV not found.', 404)

  try {
    const result = await deleteCv(id)
    if (!result.ok) return serviceErrorResponse(result)
    return NextResponse.json(result.value)
  } catch (error) {
    console.error('[api/admin/cvs/[id]] delete failed', error)
    return jsonError('Unable to delete the CV right now.', 500)
  }
}
