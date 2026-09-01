import crypto from 'node:crypto'

import { base64url } from '@/lib/base64url'

/**
 * Capability tokens for anonymous MBTI results.
 *
 * There are no accounts here on purpose - the invite loop dies the moment a stranger has
 * to sign up before seeing what their friend sent them. So the URL *is* the credential:
 * holding `/vi/mbti/result/<token>` is the entire proof that this result is yours.
 *
 * That makes token entropy the only thing standing between a paid report and the open
 * internet, which is why this is `crypto.randomBytes` and never `Math.random`. 16 bytes
 * is 128 bits, the same order as a UUIDv4, and encodes to 22 URL-safe characters.
 *
 * Tokens are stored as the Mongo `_id` (see `models/Attempt.ts`), following the string-id
 * convention already used by `Profile` and `PublishState`. That gives a unique index for
 * free and makes `findById(token)` the whole lookup, with no second field to keep in sync.
 */

const TOKEN_BYTES = 16

/** 22 chars: ceil(16 bytes / 3) * 4 minus the two stripped `=` padding characters. */
export const TOKEN_LENGTH = 22

/** Base64url alphabet, anchored, exact length. Rejects a token before it reaches Mongo. */
const TOKEN_PATTERN = new RegExp(`^[A-Za-z0-9_-]{${TOKEN_LENGTH}}$`)

export function mintToken(): string {
  return base64url(crypto.randomBytes(TOKEN_BYTES))
}

/**
 * Whether a path segment is even shaped like one of our tokens.
 *
 * Cheap rejection so a scan for `/result/../../etc/passwd` or a 10KB segment never
 * becomes a database query. A `true` here means "well-formed", never "exists".
 */
export function isTokenShaped(value: string | undefined): value is string {
  return typeof value === 'string' && TOKEN_PATTERN.test(value)
}
