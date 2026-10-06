import 'server-only'

import { after } from 'next/server'

import {
  getIndexingConfig,
  resubmitSitemap,
} from '@/lib/blog/index-status-service'

/**
 * Tell Google the sitemap changed, after a post goes live - without making the publish wait.
 *
 * ```
 *   patchPost: status ≠ published ──▶ published ─┐
 *   illustrate-run: cron publish write ──────────┴─▶ scheduleSitemapResubmit()
 *                                                     │ not configured ──▶ return (no call, no write)
 *                                                     ▼
 *                                                   after(resubmitSitemap('publish'))
 *                                                     └─ outcome lands in SearchConsoleState
 * ```
 *
 * ## Its own file, for the same reason as `revalidate.ts`
 *
 * Both are fire-and-forget side effects called from the write paths that put posts live, and
 * tests mock both modules whole (`vi.mock('@/lib/blog/sitemap-resubmit')`) to assert a call
 * happened. Mocking part of `next/server` instead would also replace `NextResponse` for every
 * route test in the same file.
 *
 * ## Why this one swallows errors and `revalidatePublishedPost` must not
 *
 * A failed revalidation leaves a stale live page, so it surfaces as a 500 the owner retries.
 * A failed resubmit costs nothing visible: Google still reads the sitemap through
 * `robots.txt` on its own schedule, the next publish resubmits, and the board shows the stale
 * "submitted" time from `SearchConsoleState`. A publish must never fail over it.
 *
 * `after()` runs within the route's `maxDuration` and nests inside another `after()` (Next's
 * docs). The cron stops starting images at 85% of its 300s, which leaves ample room for one
 * 15s-bounded PUT. If the platform still cuts it, the resubmit is lost - accepted, see above.
 */
export function scheduleSitemapResubmit(): void {
  try {
    if (!getIndexingConfig().configured) return
    after(async () => {
      try {
        const result = await resubmitSitemap('publish')
        if (!result.ok)
          console.error(`[blog] sitemap resubmit failed: ${result.error}`)
      } catch (error) {
        console.error('[blog] sitemap resubmit failed', error)
      }
    })
  } catch (error) {
    console.error('[blog] sitemap resubmit not scheduled', error)
  }
}
