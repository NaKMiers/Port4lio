import type { SaveOp, SendResult } from '@/components/whiteboard/save-queue'
import type { ClientBoard } from '@/lib/whiteboard/data'
import type { ShareMode } from '@/lib/whiteboard/limits'
import type { RestoreBatchResult } from '@/lib/whiteboard/types'
import type { Vocab, VocabKind } from '@/lib/whiteboard/vocab'

/**
 * Fetch wrappers for `/api/admin/whiteboard/*`, all `no-store` (owner data, always fresh).
 *
 * Everything that touches items or links carries `?board=<id>` (D32) - the server refuses a
 * request without one rather than guessing, so the board travels with the request instead of
 * being a thing the server remembers about the session.
 *
 * The canvas calls (the stream, the save queue's writes, the vocab read) take a
 * `CanvasScope` instead, because the same canvas also runs behind a share link:
 *
 * ```
 *   { board, shared: false }  ──▶ /api/admin/whiteboard/items?board=<id>
 *   { board, shared: true }   ──▶ /api/whiteboard/shared/<id>/items
 * ```
 *
 * The shared form addresses the board by id even when the page was opened by slug, so an
 * owner renaming the slug does not break a tab that is already open on the old one.
 *
 * The save queue's `sendSaveOpApi` never throws: a thrown fetch is a network failure, which
 * the queue retries, and the queue must be able to tell it apart from a 4xx, which it never
 * retries. Everything else throws `Error(message)` with the server's own message.
 */

const API = '/api/admin/whiteboard'
const SHARED_API = '/api/whiteboard/shared'

/** Which door the canvas talks through: the owner's, or a share link's. */
export interface CanvasScope {
  board: string
  shared: boolean
}

async function errorMessage(res: Response) {
  try {
    const body = (await res.json()) as { error?: string }
    return body.error ?? `Request failed (${res.status})`
  } catch {
    return `Request failed (${res.status})`
  }
}

async function call(
  url: string,
  init: RequestInit & { json?: unknown } = {}
): Promise<Response> {
  const { json, ...rest } = init
  return fetch(url, {
    cache: 'no-store',
    ...rest,
    headers:
      json === undefined
        ? rest.headers
        : { 'Content-Type': 'application/json' },
    body: json === undefined ? rest.body : JSON.stringify(json),
  })
}

const on = (path: string, board: string) => `${API}${path}?board=${board}`

/** A canvas endpoint for either door. `path` is '' for the stream, else '/items' etc. */
const canvasUrl = ({ board, shared }: CanvasScope, path: string) =>
  shared ? `${SHARED_API}/${board}${path}` : `${API}${path}?board=${board}`

function requestFor(
  op: SaveOp,
  scope: CanvasScope
): [string, RequestInit & { json?: unknown }] {
  const at = (path: string) => canvasUrl(scope, path)
  switch (op.type) {
    case 'createItem':
      return [at('/items'), { method: 'POST', json: op.body }]
    case 'patchItem':
      return [at(`/items/${op.id}`), { method: 'PATCH', json: op.patch }]
    case 'deleteItem':
      return [at(`/items/${op.id}`), { method: 'DELETE' }]
    case 'createLink':
      return [at('/links'), { method: 'POST', json: op.body }]
    case 'patchLink':
      return [
        at(`/links/${op.id}`),
        { method: 'PATCH', json: { label: op.label } },
      ]
    case 'deleteLink':
      return [at(`/links/${op.id}`), { method: 'DELETE' }]
    case 'bulkMove':
      return [at('/items'), { method: 'PATCH', json: { updates: op.entries } }]
  }
}

/**
 * A save that hangs holds its item's queue (and shows "Saving" forever), so it is cut off
 * and handed back as a network failure, which the queue retries. Generous on purpose: an
 * ink stroke is up to 256 KB on a slow link.
 */
const SAVE_TIMEOUT_MS = 30_000

