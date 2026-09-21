import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { jsonError } from '@/lib/api-response'
import { connectDatabase } from '@/lib/mongodb'
import { isPublishRequestAuthorized } from '@/lib/publish/auth'
import { isPublishTargetId } from '@/lib/publish/types'
import { PUBLISH_ACK_MAX_BODY_BYTES, readJsonBody } from '@/lib/read-json-body'
import {
  PUBLISH_STATE_DOCUMENT_ID,
  PublishStateModel,
} from '@/models/PublishState'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const HEX_64 = /^[0-9a-f]{64}$/
const ALLOWED_RESULTS = new Set(['applied', 'unchanged', 'failed'])

/**
 * Records that a target's artifact was actually published.
 *
 * The caller sends the exact version string it displayed - never a `current` sentinel.
 * If the profile changed between page load and click, this stores what was really pasted
 * and the badge goes back to showing drift, which is the honest outcome.
 *
 * ## Why the parse moved into `readJsonBody`
 *
 * The `await request.json()` this replaces did not escape the handler - it landed in the
 * catch below, which returned the exception's own `message` with a 500. So a malformed body
 * produced a server error whose text was a slice of whatever the caller had posted, echoed
 * back. That is the shape `api-response.ts` warns about in its header: an exception's raw
 * text is not a message meant for a caller, and the next exception to reach that path may
 * not be a parser error at all. Malformed JSON is a 400 now, with a fixed string, and the
 * catch no longer speaks for it.
 */
export async function POST(request: NextRequest) {
  try {
    if (!isPublishRequestAuthorized(request))
      return jsonError('Unauthorized', 401)

    const contentType = request.headers.get('content-type') ?? ''
    if (!contentType.includes('application/json'))
      return jsonError('Expected Content-Type: application/json', 415)

    const parsed = await readJsonBody<Record<string, unknown>>(request, {
      maxBytes: PUBLISH_ACK_MAX_BODY_BYTES,
    })
    if (!parsed.ok) return jsonError(parsed.error, parsed.status)

    const body = parsed.body ?? {}
    const target = body.target
    const version = typeof body.version === 'string' ? body.version : ''
    const result = typeof body.result === 'string' ? body.result : ''
    const detail =
      typeof body.detail === 'string' ? body.detail.slice(0, 500) : ''

    if (!isPublishTargetId(target))
      return jsonError('Unknown publish target', 400)

    if (!HEX_64.test(version))
      return jsonError('Version must be a sha256 hex digest', 400)

    if (result && !ALLOWED_RESULTS.has(result))
      return jsonError('Unknown result', 400)

    const now = new Date()
    // A failed run must not claim the version as published - record the attempt only.
    const acked =
      result === 'failed' ? {} : { ackedVersion: version, ackedAt: now }
    const entry = {
      targetId: target,
      ...acked,
      lastResult: result || 'applied',
      lastRunAt: now,
      detail,
    }

    await connectDatabase()
    // Replace this target's entry, leaving the other targets untouched.
    await PublishStateModel.updateOne(
      { _id: PUBLISH_STATE_DOCUMENT_ID },
      { $pull: { targets: { targetId: target } } },
      { upsert: true }
    )
    await PublishStateModel.updateOne(
      { _id: PUBLISH_STATE_DOCUMENT_ID },
      { $push: { targets: entry }, $set: { updatedAt: now } }
    )

    return NextResponse.json({ ok: true, target, acked: result !== 'failed' })
  } catch (error) {
    // Logged in full, reported as a fixed string. What reaches this now is a database
    // failure rather than a parse failure, and a Mongoose error message can carry the
    // connection string it was trying to use.
    console.error('[api/publish/ack] failed', error)
    return jsonError('Unable to record the publish right now.', 500)
  }
}
