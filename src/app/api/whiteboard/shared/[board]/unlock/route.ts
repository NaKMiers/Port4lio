import type { NextRequest } from 'next/server'

import {
  WHITEBOARD_SHARE_UNLOCK_LIMIT,
  checkRateLimit,
  clientIpFrom,
} from '@/lib/rate-limit'
import { readJsonBody } from '@/lib/read-json-body'
import {
  checkSharedBoardPassword,
  resolveSharedBoard,
} from '@/lib/whiteboard/data'
import { noStore, wbError, wbJson } from '@/lib/whiteboard/http'
import { SHARE_PASSWORD_MAX } from '@/lib/whiteboard/limits'
import {
  UNLOCK_COOKIE_MAX_AGE,
  makeUnlockToken,
  unlockCookieName,
} from '@/lib/whiteboard/share-password'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ board: string }> }

/**
 * [POST] /api/whiteboard/shared/<slug|id>/unlock - `{ password }` for a share link that has one.
 *
 * ```
 *   tries left? (per caller) ── no ──▶ 429  Retry-After, before any lookup or hashing
 *   resolveSharedBoard ── null ──────▶ 404  unknown key, or sharing is off
 *   no password on the board ────────▶ 200  nothing to unlock
 *   wrong ───────────────────────────▶ 401  "Wrong password."
 *   right ───────────────────────────▶ 200  + httpOnly cookie wb_unlock_<board>
 * ```
 *
 * The cookie is signed over the board's current access version (share-password.ts), so a
 * later password change turns it back into nothing. Its browser lifetime is the maximum on
 * purpose: how long it is good for is the board's setting, checked on every request.
 *
 * The limit is checked before the board is even looked up, so a caller walking through keys
 * and one guessing a password spend the same tries, and a refused try costs no scrypt.
 */
export async function POST(request: NextRequest, { params }: RouteContext) {
  const limit = await checkRateLimit(
    clientIpFrom(request),
    WHITEBOARD_SHARE_UNLOCK_LIMIT
  )
  if (!limit.ok) {
    const response = wbError(
      'Too many tries. Wait a few minutes, then try again.',
      429
    )
    response.headers.set('Retry-After', String(limit.retryAfterSeconds))
    return response
  }

  const parsed = await readJsonBody<{ password?: unknown }>(request, {
    maxBytes: 1024,
  })
  if (!parsed.ok) return wbError(parsed.error, parsed.status)
  const password = parsed.body?.password
  if (
    typeof password !== 'string' ||
    !password ||
    password.length > SHARE_PASSWORD_MAX
  )
    return wbError('Enter the password.', 400)

  try {
    const { board: key } = await params
    const board = await resolveSharedBoard(key)
    if (!board) return wbError('Board not found.', 404)
    if (!board.gate) return wbJson({ ok: true })

    const verdict = await checkSharedBoardPassword(board.id, password)
    if (verdict === 'unprotected') return wbJson({ ok: true })
    if (verdict === 'wrong') return wbError('Wrong password.', 401)

    const response = noStore(wbJson({ ok: true }))
    response.cookies.set({
      name: unlockCookieName(board.id),
      value: makeUnlockToken(board.id, verdict.version),
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: UNLOCK_COOKIE_MAX_AGE,
    })
    return response
  } catch (error) {
    console.error('[whiteboard] share unlock failed', error)
    return wbError('Unable to check the password right now.', 500)
  }
}
