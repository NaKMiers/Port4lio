import type { NextRequest } from 'next/server'

import { hasOwnerAccess } from '@/lib/admin-gate'
import { jsonError } from '@/lib/api-response'
import { getAuthCookieName } from '@/lib/auth'

/**
 * The owner check, as one call.
 *
 * ```
 *   requireOwner(request)
 *        │
 *        ├─ authorised ──▶ null          ← caller continues
 *        └─ not        ──▶ NextResponse  ← caller returns it verbatim
 * ```
 *
 * ## Why this exists rather than three lines per handler
 *
 * Those three lines - read the cookie by name, pass it to `hasOwnerAccess`, return a 401 -
 * were already duplicated at `api/admin/profile/route.ts` before the blog added six more
 * handlers to the same pattern. Six independent re-derivations of a security check is six
 * chances to get one subtly wrong or leave it out entirely, and the failure is silent: a
 * handler missing its gate looks exactly like a handler that has one, right up until someone
 * without a cookie writes to it.
 *
 * The shape returns a response instead of throwing, and instead of taking a callback, because
 * both alternatives are worse here. Throwing means every caller needs a try/catch that
 * distinguishes an auth throw from a database throw. A callback wrapper means the handler's
 * real body is indented inside a closure and its `return`s no longer return from the handler.
 * `const denied = requireOwner(request); if (denied) return denied` reads in one line and
 * cannot accidentally continue.
 *
 * ## Why it delegates to `hasOwnerAccess` rather than `verifyAuthToken`
 *
 * `hasOwnerAccess` honours `REQUIRE_ADMIN=false` for local work, and honours it on the
 * server as well as in the UI. An editor that renders unlocked while every save 401s is
 * worse than no bypass at all. Production ignores the flag outright - see `admin-gate.ts`.
 */
export function requireOwner(request: NextRequest) {
  const token = request.cookies.get(getAuthCookieName())?.value

  if (!hasOwnerAccess(token))
    // Deliberately the same opaque string for "no cookie" and "bad cookie". Distinguishing
    // them tells an unauthenticated caller which half of the guess was right.
    return jsonError('Unauthorized', 401)

  return null
}
