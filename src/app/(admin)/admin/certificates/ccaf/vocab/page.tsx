import type { Metadata } from 'next'

import CcafGate from '@/components/ccaf/CcafGate'
import VocabTracker from '@/components/ccaf/VocabTracker'

/**
 * `/admin/certificates/ccaf/vocab` - the exam glossary, separate from the roadmap one level
 * up.
 *
 * Same gating as every other owner board (`CcafGate`), but no server-loaded state: the
 * deck is hardcoded in `lib/ccaf/vocab-data.ts` and mastery lives in the browser's
 * `localStorage`, so there is nothing here for the server to withhold from a stranger -
 * the gate alone is enough, unlike the roadmap, which also has to hide a server render.
 *
 * ## Why this one is not `max-w-editorial`
 *
 * Every other board is a document: a column of text and forms that reads down the page at
 * the public site's measure. This one is an app - a filter rail beside a deck - and it
 * sizes itself to the viewport so the scrolling happens inside the frame instead of under
 * it.
 *
 * The padding is a single uniform `p-4` rather than the site's `px-gutter`, which is a
 * horizontal-only clamp that runs to 2rem on a wide screen: matching it on the other three
 * sides is what makes the frame's margin actually equal all the way round. `AdminHomeLink`
 * hides itself here (see its own note) so the frame can start at the top edge instead of
 * below a pill. Below `lg` it gives up the viewport sizing and grows with the page,
 * because a 19rem rail and a card deck side by side do not fit a phone.
 */
export const metadata: Metadata = {
  title: 'CCA-F Vocab',
  robots: { index: false, follow: false },
}

export default function VocabPage() {
  return (
    <CcafGate>
      <main className="w-full p-4 lg:h-[100dvh]">
        <VocabTracker />
      </main>
    </CcafGate>
  )
}
