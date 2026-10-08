import type { CvDto, CvListDto } from '@/types/cv'
import type { Resume } from '@/types/profile'

/**
 * Fetch wrappers for `/api/admin/cvs/*`, all `no-store` (owner data, always fresh). Each
 * throws a `CvApiError` carrying the server's message, and its conflict `code` when the
 * route sent one (`stale`, `labelTaken`, `cap`, `published`) so the editor can branch on it.
 */

const API = '/api/admin/cvs'

export class CvApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message)
    this.name = 'CvApiError'
  }
}

async function failed(res: Response): Promise<never> {
  let message = `Request failed (${res.status})`
  let code: string | undefined
  try {
    const body = (await res.json()) as { error?: string; code?: string }
    message = body.error ?? message
    code = body.code
  } catch {
    // Keep the status-only message.
  }
  throw new CvApiError(message, res.status, code)
}

async function send<T>(
  path: string,
  method: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(path, {
    method,
    cache: 'no-store',
    ...(body === undefined
      ? {}
      : {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
  })
  if (!res.ok) return failed(res)
  return res.json()
}

export function listCvsApi(): Promise<CvListDto> {
  return send(API, 'GET')
}

/** New (a copy of `fromId`), or Save as new CV (the draft of a CV that was deleted, P2-D). */
export function createCvApi(
  body: { label: string } & ({ fromId: string } | { resume: Resume })
): Promise<{ cv: CvDto }> {
  return send(API, 'POST', body)
}

/** Save CV and Rename. `base` is the `updatedAt` the editor holds, or `'*'` to overwrite. */
export function saveCvApi(
  id: string,
  body: { resume?: Resume; label?: string; base: string }
): Promise<{ cv: CvDto }> {
  return send(`${API}/${id}`, 'PATCH', body)
}

export function publishCvApi(id: string): Promise<{ publishedId: string }> {
  return send(`${API}/${id}/publish`, 'POST')
}

export function deleteCvApi(id: string): Promise<{ ok: true }> {
  return send(`${API}/${id}`, 'DELETE')
}
