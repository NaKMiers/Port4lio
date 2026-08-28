import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { connectDatabase } from '@/lib/mongodb'
import { isPublishRequestAuthorized } from '@/lib/publish/auth'
import { isPublishTargetId } from '@/lib/publish/types'
import { PUBLISH_STATE_DOCUMENT_ID, PublishStateModel } from '@/models/PublishState'

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
 */
export async function POST(request: NextRequest) {
  try {
    if (!isPublishRequestAuthorized(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const contentType = request.headers.get('content-type') ?? ''
    if (!contentType.includes('application/json')) {
      return NextResponse.json({ error: 'Expected Content-Type: application/json' }, { status: 415 })
    }

    const body = (await request.json()) as Record<string, unknown>
    const target = body.target
    const version = typeof body.version === 'string' ? body.version : ''
    const result = typeof body.result === 'string' ? body.result : ''
    const detail = typeof body.detail === 'string' ? body.detail.slice(0, 500) : ''

    if (!isPublishTargetId(target)) {
      return NextResponse.json({ error: 'Unknown publish target' }, { status: 400 })
    }
    if (!HEX_64.test(version)) {
      return NextResponse.json({ error: 'Version must be a sha256 hex digest' }, { status: 400 })
    }
    if (result && !ALLOWED_RESULTS.has(result)) {
      return NextResponse.json({ error: 'Unknown result' }, { status: 400 })
    }

    const now = new Date()
    // A failed run must not claim the version as published - record the attempt only.
    const acked = result === 'failed' ? {} : { ackedVersion: version, ackedAt: now }
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
    const message = error instanceof Error ? error.message : 'Unknown server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
