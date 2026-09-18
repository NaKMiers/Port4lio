import type { Metadata } from 'next'

import CcafGate from '@/components/ccaf/CcafGate'
import CcafTracker from '@/components/ccaf/CcafTracker'
import { buildCcafMetadata } from '@/lib/ccaf/page-meta'
import { loadOwnerCcafState } from '@/lib/ccaf/progress-data'

/**
 * `/admin/ccaf/en` - the English twin of `../page.tsx`, which carries the reasoning for both.
 */

export const metadata: Metadata = buildCcafMetadata('en')

export default async function CcafEnPage() {
  const state = await loadOwnerCcafState()

  return (
    <CcafGate>
      {state ? (
        <main className='relative pb-[5.25rem] md:pb-0'>
          <CcafTracker
            initialState={state}
            locale='en'
          />
        </main>
      ) : null}
    </CcafGate>
  )
}
