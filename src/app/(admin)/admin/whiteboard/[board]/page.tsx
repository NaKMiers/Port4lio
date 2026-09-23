import type { Metadata } from 'next'

import OwnerAuthGate from '@/components/settings/OwnerAuthGate'
import WhiteboardClient from '@/components/whiteboard/WhiteboardClient'

/**
 * `/admin/whiteboard/<board>` - one private context canvas that agents can read (D32).
 *
 * Cards, to-do lists, shapes, frames, ink and labelled links, each its own document, so the
 * board is also a store: the Export sheet copies it as markdown and Claude Code / Codex read
 * it over MCP with a revocable token. See `docs/designs/whiteboard.md`.
 *
 * A framed app sized to the viewport, like `/admin/certificates/ccaf/vocab` (DR2): one
 * uniform `p-4` so the frame's margin is equal all the way round, and `AdminHomeLink` hides
 * itself here - the top bar's grid icon is the way back to the hub. Unlike the vocab deck the
 * canvas keeps the viewport height at every width, because React Flow needs a sized box; the
 * tiers below `lg` change what is inside the frame, not the frame (DR8).
 *
 * The board id is in the URL, so a board is bookmarkable, the back button moves between
 * boards, and switching remounts the canvas - which is what stops one board's save queue,
 * undo history or held writes from ever reaching another. An unknown id renders the canvas's
 * own "Couldn't load the board" state rather than a redirect to somebody else's board.
 *
 * `noindex` twice over: the `(admin)` layout already sets it and `robots.ts` disallows
 * `/admin`, and this page restates it because it holds the most private data on the site.
 */
export const metadata: Metadata = {
  title: 'Whiteboard',
  robots: { index: false, follow: false },
}

export default async function WhiteboardPage({
  params,
}: {
  params: Promise<{ board: string }>
}) {
  const { board } = await params
  return (
    <OwnerAuthGate>
      <main className="h-[100dvh] w-full p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:p-4">
        <WhiteboardClient boardId={board} />
      </main>
    </OwnerAuthGate>
  )
}