export async function sendSaveOpApi(
  op: SaveOp,
  scope: CanvasScope
): Promise<SendResult> {
  const [url, init] = requestFor(op, scope)
  const signal = AbortSignal.timeout(SAVE_TIMEOUT_MS)
  let res: Response
  try {
    res = await call(url, { ...init, signal })
  } catch {
    return { ok: false, status: 0, error: 'Network error' }
  }
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    // A body cut off by the timeout is a lost answer, not a verdict: retry it.
    if (signal.aborted) return { ok: false, status: 0, error: 'Timed out' }
    body = null
  }
  if (res.ok) return { ok: true, data: body }
  const { error, id } = (body ?? {}) as { error?: string; id?: string }
  return {
    ok: false,
    status: res.status,
    error: error ?? `Request failed (${res.status})`,
    id,
  }
}

export async function getBoardStreamApi(
  scope: CanvasScope,
  signal?: AbortSignal
) {
  const res = await call(canvasUrl(scope, ''), { signal })
  if (!res.ok || !res.body) throw new Error(await errorMessage(res))
  return res.body
}

export async function getBackupApi(board: string): Promise<Blob> {
  const res = await call(on('/backup', board))
  if (!res.ok) throw new Error(await errorMessage(res))
  return res.blob()
}

export async function restoreBatchApi(
  board: string,
  batch: {
    dryRun: boolean
    overwrite: boolean
    items: unknown[]
    links: unknown[]
  }
): Promise<RestoreBatchResult> {
  const res = await call(on('/restore', board), {
    method: 'POST',
    json: batch,
  })
  if (!res.ok) throw new Error(await errorMessage(res))
  return res.json()
}

// MARK: Boards (D32)

export async function getBoardsApi(): Promise<ClientBoard[]> {
  const res = await call(`${API}/boards`)
  if (!res.ok) throw new Error(await errorMessage(res))
  return (await res.json()).boards
}

export async function createBoardApi(title: string): Promise<ClientBoard> {
  const res = await call(`${API}/boards`, { method: 'POST', json: { title } })
  if (!res.ok) throw new Error(await errorMessage(res))
  return (await res.json()).board
}

export async function patchBoardApi(
  id: string,
  patch: {
    title?: string
    includeInAi?: boolean
    share?: ShareMode
    /** '' or null clears it, and the link falls back to the board id. */
    slug?: string | null
  }
): Promise<ClientBoard> {
  const res = await call(`${API}/boards/${id}`, {
    method: 'PATCH',
    json: patch,
  })
  if (!res.ok) throw new Error(await errorMessage(res))
  return (await res.json()).board
}

export async function deleteBoardApi(id: string): Promise<void> {
  const res = await call(`${API}/boards/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(await errorMessage(res))
}

// MARK: Meanings and statuses

export interface VocabSnapshot {
  vocab: Vocab
  /** Cards (every board) carrying each key. Owner reads only - a share link gets the list. */
  usage?: { meanings: Record<string, number>; statuses: Record<string, number> }
}

async function vocabCall(
  url: string,
  init: RequestInit & { json?: unknown } = {}
): Promise<VocabSnapshot> {
  const res = await call(url, init)
  if (!res.ok) throw new Error(await errorMessage(res))
  return res.json()
}

export const getVocabApi = (scope?: CanvasScope) =>
  vocabCall(scope?.shared ? canvasUrl(scope, '/vocab') : `${API}/vocab`)

export const createVocabApi = (
  kind: VocabKind,
  entry: Record<string, unknown>
) => vocabCall(`${API}/vocab`, { method: 'POST', json: { ...entry, kind } })

/** Field changes, or `{ to }` to move the entry to that index. */
export const updateVocabApi = (
  kind: VocabKind,
  key: string,
  changes: Record<string, unknown>
) =>
  vocabCall(`${API}/vocab/${kind}/${encodeURIComponent(key)}`, {
    method: 'PATCH',
    json: changes,
  })

export const deleteVocabApi = (kind: VocabKind, key: string) =>
  vocabCall(`${API}/vocab/${kind}/${encodeURIComponent(key)}`, {
    method: 'DELETE',
  })
