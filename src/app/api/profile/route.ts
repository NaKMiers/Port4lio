import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { hasOwnerAccess } from '@/lib/admin-gate'
import { jsonError } from '@/lib/api-response'
import { getAuthCookieName } from '@/lib/auth'
import { connectDatabase } from '@/lib/mongodb'
import { loadPublicProfile } from '@/lib/profile-data'
import { replaceProfile } from '@/lib/profile-service'
import { MAX_PROFILE_JSON_BYTES } from '@/lib/upload-limits'
import type { Profile } from '@/types/profile'

/** The settings editor's stale-tab guard (see POST). */
const PROFILE_BASE_HEADER = 'x-profile-base-updated-at'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Owner-only projection: strips Mongo bookkeeping but keeps every profile field, including
 * private ones. Public callers must go through `loadPublicProfile` / `toPublicProfile`
 * instead - the asymmetry is deliberate, hence the name.
 */
function toOwnerProfile(doc: Record<string, unknown>) {
  const { _id, createdAt: _createdAt, updatedAt: _updatedAt, ...profile } = doc
  return profile
}

/** Public read. Allowlisted fields only - see `src/lib/profile-public.ts`. */
export async function GET() {
  try {
    return NextResponse.json({ profile: await loadPublicProfile() })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown server error'
    return jsonError(message, 500)
  }
}

export async function POST(request: NextRequest) {
  try {
    await connectDatabase()

    const authCookie = request.cookies.get(getAuthCookieName())?.value
    if (!hasOwnerAccess(authCookie)) return jsonError('Unauthorized', 401)

    const contentType = request.headers.get('content-type') ?? ''
    if (!contentType.includes('application/json'))
      return jsonError('Expected Content-Type: application/json', 415)

    const raw = await request.text()
    const byteLength = new TextEncoder().encode(raw).length
    if (byteLength > MAX_PROFILE_JSON_BYTES)
      return jsonError(
        `Profile JSON exceeds ${MAX_PROFILE_JSON_BYTES / (1024 * 1024)} MB`,
        413
      )

    const parsed = JSON.parse(raw || '{}') as Profile

    /*
      The stale-tab guard, sent as a header so the body stays the profile and nothing new is
      ever stored: the updatedAt the settings editor loaded, or `*` for "Overwrite anyway"
      (no check, but answer with the new updatedAt so the editor has a base again). Absent -
      every caller before the guard - the save and its answer are exactly as they were.
    */
    const baseHeader = request.headers.get(PROFILE_BASE_HEADER)
    let base: Date | undefined
    if (baseHeader && baseHeader !== '*') {
      base = new Date(baseHeader)
      if (Number.isNaN(base.getTime()))
        return jsonError(
          `${PROFILE_BASE_HEADER} must be the updatedAt the editor loaded, or *`,
          400
        )
    }

    // The write and the cache invalidation live in `profile-service`, shared with the site
    // MCP's `update_profile` (premise 2, C8).
    const updatedDoc = await replaceProfile(parsed, { base })

    if (!updatedDoc) return jsonError('Failed to load updated profile', 500)
    if ('stale' in updatedDoc)
      return NextResponse.json(
        {
          error:
            'The profile changed since you opened this page - probably an agent edit. Reload to see it, or overwrite it with what you have.',
          code: 'stale',
          updatedAt: updatedDoc.stale,
        },
        { status: 409 }
      )

    return NextResponse.json({
      ok: true,
      profile: toOwnerProfile(updatedDoc as Record<string, unknown>),
      ...(baseHeader ? { updatedAt: updatedDoc.updatedAt ?? null } : {}),
    })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown server error'
    return jsonError(message, 500)
  }
}
