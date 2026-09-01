import { verifyAuthToken } from '@/lib/auth'

/**
 * Whether the owner OTP gate is enforced.
 *
 * Set `REQUIRE_ADMIN=false` to work on the editor locally without a round trip through
 * Gmail. Production ignores the flag on purpose: this one boolean is the only thing
 * standing between the open internet and `/settings`, `/publish` and the profile-write
 * APIs, so a stale or fat-fingered env var on the live site must not be able to unlock
 * them. Turning the gate off there has to be a code change, not a config change.
 */
export function isAdminRequired(): boolean {
  if (process.env.NODE_ENV === 'production') {
    return true
  }

  return process.env.REQUIRE_ADMIN !== 'false'
}

/**
 * Whether this request may act as the owner.
 *
 * Every owner-only route calls this rather than `verifyAuthToken` directly, so the
 * bypass reaches the server too - an unlocked editor whose every save 401s would be
 * worse than no bypass at all.
 */
export function hasOwnerAccess(token: string | undefined): boolean {
  return !isAdminRequired() || verifyAuthToken(token)
}
