/**
 * A per-tab id, so one visitor is counted once.
 *
 * Not an identifier for a person and deliberately not one: it lives in `sessionStorage`,
 * so it dies with the tab, never reaches another site, and cannot be joined to anything.
 * Its whole job is to make repeat writes collapse onto the same document `_id`.
 *
 * That matters more than it sounds. Three separate things re-fire the same event: React
 * StrictMode double-invokes effects in development, a refresh re-runs the attribution
 * beacon, and `visibilitychange` fires on every tab switch during a test. Without a stable
 * per-tab id each of those becomes a separate row and the share rate reads high - the one
 * failure here that would be believed rather than noticed.
 *
 * Falls back to a fresh id when storage is unavailable (private mode in some browsers,
 * WebViews with storage disabled). That over-counts slightly for those visitors, which is
 * the right trade: the alternative is throwing inside a beacon and losing them entirely.
 */

const KEY = 'p4-session'

export function clientSessionId(): string {
  if (typeof window === 'undefined') return ''

  try {
    const existing = window.sessionStorage.getItem(KEY)
    if (existing) return existing
    const fresh = crypto.randomUUID()
    window.sessionStorage.setItem(KEY, fresh)
    return fresh
  } catch {
    return crypto.randomUUID()
  }
}
