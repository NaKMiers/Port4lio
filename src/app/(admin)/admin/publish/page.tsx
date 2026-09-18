import type { Metadata } from 'next'

import PublishBoard from '@/components/publish/PublishBoard'
import OwnerAuthGate from '@/components/settings/OwnerAuthGate'

export const metadata: Metadata = {
  title: 'Publish',
  robots: { index: false, follow: false },
}

export default function PublishPage() {
  return (
    <div className='mx-auto w-full max-w-editorial px-gutter py-10'>
      <OwnerAuthGate>
        <PublishBoard />
      </OwnerAuthGate>
    </div>
  )
}
