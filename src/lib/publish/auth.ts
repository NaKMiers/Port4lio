import crypto from 'node:crypto'
import type { NextRequest } from 'next/server'

import { getAuthCookieName, verifyAuthToken } from '@/lib/auth'
import { getRequiredEnv } from '@/lib/required-env'

function timingSafeEqualString(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ab.length !== bb.length) return false
  return crypto.timingSafeEqual(new Uint8Array(ab), new Uint8Array(bb))
}

/**
 * Two accepted credentials: the owner cookie (so the admin board can call this from the
 * browser without shipping a secret to the client) and a bearer token (for the workflow).
 *
 * `getRequiredEnv` is load-bearing. The naive `presented === process.env.PUBLISH_TOKEN`
 * returns true when both sides are undefined, which would silently open the endpoint on
 * any deploy missing the variable. Throwing surfaces as a 500 - fail closed, not open.
 */
export function isPublishRequestAuthorized(request: NextRequest): boolean {
  if (verifyAuthToken(request.cookies.get(getAuthCookieName())?.value)) return true

  const header = request.headers.get('authorization') ?? ''
  const presented = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!presented) return false

  return timingSafeEqualString(presented, getRequiredEnv('PUBLISH_TOKEN'))
}
