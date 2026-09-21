import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { hasOwnerAccess } from '@/lib/admin-gate'
import { getAuthCookieName } from '@/lib/auth'
import { connectDatabase } from '@/lib/mongodb'
import { PROFILE_DOCUMENT_ID, ProfileModel } from '@/models/Profile'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Full profile read for the settings editor, including fields the public projection drops
 * (contact details, CV copy). Owner cookie required - `GET /api/profile` is the public one.
 */
export async function GET(request: NextRequest) {
  try {
    const authCookie = request.cookies.get(getAuthCookieName())?.value
    if (!hasOwnerAccess(authCookie))
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    await connectDatabase()
    const doc = await ProfileModel.findById(PROFILE_DOCUMENT_ID).lean()
    if (!doc) return NextResponse.json({ profile: null })

    const { _id, createdAt, updatedAt, ...profile } = doc as Record<
      string,
      unknown
    >
    return NextResponse.json({ profile })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
