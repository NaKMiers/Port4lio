import type { Metadata } from 'next'
import { cookies, headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { cache } from 'react'

import SharePasswordForm from '@/components/whiteboard/SharePasswordForm'
import WhiteboardClient from '@/components/whiteboard/WhiteboardClient'
import {
  WHITEBOARD_SHARE_READ_LIMIT,
  checkRateLimit,
  clientIpFrom,
} from '@/lib/rate-limit'
import { resolveSharedBoard, type SharedBoard } from '@/lib/whiteboard/data'
import { sharedBoardUnlocked } from '@/lib/whiteboard/share'

/**
 * `/whiteboard/<slug|id>` - a board the owner shared by link (WhiteboardBoard.ts).
 *
 * ```
 *   resolveSharedBoard(key) ── null ──▶ notFound()    unknown key, or sharing is off
 *                           └─ board ── password set, no valid unlock cookie?
 *                                        ├─ yes ──▶ SharePasswordForm (nothing about the board)
 *                                        └─ no  ──▶ the owner's canvas (WhiteboardClient), with
 *                                                   access { shared, view|edit } (access.ts)
 * ```
 *
 * The form is the page's half of the password; the API behind the canvas checks the same
 * cookie on every call (share.ts), which is the half that actually protects the board. Until
 * it is unlocked the page does not say the title either - not in the heading, not in the tab.
 *
 * The same framed canvas as `/admin/whiteboard/<id>`, down to the `p-4` frame, so a shared
 * board looks exactly like the owner's; only the chrome around it changes. No owner gate:
 * the link IS the permission, and the API behind the canvas checks it again on every call
 * (share.ts), so turning sharing off stops an open tab, not just the next visit.
 *
 * Only the id, title, mode and link path cross to the client here. The board's items come
 * through the share API after hydration, like the owner's canvas does.
 *
 * ## Dynamic, never cached
 *
 * Whether this page exists is a switch the owner flips at any moment. A cached render would
 * keep serving a board after its link was turned off, which is the one failure a share link
 * must not have.
 *
 * ## Not indexed, and no referrer
 *
 * A share link is a credential - for an edit link, a write credential. `noindex` keeps a
 * link that leaked into a crawl out of search, `robots.ts` disallows `/whiteboard/`, and
 * `no-referrer` stops the URL riding along in the Referer header when someone follows a link
 * written on the board. Same reasoning as the MBTI/IQ result tokens in `robots.ts`.
 *
 * ## Rate-limited like the API behind it
 *
 * The page draws on the same per-IP read bucket as the share API (share.ts), checked before
 * the lookup, so walking through keys on this URL is bounded exactly as it is on the API. A
 * normal visit spends three (this page, the board stream, the vocab list) of 120 a minute.
 * Over the limit it renders a plain "slow down" page - not the board, and not a 404, which
 * would claim the key names nothing.
 */
export const dynamic = 'force-dynamic'

type PageProps = { params: Promise<{ board: string }> }

// generateMetadata and the page both need the board; one lookup per request. The key is
// used as Next hands it over, not `decodeURIComponent`-ed again: a valid key is only
// `[a-z0-9-]` or hex, and a second decode threw on a stray `%` - a 500 for what is a 404.
const boardFor = cache(
  async (
    key: string
  ): Promise<
    | { limited: true }
    | { limited: false; board: SharedBoard | null; unlocked: boolean }
  > => {
    const limit = await checkRateLimit(
      clientIpFrom({ headers: await headers() }),
      WHITEBOARD_SHARE_READ_LIMIT
    )
    if (!limit.ok) return { limited: true }
    const board = await resolveSharedBoard(key)
    return {
      limited: false,
      board,
      unlocked: board
        ? sharedBoardUnlocked({ cookies: await cookies() }, board)
        : false,
    }
  }
)

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { board } = await params
  const found = await boardFor(board)
  const shared = found.limited || !found.unlocked ? null : found.board
  return {
    title: shared ? shared.title || 'Whiteboard' : 'Whiteboard',
    robots: { index: false, follow: false },
    referrer: 'no-referrer',
  }
}

export default async function SharedWhiteboardPage({ params }: PageProps) {
  const { board } = await params
  const found = await boardFor(board)
  if (found.limited)
    return (
      <main className="grid h-[100dvh] w-full place-items-center p-6">
        <div className="max-w-sm text-center">
          <h1 className="font-display text-2xl font-semibold tracking-[-0.02em] text-pp-text">
            Too many requests.
          </h1>
          <p className="mt-2 text-[15px] leading-relaxed text-pp-muted">
            Wait a minute, then reload this page.
          </p>
        </div>
      </main>
    )
  const shared = found.board
  if (!shared) notFound()
  if (!found.unlocked) return <SharePasswordForm boardKey={board} />

  return (
    <main className="h-[100dvh] w-full p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:p-4">
      <WhiteboardClient
        boardId={shared.id}
        access={{
          kind: 'shared',
          mode: shared.share,
          title: shared.title,
          path: shared.path,
        }}
      />
    </main>
  )
}
