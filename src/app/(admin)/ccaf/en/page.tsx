import type { Metadata } from 'next'

import CcafGate from '@/components/ccaf/CcafGate'
import CcafTracker from '@/components/ccaf/CcafTracker'
import { buildCcafMetadata } from '@/lib/ccaf/page-meta'
import { loadOwnerCcafState } from '@/lib/ccaf/progress-data'

/**
 * `/ccaf/en` - the English twin of `../page.tsx`, which carries the reasoning for both.
 */

export const metadata: Metadata = buildCcafMetadata('en')

export default async function CcafEnPage() {
  const state = await loadOwnerCcafState()

  return (
    <div className='portfolio-public-root clip-decorations relative z-50 min-h-screen text-pp-text'>
      <div className='pp-grid-wash pointer-events-none absolute inset-0 opacity-60' />
      <CcafGate>
        {state ? (
          <main className='relative overflow-hidden pb-[5.25rem] md:pb-0'>
            <CcafTracker
              initialState={state}
              locale='en'
            />
          </main>
        ) : null}
      </CcafGate>
    </div>
  )
}
