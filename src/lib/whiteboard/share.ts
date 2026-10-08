import 'server-only'

import type { NextRequest } from 'next/server'

import {
  WHITEBOARD_SHARE_READ_LIMIT,
  WHITEBOARD_SHARE_WRITE_LIMIT,
  checkRateLimit,
  clientIpFrom,
} from '@/lib/rate-limit'
import { resolveSharedBoard, type SharedBoard } from '@/lib/whiteboard/data'
import { noStore, wbError } from '@/lib/whiteboard/http'
import {
  unlockCookieName,
  unlockIsValid,
} from '@/lib/whiteboard/share-password'

/**
 * The gate every `/api/whiteboard/shared/<key>/*` route opens with - the share link's
 * counterpart of `requireOwner` + `boardParam`.
 *
 * ```
 *   need 'read' ── read rate limit ── no ─────────────▶ 429  Retry-After (before the lookup)
 *   key ──▶ resolveSharedBoard ── null ──────────────▶ 404  (unknown, or sharing is off)
 *                               └─ board
 *   password set, and no valid unlock cookie ─────────▶ 401  { locked: true }
 *   need 'read'  ─────────────────────────────────────▶ ok
 *   need 'write' ── share 'view' ─────────────────────▶ 403  "This board is view only."
 *                └─ share 'edit' ── rate limit ── no ─▶ 429  Retry-After
 *                                               └ yes ▶ ok
 * ```
 *
 * The board is looked up on EVERY request, never cached: turning a link off, or dropping it
 * from edit to view, has to stop the next write from a tab that is already open, not the
 * next page load.
 *
 * "Next" is exact: a write that already passed this gate when the owner flips the switch
 * still lands, milliseconds later. Closing that window means checking the board and writing
 * the item in one transaction, which this repo does not use (see data.ts: the test mongod is
 * standalone, and every multi-step write here is ordered to be safe without one). A write
 * that raced the switch is one the visitor was allowed to make a moment earlier, and it is
 * on the owner's board, where the owner can see and undo it - an accepted window, not a hole.
 *
 * The password check is here, on every call, and not only on the page: the canvas talks to
 * these routes directly, so a gate on the page alone would be a form in front of an open
 * API. Checking every call is also what makes a password change sign an open tab out on its
 * next request rather than at its next reload. The 401 carries `locked: true` so the page
 * can tell "needs the password" apart from any other refusal.
 *
 * A 403 is a 4xx, which the save queue never retries, so a visitor whose edit link was
 * turned down to view mid-session sees their unsent changes marked as refused instead of
 * a queue that hammers the server forever.
 */
function tooMany(retryAfterSeconds: number, message: string) {
  const response = noStore(wbError(message, 429))
  response.headers.set('Retry-After', String(retryAfterSeconds))
  return { ok: false as const, response }
}

export async function sharedBoardFor(
  request: NextRequest,
  key: string,
  need: 'read' | 'write'
): Promise<
  { ok: true; board: SharedBoard } | { ok: false; response: Response }
> {
  const ip = clientIpFrom(request)

  // Reads are limited BEFORE the lookup, so the bucket also bounds someone walking through
  // keys looking for a board that answers - a slug, or an id near a known one.
  if (need === 'read') {
    const limit = await checkRateLimit(ip, WHITEBOARD_SHARE_READ_LIMIT)
    if (!limit.ok)
      return tooMany(
        limit.retryAfterSeconds,
        'Too many requests. Try again in a moment.'
      )
  }

  let board: SharedBoard | null
  try {
    board = await resolveSharedBoard(key)
  } catch (error) {
    console.error('[whiteboard] share lookup failed', error)
    return {
      ok: false,
      response: wbError('Unable to load the whiteboard right now.', 500),
    }
  }
  if (!board) return { ok: false, response: wbError('Board not found.', 404) }
  if (!sharedBoardUnlocked(request, board))
    return { ok: false, response: lockedResponse() }
  if (need === 'read') return { ok: true, board }

  if (board.share !== 'edit')
    return { ok: false, response: wbError('This board is view only.', 403) }

  const limit = await checkRateLimit(ip, WHITEBOARD_SHARE_WRITE_LIMIT)
  if (!limit.ok)
    return tooMany(
      limit.retryAfterSeconds,
      'Too many changes at once. Try again in a moment.'
    )
  return { ok: true, board }
}

/** Whether this request may see a board that has a password (share-password.ts). */
export function sharedBoardUnlocked(
  request: {
    cookies: { get: (name: string) => { value: string } | undefined }
  },
  board: SharedBoard
): boolean {
  if (!board.gate) return true
  return unlockIsValid(
    request.cookies.get(unlockCookieName(board.id))?.value,
    board.id,
    board.gate
  )
}

function lockedResponse() {
  return noStore(
    Response.json(
      {
        error:
          'This board needs its password. Reload the page to enter it - it may have changed, or your time with it may be up.',
        locked: true,
      },
      { status: 401 }
    )
  )
}
