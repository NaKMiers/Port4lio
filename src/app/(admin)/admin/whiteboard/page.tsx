import type { Metadata } from 'next'

import OwnerAuthGate from '@/components/settings/OwnerAuthGate'
import BoardIndex from '@/components/whiteboard/BoardIndex'

/**
 * `/admin/whiteboard` - the boards (D32). Each one opens at `/admin/whiteboard/<id>`.
 *
 * The list is fetched by the client through the owner-gated API rather than read here on the
 * server: the gate below is a client gate, so anything this page rendered would be in the
 * HTML before it ran. Board titles are the owner's own words about their own contexts, and
 * this is the most private page on the site.
 *
 * `noindex` twice over: the `(admin)` layout already sets it and `robots.ts` disallows
 * `/admin`.
 */
export const metadata: Metadata = {
  title: 'Whiteboards',
  robots: { index: false, follow: false },
}

export default function WhiteboardsPage() {
  return (
    <OwnerAuthGate>
      <BoardIndex />
    </OwnerAuthGate>
  )
}
