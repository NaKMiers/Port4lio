import { revalidateTag } from 'next/cache'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { getAuthCookieName, verifyAuthToken } from '@/lib/auth'
import { connectDatabase } from '@/lib/mongodb'
import { loadPublicProfile, PUBLIC_PROFILE_CACHE_TAG } from '@/lib/profile-data'
import { PROFILE_DOCUMENT_ID, ProfileModel } from '@/models/Profile'
import { MAX_PROFILE_JSON_BYTES } from '@/lib/upload-limits'
import type { Profile } from '@/types/profile'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Owner-only projection: strips Mongo bookkeeping but keeps every profile field, including
 * private ones. Public callers must go through `loadPublicProfile` / `toPublicProfile`
 * instead - the asymmetry is deliberate, hence the name.
 */
function toOwnerProfile(doc: Record<string, unknown>) {
  const { _id, createdAt, updatedAt, ...profile } = doc
  return profile
}

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status })
}

/** Public read. Allowlisted fields only - see `src/lib/profile-public.ts`. */
export async function GET() {
  try {
    return NextResponse.json({ profile: await loadPublicProfile() })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown server error'
    return jsonError(message, 500)
  }
}

export async function POST(request: NextRequest) {
  try {
    await connectDatabase()

    const authCookie = request.cookies.get(getAuthCookieName())?.value
    if (!verifyAuthToken(authCookie)) {
      return jsonError('Unauthorized', 401)
    }

    const contentType = request.headers.get('content-type') ?? ''
    if (!contentType.includes('application/json')) {
      return jsonError('Expected Content-Type: application/json', 415)
    }

    const raw = await request.text()
    const byteLength = new TextEncoder().encode(raw).length
    if (byteLength > MAX_PROFILE_JSON_BYTES) {
      return jsonError(`Profile JSON exceeds ${MAX_PROFILE_JSON_BYTES / (1024 * 1024)} MB`, 413)
    }

    const parsed = JSON.parse(raw || '{}') as Profile
    const now = new Date()
    const updatedDoc = await ProfileModel.findOneAndUpdate(
      { _id: PROFILE_DOCUMENT_ID },
      {
        $set: {
          ...parsed,
          updatedAt: now,
        },
        $setOnInsert: {
          _id: PROFILE_DOCUMENT_ID,
          createdAt: now,
        },
      },
      { upsert: true, new: true, lean: true, runValidators: true }
    )

    if (!updatedDoc) {
      return jsonError('Failed to load updated profile', 500)
    }

    revalidateTag(PUBLIC_PROFILE_CACHE_TAG, 'max')

    return NextResponse.json({
      ok: true,
      profile: toOwnerProfile(updatedDoc as Record<string, unknown>),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown server error'
    return jsonError(message, 500)
  }
}
