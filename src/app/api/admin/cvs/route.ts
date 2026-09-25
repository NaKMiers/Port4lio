import { NextResponse, type NextRequest } from 'next/server'

import { jsonError, serviceErrorResponse } from '@/lib/api-response'
import { createCv, listCvs } from '@/lib/cv/cv-service'
import { readJsonBody } from '@/lib/read-json-body'
import { requireOwner } from '@/lib/require-owner'
import { MAX_CV_JSON_BYTES } from '@/lib/upload-limits'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * [GET|POST] /api/admin/cvs - the settings CV tab's list and New.
 *
 * ```
 *   GET   requireOwner ──▶ cv-service.listCvs     migrates "Main CV" on the first ever call
 *                                                 ──▶ { cvs, publishedId }
 *   POST  requireOwner ──▶ readJsonBody (256 KB) ──▶ cv-service.createCv(
 *                                                     { label, fromId } | { label, resume })
 *                                                 ──▶ 201 { cv } · 409 labelTaken / cap · 404 fromId
 *                                                 · 400 both or neither
 * ```
 *
 * `{ label, resume }` is the editor's Save as new CV: Save CV found its CV deleted (by an
 * agent, P2-D), and the draft is saved as a new CV instead of being lost.
 *
 * Thin by design: every rule and the migration live in `lib/cv/cv-service.ts`.
 */

export async function GET(request: NextRequest) {
  const denied = requireOwner(request)
  if (denied) return denied

  try {
    return NextResponse.json(await listCvs())
  } catch (error) {
    console.error('[api/admin/cvs] list failed', error)
    return jsonError('Unable to load the CVs right now.', 500)
  }
}

export async function POST(request: NextRequest) {
  const denied = requireOwner(request)
  if (denied) return denied

  const parsed = await readJsonBody<{
    label?: unknown
    fromId?: unknown
    resume?: unknown
  }>(request, { maxBytes: MAX_CV_JSON_BYTES })
  if (!parsed.ok) return jsonError(parsed.error, parsed.status)
  const body = parsed.body ?? {}

  try {
    const result = await createCv({
      label: body.label,
      fromId: body.fromId,
      resume: body.resume,
      actor: 'owner',
    })
    if (!result.ok) return serviceErrorResponse(result)
    return NextResponse.json({ cv: result.value }, { status: 201 })
  } catch (error) {
    console.error('[api/admin/cvs] create failed', error)
    return jsonError('Unable to create the CV right now.', 500)
  }
}
