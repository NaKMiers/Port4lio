import { NextResponse, type NextRequest } from 'next/server'

import { hasOwnerAccess } from '@/lib/admin-gate'
import { getAuthCookieName } from '@/lib/auth'
import { readTestMetrics } from '@/lib/metrics/tests'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export type { ProductMetrics } from '@/lib/metrics/tests'

/**
 * [GET] /api/admin/metrics
 *
 * The read side of the funnel, per product. Owner cookie required.
 *
 * ```
 *   owner cookie ──▶ 401
 *        ▼
 *   lib/metrics/tests.readTestMetrics ──▶ { products: { mbti, iq } }      500 on a read failure
 * ```
 *
 * The gate lives here rather than on the page, because that is where it is actually
 * enforced in this codebase - `(admin)/layout.tsx` is a plain layout and the settings page
 * gates itself client-side. A client-side gate hides a page; a server-side gate is what
 * stops someone reading the data.
 *
 * The numbers themselves - why the shape is keyed by product, why documents are counted and
 * never `$sum: count` - moved to `lib/metrics/tests.ts`.
 * `tests/api/admin-metrics-route.test.ts` pins this route's output field by field.
 */
export async function GET(request: NextRequest) {
  const authCookie = request.cookies.get(getAuthCookieName())?.value
  if (!hasOwnerAccess(authCookie))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    return NextResponse.json({ products: await readTestMetrics() })
  } catch (error) {
    console.error('[api/admin/metrics] read failed', error)
    return NextResponse.json({ error: 'Metrics unavailable' }, { status: 500 })
  }
}
