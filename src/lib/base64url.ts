/**
 * URL-safe base64, no padding.
 *
 * Extracted from `auth.ts` so the MBTI capability tokens (`lib/tokens.ts`) encode the
 * same way the owner OTP tokens do, rather than growing a second near-identical copy.
 * Nothing here is a secret operation - it is transport encoding only. Signing still
 * lives in `auth.ts`, which owns `AUTH_SECRET`.
 */
export function base64url(input: Buffer | Uint8Array | string): string {
  const buf =
    typeof input === 'string'
      ? Buffer.from(input)
      : Buffer.from(input as Uint8Array)
  return buf
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}
