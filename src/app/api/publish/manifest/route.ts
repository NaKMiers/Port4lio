import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { connectDatabase } from '@/lib/mongodb'
import {
  getPublicProfileUpdatedAt,
  loadPublicProfile,
} from '@/lib/profile-data'
import { isPublishRequestAuthorized } from '@/lib/publish/auth'
import { attachDrift, buildPublishManifest } from '@/lib/publish/manifest'
import type { StoredTargetState } from '@/lib/publish/manifest'
import { resolveSiteOrigin } from '@/lib/seo'
import {
  PUBLISH_STATE_DOCUMENT_ID,
  PublishStateModel,
} from '@/models/PublishState'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Which GitHub account the artifacts point at. */
const GITHUB_USERNAME = process.env.PUBLISH_GITHUB_USERNAME || 'NaKMiers'

async function readTargetStates(): Promise<StoredTargetState[]> {
  await connectDatabase()
  const doc = await PublishStateModel.findById(PUBLISH_STATE_DOCUMENT_ID).lean()
  const targets = (doc as Record<string, unknown> | null)?.targets
  return Array.isArray(targets) ? (targets as StoredTargetState[]) : []
}

/**
 * Fully rendered publish artifacts plus their drift status.
 *
 * Returns finished text (the README arrives as a complete markdown string), so the
 * GitHub Actions workflow is a dumb curl + write + commit with no rendering logic - and
 * no need for the production database connection string to live in Actions secrets.
 */
export async function GET(request: NextRequest) {
  try {
    if (!isPublishRequestAuthorized(request))
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const [profile, profileUpdatedAt, states] = await Promise.all([
      loadPublicProfile(),
      getPublicProfileUpdatedAt(),
      readTargetStates(),
    ])

    const manifest = buildPublishManifest(profile, {
      siteOrigin: resolveSiteOrigin(),
      githubUsername: GITHUB_USERNAME,
      now: new Date(),
      profileUpdatedAt,
    })

    return NextResponse.json(attachDrift(manifest, states), {
      headers: {
        'Cache-Control': 'private, no-store',
        Vary: 'Authorization',
      },
    })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
