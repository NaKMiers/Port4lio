import { NextResponse } from 'next/server'

import { isAdminRequired } from '@/lib/admin-gate'
import {
  getOtpCookieName,
  getOtpTtlSeconds,
  hashOtp,
  randomCode6,
} from '@/lib/auth'
import { renderOtpEmail } from '@/lib/email-templates'
import { sendMail } from '@/lib/mailer'
import { getRequiredEnv } from '@/lib/required-env'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST() {
  // Gate off means nobody is waiting on a code, so sending one would only mail the owner
  // for nothing. `/api/auth/me` already answers `ok` in this state, so the client never
  // reaches this route on its own - a direct POST does, which is exactly what this stops.
  if (!isAdminRequired())
    return NextResponse.json({
      ok: true,
      skipped: 'Owner verification is disabled.',
    })

  try {
    const code = randomCode6()
    const ttlSeconds = getOtpTtlSeconds()
    const otp = {
      hash: hashOtp(code),
      exp: Date.now() + ttlSeconds * 1000,
    }

    // TTL is read from the same constant the cookie uses, so the printed expiry cannot
    // drift away from the real one.
    const email = renderOtpEmail({
      code,
      ttlMinutes: Math.round(ttlSeconds / 60),
    })

    await sendMail({
      to: getRequiredEnv('MAIL_TO'),
      subject: email.subject,
      html: email.html,
      text: email.text,
    })

    const response = NextResponse.json({ ok: true })
    response.cookies.set({
      name: getOtpCookieName(),
      value: JSON.stringify(otp),
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: ttlSeconds,
    })

    return response
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to send code'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
