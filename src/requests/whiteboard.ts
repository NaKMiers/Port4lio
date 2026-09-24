import type { SaveOp, SendResult } from '@/components/whiteboard/save-queue'
import type { ClientBoard } from '@/lib/whiteboard/data'
import type { ClientToken, RestoreBatchResult } from '@/lib/whiteboard/types'

/**
 * Fetch wrappers for `/api/admin/whiteboard/*`, all `no-store` (owner data, always fresh).
 *
 * Everything that touches items or links carries `?board=<id>` (D32) - the server refuses a
 * request without one rather than guessing, so the board travels with the request instead of
 * being a thing the server remembers about the session.
 *
 * The save queue's `sendSaveOpApi` never throws: a thrown fetch is a network failure, which
 * the queue retries, and the queue must be able to tell it apart from a 4xx, which it never
 * retries. Everything else throws `Error(message)` with the server's own message.
 */

const API = '/api/admin/whiteboard'

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

function requestFor(
  op: SaveOp,
  board: string
): [string, RequestInit & { json?: unknown }] {
  switch (op.type) {
    case 'createItem':
      return [on('/items', board), { method: 'POST', json: op.body }]
    case 'patchItem':
      return [on(`/items/${op.id}`, board), { method: 'PATCH', json: op.patch }]
    case 'deleteItem':
      return [on(`/items/${op.id}`, board), { method: 'DELETE' }]
    case 'createLink':
      return [on('/links', board), { method: 'POST', json: op.body }]
    case 'patchLink':
      return [
        on(`/links/${op.id}`, board),
        { method: 'PATCH', json: { label: op.label } },
      ]
    case 'deleteLink':
      return [on(`/links/${op.id}`, board), { method: 'DELETE' }]
    case 'bulkMove':
      return [
        on('/items', board),
        { method: 'PATCH', json: { updates: op.entries } },
      ]
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
  board: string
): Promise<SendResult> {
  const [url, init] = requestFor(op, board)
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

export async function getBoardStreamApi(board: string, signal?: AbortSignal) {
  const res = await call(`${API}?board=${board}`, { signal })
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
  patch: { title?: string; includeInAi?: boolean }
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

export async function getTokensApi(): Promise<ClientToken[]> {
  const res = await call(`${API}/tokens`)
  if (!res.ok) throw new Error(await errorMessage(res))
  return (await res.json()).tokens
}

export async function createTokenApi(
  name: string
): Promise<{ token: string; record: ClientToken }> {
  const res = await call(`${API}/tokens`, { method: 'POST', json: { name } })
  if (!res.ok) throw new Error(await errorMessage(res))
  return res.json()
}

export async function revokeTokenApi(id: string): Promise<ClientToken> {
  const res = await call(`${API}/tokens/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(await errorMessage(res))
  return (await res.json()).record
}

/** Removes a revoked token from the list for good; the server refuses an active one (409). */
export async function deleteTokenForeverApi(id: string): Promise<void> {
  const res = await call(`${API}/tokens/${id}?forever=1`, { method: 'DELETE' })
  if (!res.ok) throw new Error(await errorMessage(res))
}
