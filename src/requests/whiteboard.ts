import type { SaveOp, SendResult } from '@/components/whiteboard/save-queue'
import type {
  ClientToken,
  ContextResponse,
  ExportScope,
  RestoreBatchResult,
} from '@/lib/whiteboard/types'

/**
 * Fetch wrappers for `/api/admin/whiteboard/*`, all `no-store` (owner data, always fresh).
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

function requestFor(op: SaveOp): [string, RequestInit & { json?: unknown }] {
  switch (op.type) {
    case 'createItem':
      return [`${API}/items`, { method: 'POST', json: op.body }]
    case 'patchItem':
      return [`${API}/items/${op.id}`, { method: 'PATCH', json: op.patch }]
    case 'deleteItem':
      return [`${API}/items/${op.id}`, { method: 'DELETE' }]
    case 'createLink':
      return [`${API}/links`, { method: 'POST', json: op.body }]
    case 'patchLink':
      return [
        `${API}/links/${op.id}`,
        { method: 'PATCH', json: { label: op.label } },
      ]
    case 'deleteLink':
      return [`${API}/links/${op.id}`, { method: 'DELETE' }]
    case 'bulkMove':
      return [
        `${API}/items`,
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

export async function sendSaveOpApi(op: SaveOp): Promise<SendResult> {
  const [url, init] = requestFor(op)
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

export async function getBoardStreamApi(signal?: AbortSignal) {
  const res = await call(API, { signal })
  if (!res.ok || !res.body) throw new Error(await errorMessage(res))
  return res.body
}

export async function getContextApi(
  scope: ExportScope,
  signal?: AbortSignal
): Promise<ContextResponse> {
  const res = await call(`${API}/context`, {
    method: 'POST',
    json: { scope },
    signal,
  })
  if (!res.ok) throw new Error(await errorMessage(res))
  return res.json()
}

export async function getBackupApi(): Promise<Blob> {
  const res = await call(`${API}/backup`)
  if (!res.ok) throw new Error(await errorMessage(res))
  return res.blob()
}

export async function restoreBatchApi(batch: {
  dryRun: boolean
  overwrite: boolean
  items: unknown[]
  links: unknown[]
}): Promise<RestoreBatchResult> {
  const res = await call(`${API}/restore`, { method: 'POST', json: batch })
  if (!res.ok) throw new Error(await errorMessage(res))
  return res.json()
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
