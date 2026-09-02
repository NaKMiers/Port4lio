import type { Metadata } from 'next'

import OwnerAuthGate from '@/components/settings/OwnerAuthGate'
import MetricsBoard from '@/components/test-kit/MetricsBoard'

export const metadata: Metadata = {
  title: 'Metrics',
  robots: { index: false, follow: false },
}

/**
 * The funnel dashboard. Same shape as `/publish` and `/settings`: `OwnerAuthGate` hides
 * the UI, and `/api/admin/metrics` is what actually refuses a request without the owner
 * cookie. The gate here is convenience; the gate there is the control.
 */
export default function MetricsPage() {
  return (
    <div className='portfolio-public-root relative z-50 min-h-screen clip-decorations pt-12 text-pp-text'>
      <div className='pointer-events-none absolute inset-0 pp-grid-wash opacity-60' />
      <div className='relative mx-auto max-w-editorial px-gutter py-10'>
        <OwnerAuthGate>
          <MetricsBoard />
        </OwnerAuthGate>
      </div>
    </div>
  )
}
