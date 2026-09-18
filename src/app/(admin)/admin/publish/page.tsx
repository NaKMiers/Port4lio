import type { Metadata } from 'next'

import PublishBoard from '@/components/publish/PublishBoard'
import OwnerAuthGate from '@/components/settings/OwnerAuthGate'

export const metadata: Metadata = {
  title: 'Publish',
  robots: { index: false, follow: false },
}

export default function PublishPage() {
  return (
    <div className='portfolio-public-root relative z-50 min-h-screen clip-decorations pt-12 text-pp-text'>
      <div className='pointer-events-none absolute inset-0 pp-grid-wash opacity-60' />
      <div className='relative mx-auto max-w-editorial px-gutter py-10'>
        <OwnerAuthGate>
          <PublishBoard />
        </OwnerAuthGate>
      </div>
    </div>
  )
}
