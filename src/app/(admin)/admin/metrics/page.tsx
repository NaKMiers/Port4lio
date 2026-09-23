import type { Metadata } from 'next'

import OwnerAuthGate from '@/components/settings/OwnerAuthGate'
import MetricsBoard from '@/components/test-kit/MetricsBoard'

export const metadata: Metadata = {
  title: 'Metrics',
  robots: { index: false, follow: false },
}

/**
 * The funnel dashboard. Same shape as `/settings`: `OwnerAuthGate` hides
 * the UI, and `/api/admin/metrics` is what actually refuses a request without the owner
 * cookie. The gate here is convenience; the gate there is the control.
 */
export default function MetricsPage() {
  return (
    <div className="mx-auto w-full max-w-editorial px-gutter py-10">
      <OwnerAuthGate>
        <MetricsBoard />
      </OwnerAuthGate>
    </div>
  )
}
