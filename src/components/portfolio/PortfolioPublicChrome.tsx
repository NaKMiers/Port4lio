import { Suspense } from 'react'

import ProfileFetchStatus from '@/components/ProfileFetchStatus'

/**
 * Public one-page shell: editorial background, typography, spacing rhythm.
 * Admin continues to use `SiteChrome` (dark route-era chrome).
 */
export default function PortfolioPublicChrome({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="portfolio-public-root min-h-screen">
      <ProfileFetchStatus />
      {/* Legacy `Nav` read searchParams; not used on the one-page surface */}
      <Suspense fallback={null}>{children}</Suspense>
    </div>
  )
}
