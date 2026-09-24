import 'server-only'

import crypto from 'node:crypto'

import { getRequiredEnv } from '@/lib/required-env'

/**
 * Seal and open a `p4_` token so the owner can copy it again from `/admin/agents`.
 *
 * ```
 *   create:  token ──▶ sha256        ──▶ `hash`    what verification looks up (unchanged)
 *                  └─▶ AES-256-GCM   ──▶ `sealed`  "v1.<iv>.<ciphertext>.<tag>", base64url
 *   reveal:  sealed ──▶ open ──▶ sha256(plain) === hash? ──▶ the token, to the owner only
 * ```
 *
 * ## Why this does not weaken the "only the hash is stored" rule as much as it looks
 *
 * The rule exists so a database dump alone does not hand anyone agent access, and it still
 * holds: `sealed` is useless without the key, and the key is not in the database. It is
 * derived (HKDF) from `AUTH_SECRET`, and anyone who has that already owns the site - they can
 * forge the owner cookie and mint a token of their own - so deriving from it adds no new
 * secret worth stealing and no new env var to forget on deploy. The label pins the key to
 * this one use: the cookie HMAC and this cipher never share key material.
 *
 * ## What rotating AUTH_SECRET does
 *
 * Every sealed token becomes unopenable (the GCM tag fails), and `openToken` answers null -
 * the row says "make a new one to copy it". The tokens themselves keep working: verification
 * reads `hash`, which does not depend on the key. Rotation logs the owner out and makes old
 * tokens un-copyable; it never breaks an agent.
 *
 * The hash check after opening is belt and braces: a `sealed` that decrypts but does not
 * match its own row's hash (a copied field, a bug in a migration) is refused rather than
 * handed out as if it were that token.
 */

const VERSION = 'v1'
const IV_BYTES = 12

function key(): Buffer {
  return Buffer.from(
    crypto.hkdfSync(
      'sha256',
      getRequiredEnv('AUTH_SECRET'),
      'port4lio',
      'agent-token-vault-v1',
      32
    )
  )
}

export function sealToken(token: string): string {
  const iv = crypto.randomBytes(IV_BYTES)
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv)
  const ciphertext = Buffer.concat([
    cipher.update(token, 'utf8'),
    cipher.final(),
  ])
  return [
    VERSION,
    iv.toString('base64url'),
    ciphertext.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
  ].join('.')
}

/** The plaintext, or null for anything that does not open with the current key. */
export function openToken(sealed: string): string | null {
  const [version, iv, ciphertext, tag] = sealed.split('.')
  if (version !== VERSION || !iv || !ciphertext || !tag) return null
  try {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      key(),
      Buffer.from(iv, 'base64url')
    )
    decipher.setAuthTag(Buffer.from(tag, 'base64url'))
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8')
  } catch {
    // A wrong key (AUTH_SECRET rotated) or a tampered value fails the GCM tag.
    return null
  }
}
