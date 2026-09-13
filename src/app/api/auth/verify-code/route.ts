import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

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
 */
export async function POST(request: NextRequest) {
  const body = (await request.json()) as { code?: unknown; days?: unknown }
  const code = String(body?.code ?? '').trim()
  if (!/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: 'Invalid code' }, { status: 400 })
  }

  // Before the code is checked, so a bad length costs a round trip rather than the code -
  // the OTP is single-use, and burning one on a malformed request means a second email.
  const days = parseAuthDays(body?.days)
  if (days === null) {
    return NextResponse.json(
      {
        error: `Session length must be a whole number of days between ${AUTH_MIN_DAYS} and ${AUTH_MAX_DAYS}.`,
      },
      { status: 400 }
    )
  }

  const otp = parseOtpState(request.cookies.get(getOtpCookieName())?.value)
  if (!otp) {
    return NextResponse.json(
      { error: 'No code requested (or it expired). Request a new code.' },
      { status: 400 }
    )
  }

  if (Date.now() > otp.exp) {
    return NextResponse.json({ error: 'Code expired. Request a new code.' }, { status: 400 })
  }

  if (!verifyOtpCode(code, otp)) {
    return NextResponse.json({ error: 'Incorrect code' }, { status: 401 })
  }

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
