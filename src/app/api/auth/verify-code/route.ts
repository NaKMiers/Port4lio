import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { jsonError } from '@/lib/api-response'
import {
  AUTH_MAX_DAYS,
  AUTH_MIN_DAYS,
  authTtlSecondsForDays,
  parseAuthDays,
} from '@/lib/auth-limits'
import {
  getAuthCookieName,
  getOtpCookieName,
  makeAuthToken,
  parseOtpState,
  verifyOtpCode,
} from '@/lib/auth'
import { readJsonBody, VERIFY_CODE_MAX_BODY_BYTES } from '@/lib/read-json-body'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * [POST] /api/auth/verify-code
 *
 * Trades a correct 6-digit code for the owner cookie, for as long as the caller asked.
 *
 * ## Why the length is checked here and not just in the picker
 *
 * The token carries its own `exp` and is HMAC-signed, so the server decides what it is
 * worth - but only if the server decides. `days` arrives in a request body, and a body is
 * whatever the sender typed; validating it in the browser would leave `curl` able to mint
 * a token good for a decade. `parseAuthDays` is the check that counts.
 *
 * ## Why the body is read through `readJsonBody`
 *
 * This used to be a bare `await request.json()` with nothing above it, so a malformed body
 * threw a `SyntaxError` out of the handler and Next turned it into a 500. An unauthenticated
 * caller could therefore produce a server error on the login route with five characters, and
 * the 500 said nothing about what was wrong. It is a 400 now, and the body is capped before
 * it is parsed - this route accepts six digits and a small integer, so anything approaching
 * the cap is not a login attempt.
 */
export async function POST(request: NextRequest) {
  const parsed = await readJsonBody<{ code?: unknown; days?: unknown }>(
    request,
    {
      maxBytes: VERIFY_CODE_MAX_BODY_BYTES,
    }
  )
  if (!parsed.ok) return jsonError(parsed.error, parsed.status)

  const body = parsed.body
  const code = String(body?.code ?? '').trim()
  if (!/^\d{6}$/.test(code)) return jsonError('Invalid code', 400)

  // Before the code is checked, so a bad length costs a round trip rather than the code -
  // the OTP is single-use, and burning one on a malformed request means a second email.
  const days = parseAuthDays(body?.days)
  if (days === null)
    return jsonError(
      `Session length must be a whole number of days between ${AUTH_MIN_DAYS} and ${AUTH_MAX_DAYS}.`,
      400
    )

  const otp = parseOtpState(request.cookies.get(getOtpCookieName())?.value)
  if (!otp)
    return jsonError(
      'No code requested (or it expired). Request a new code.',
      400
    )

  if (Date.now() > otp.exp)
    return jsonError('Code expired. Request a new code.', 400)

  if (!verifyOtpCode(code, otp)) return jsonError('Incorrect code', 401)

  const ttlSeconds = authTtlSecondsForDays(days)
  const authExpMs = Date.now() + ttlSeconds * 1000
  const authToken = makeAuthToken(authExpMs)
  // `days` echoed back so the gate can say what it actually got rather than what it asked
  // for - the two only differ if this route changes, but that is exactly when it matters.
  const response = NextResponse.json({ ok: true, days, expiresAt: authExpMs })

  response.cookies.set({
    name: getOtpCookieName(),
    value: '',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  })
  response.cookies.set({
    name: getAuthCookieName(),
    value: authToken,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: ttlSeconds,
  })

  return response
}
