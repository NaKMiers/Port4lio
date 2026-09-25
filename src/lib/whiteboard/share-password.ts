import 'server-only'

import crypto from 'node:crypto'
import { promisify } from 'node:util'

import { base64url } from '@/lib/base64url'
import { getRequiredEnv } from '@/lib/required-env'

/**
 * A share link's optional password (WhiteboardBoard.ts): the hash at rest, and the signed
 * cookie a visitor gets for typing it.
 *
 * ```
 *   owner sets "tulip-42" ──▶ scrypt(salt) ──▶ sharePasswordHash
 *                         └─▶ shareAccessVersion = random   (every set, change or removal)
 *
 *   visitor types it ──▶ verifySharePassword ── ok ──▶ cookie wb_unlock_<board>
 *                                                        = body.sig
 *                                                          body = { b, v, iat }
 *   every page load and API call ──▶ unlockIsValid(cookie, board)
 *        sig matches? ── b is this board? ── v is the board's version? ── iat + ttl > now?
 * ```
 *
 * ## Why a version and not the hash in the cookie
 *
 * "Change the password and everyone is out" needs the cookie to be tied to one password.
 * The version does that without putting anything derived from the password in the browser,
 * and it also rotates on removal, so a cookie from before a remove-then-set never comes back
 * to life under the new password.
 *
 * ## Why the TTL is not in the cookie
 *
 * The cookie carries when it was issued, and the board's CURRENT setting decides how long
 * that lasts. So the owner turning "2 days" down to "10 minutes" ends the sessions already
 * open too, which is what the setting reads as. The browser-side lifetime is the 400-day
 * maximum for the same reason: the server, not the browser, is the one that says it ended.
 *
 * ## Why there is also a way back to the password
 *
 * The owner asked to see the password again from the Share menu, and a hash cannot give it
 * back. So next to the hash sits `sharePasswordCipher`: the password under AES-256-GCM with a
 * key derived from `AUTH_SECRET` (label `wb-share-password-key`, so it is never the same key
 * as the HMAC below). The hash is still what checks a visitor's try - decrypting is only for
 * the owner's eye button, through an owner-only route. The trade is deliberate: a copy of the
 * database alone no longer protects these passwords the way a hash would, but a database
 * copy together with `AUTH_SECRET` already opens everything else on the site, and a share
 * password guards one board's link rather than being a login anyone reuses. Rotating `AUTH_SECRET` makes the copies unreadable - the owner then
 * sees "type it again", and the hashes keep working.
 *
 * ## The signature
 *
 * HMAC-SHA256 over the body with `AUTH_SECRET`, prefixed with `wb-unlock:` so no other token
 * signed with the same secret (the owner's session is one) can ever pass as this one, or
 * this one as it. scrypt for the hash rather than a plain HMAC: a share password is short
 * and human, and the hash should cost a guesser something even if the database leaks.
 */

const scrypt = promisify(crypto.scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number
) => Promise<Buffer>

const KEY_LENGTH = 32

/** Browsers cap a cookie at 400 days; the board's TTL is the real limit (see above). */
export const UNLOCK_COOKIE_MAX_AGE = 400 * 24 * 60 * 60

export async function hashSharePassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16)
  const hash = await scrypt(password, salt, KEY_LENGTH)
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`
}

export async function verifySharePassword(
  password: string,
  stored: string
): Promise<boolean> {
  const [scheme, saltB64, hashB64] = stored.split('$')
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false
  const expected = Buffer.from(hashB64, 'base64')
  const actual = await scrypt(
    password,
    Buffer.from(saltB64, 'base64'),
    KEY_LENGTH
  )
  return (
    actual.length === expected.length &&
    crypto.timingSafeEqual(new Uint8Array(actual), new Uint8Array(expected))
  )
}

export function newAccessVersion(): string {
  return crypto.randomBytes(12).toString('hex')
}

/** One cookie per board, so unlocking one shared board never opens another. */
export function unlockCookieName(boardId: string): string {
  return `wb_unlock_${boardId}`
}

function sign(body: string): string {
  const digest = crypto
    .createHmac('sha256', getRequiredEnv('AUTH_SECRET'))
    .update(`wb-unlock:${body}`)
    .digest()
  return base64url(new Uint8Array(digest))
}

export function makeUnlockToken(
  boardId: string,
  version: string,
  nowMs = Date.now()
): string {
  const body = base64url(
    JSON.stringify({ b: boardId, v: version, iat: Math.floor(nowMs / 1000) })
  )
  return `${body}.${sign(body)}`
}

/** What a board asks of a visitor (resolveSharedBoard). */
export interface ShareGate {
  version: string
  /** `null`: good until the password changes. */
  ttlSeconds: number | null
}

export function unlockIsValid(
  token: string | undefined,
  boardId: string,
  gate: ShareGate,
  nowMs = Date.now()
): boolean {
  if (!token) return false
  const [body, sig] = token.split('.')
  if (!body || !sig) return false
  const a = Buffer.from(sig)
  const b = Buffer.from(sign(body))
  if (a.length !== b.length) return false
  if (!crypto.timingSafeEqual(new Uint8Array(a), new Uint8Array(b)))
    return false

  let payload: { b?: unknown; v?: unknown; iat?: unknown }
  try {
    payload = JSON.parse(
      Buffer.from(
        body.replace(/-/g, '+').replace(/_/g, '/'),
        'base64'
      ).toString('utf8')
    )
  } catch {
    return false
  }
  if (payload.b !== boardId || payload.v !== gate.version) return false
  if (typeof payload.iat !== 'number') return false
  if (gate.ttlSeconds === null) return true
  return nowMs < (payload.iat + gate.ttlSeconds) * 1000
}

function cipherKey(): Buffer {
  return crypto
    .createHash('sha256')
    .update(`wb-share-password-key:${getRequiredEnv('AUTH_SECRET')}`)
    .digest()
}

/** `v1.<iv>.<tag>.<ciphertext>`, base64url parts. */
export function encryptSharePassword(password: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', cipherKey(), iv)
  const data = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()])
  return [
    'v1',
    base64url(iv),
    base64url(cipher.getAuthTag()),
    base64url(data),
  ].join('.')
}

/** The password back, or null for a copy this secret did not write (rotated, or tampered). */
export function decryptSharePassword(stored: string): string | null {
  const [version, iv, tag, data] = stored.split('.')
  if (version !== 'v1' || !iv || !tag || !data) return null
  const bytes = (part: string) =>
    new Uint8Array(
      Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
    )
  try {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      cipherKey(),
      bytes(iv)
    )
    decipher.setAuthTag(bytes(tag))
    return Buffer.concat([
      decipher.update(bytes(data)),
      decipher.final(),
    ]).toString('utf8')
  } catch {
    return null
  }
}
