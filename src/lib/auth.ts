import crypto from 'node:crypto'

import { base64url } from '@/lib/base64url'
import { getRequiredEnv } from '@/lib/required-env'

const AUTH_COOKIE = 'portfolio_auth'
const OTP_COOKIE = 'portfolio_otp'
const OTP_TTL_SECONDS = 10 * 60

export type OtpState = {
  hash: string
  exp: number
}

function mustGetSecret(): string {
  return getRequiredEnv('AUTH_SECRET')
}

function sign(input: string): string {
  const secret = mustGetSecret()
  const digest = crypto.createHmac('sha256', secret).update(input).digest()
  return base64url(new Uint8Array(digest))
}

export function makeAuthToken(expiresAtMs: number): string {
  const payload = { exp: Math.floor(expiresAtMs / 1000) }
  const body = base64url(JSON.stringify(payload))
  const sig = sign(body)
  return `${body}.${sig}`
}

export function verifyAuthToken(token: string | undefined): boolean {
  if (!token) return false
  const [body, sig] = token.split('.')
  if (!body || !sig) return false

  const expected = sign(body)
  try {
    const a = new Uint8Array(Buffer.from(sig))
    const b = new Uint8Array(Buffer.from(expected))
    if (a.length !== b.length) return false
    if (!crypto.timingSafeEqual(a, b)) return false
  } catch {
    return false
  }

  try {
    const json = Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    const parsed = JSON.parse(json) as { exp?: number }
    const exp = typeof parsed.exp === 'number' ? parsed.exp : 0
    return Date.now() < exp * 1000
  } catch {
    return false
  }
}

export function randomCode6(): string {
  const n = crypto.randomInt(0, 1000000)
  return String(n).padStart(6, '0')
}

export function hashOtp(code: string): string {
  const secret = mustGetSecret()
  const digest = crypto.createHmac('sha256', secret).update(code).digest()
  return base64url(new Uint8Array(digest))
}

export function getAuthCookieName() {
  return AUTH_COOKIE
}

export function getOtpCookieName() {
  return OTP_COOKIE
}

export function getOtpTtlSeconds() {
  return OTP_TTL_SECONDS
}

export function parseOtpState(raw: string | undefined): OtpState | null {
  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw) as Partial<OtpState>
    if (typeof parsed.hash !== 'string' || typeof parsed.exp !== 'number') {
      return null
    }
    return { hash: parsed.hash, exp: parsed.exp }
  } catch {
    return null
  }
}

export function verifyOtpCode(code: string, otp: OtpState): boolean {
  if (Date.now() > otp.exp) {
    return false
  }

  const hashed = hashOtp(code)

  try {
    const a = Buffer.from(hashed)
    const b = Buffer.from(otp.hash)
    return a.length === b.length && crypto.timingSafeEqual(a, b)
  } catch {
    return false
  }
}

