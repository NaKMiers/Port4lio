import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { hasOwnerAccess } from '@/lib/admin-gate'
import { getAuthCookieName } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * The single source of truth `OwnerAuthGate` polls. Answering `ok` when the gate is
 * disabled is what lets the client stay ignorant of `REQUIRE_ADMIN` entirely.
 */
export function GET(request: NextRequest) {
  const ok = hasOwnerAccess(request.cookies.get(getAuthCookieName())?.value)
  return NextResponse.json({ ok })
}
