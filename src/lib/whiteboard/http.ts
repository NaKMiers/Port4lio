import 'server-only'

import { NextResponse } from 'next/server'

import { jsonError } from '@/lib/api-response'

/**
 * Response helpers for every whiteboard route, owner and agent alike.
 *
 * Every response carries `Cache-Control: no-store, private` - the canvas stream, the backup,
 * the export, the token create (the plaintext token is in that body), `context.md` and MCP.
 * This is the most private data in the database, and a shared cache or a browser back/forward
 * cache holding a copy is a leak nobody would notice. 401s get the header too: a cached 401
 * for a URL that later succeeds is its own confusing bug.
 */

export const NO_STORE = 'no-store, private'

export function noStore<T extends Response>(response: T): T {
  response.headers.set('Cache-Control', NO_STORE)
  return response
}

export function wbJson(body: unknown, init?: ResponseInit) {
  return noStore(NextResponse.json(body, init))
}

export function wbError(message: string, status: number) {
  return noStore(jsonError(message, status))
}

/** A 4xx that names the entry it is about (bulk PATCH, restore) - see R3-15. */
export function wbEntryError(
  message: string,
  status: number,
  entry: { id?: string; index?: number }
) {
  return wbJson({ error: message, ...entry }, { status })
}

/**
 * The board a write or a read is about (D32), from `?board=<id>`.
 *
 * Every owner route carries it, and a missing or malformed one is a 400 rather than a
 * default: "the board" stopped being a thing that can be assumed the moment there could be
 * two of them, and a write that lands on the wrong canvas is worse than a refused one.
 */
export function boardParam(
  request: Request
): { ok: true; board: string } | { ok: false; response: Response } {
  const board = new URL(request.url).searchParams.get('board') ?? ''
  if (!/^[0-9a-f]{24}$/i.test(board))
    return { ok: false, response: wbError('A board id is required.', 400) }
  return { ok: true, board: board.toLowerCase() }
}

/**
 * An async generator of strings as a streamed response body (D21: streamed responses are
 * exempt from Vercel's 4.5 MB limit). Lines are coalesced into ~64 KB chunks so a 500-item
 * board is not 500 network writes.
 */
export function streamText(
  source: AsyncGenerator<string>,
  headers: Record<string, string>
): Response {
  const encoder = new TextEncoder()
  const CHUNK = 64 * 1024

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      let buffer = ''
      try {
        while (buffer.length < CHUNK) {
          const { value, done } = await source.next()
          if (done) {
            if (buffer) controller.enqueue(encoder.encode(buffer))
            controller.close()
            return
          }
          buffer += value
        }
        controller.enqueue(encoder.encode(buffer))
      } catch (error) {
        // The client sees a stream with no closing `end` line, which it treats as a failed
        // load (DR4) - never as a smaller board it may autosave over.
        console.error('[whiteboard] stream failed', error)
        controller.error(error)
      }
    },
    async cancel() {
      await source.return(undefined)
    },
  })

  return noStore(new Response(body, { headers }))
}
