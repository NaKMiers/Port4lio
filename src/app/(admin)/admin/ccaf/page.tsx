import type { Metadata } from 'next'

import CcafGate from '@/components/ccaf/CcafGate'
import CcafTracker from '@/components/ccaf/CcafTracker'
import { buildCcafMetadata } from '@/lib/ccaf/page-meta'
import { loadOwnerCcafState } from '@/lib/ccaf/progress-data'

/**
 * `/admin/ccaf` - the CCA-F study plan in Vietnamese, and how far through it I am.
 *
 * An owner-only surface, same shape as `/settings`, `/publish` and `/metrics`: the admin
 * layout's chrome, `OwnerAuthGate` over the UI, `robots: noindex`, and no sitemap entry.
 * The English twin is `./en/page.tsx`; the two differ by one prop, so anything that would
 * have to be written twice belongs in `lib/ccaf/page-meta.ts` or in the tracker, not here.
 *
 * ## Why the state load is gated and not just the gate
 *
 * `OwnerAuthGate` runs in the browser, which means it can hide the tracker but cannot
 * un-send it: this page is server-rendered, so whatever `loadOwnerCcafState` returns is
 * already in the HTML by the time the gate has an opinion. Reading the cookie here is
 * what actually keeps the plan private - a stranger gets the gate and an empty payload.
 * `CcafGate` refreshes the route once a code is verified, which is how the state that was
 * deliberately withheld on this render arrives on the next one.
 *
 * ## Why no `revalidate`
 *
 * The admin layout is `force-dynamic`, and it has to be: a cached render of this page is
 * a render made for whoever asked first, and the cookie check above is per-request.
 */

export const metadata: Metadata = buildCcafMetadata('vi')

export default async function CcafPage() {
  const state = await loadOwnerCcafState()

  return (
    <CcafGate>
      {state ? (
        <main className='relative pb-[5.25rem] md:pb-0'>
          <CcafTracker
            initialState={state}
            locale='vi'
          />
        </main>
      ) : null}
    </CcafGate>
  )
}
