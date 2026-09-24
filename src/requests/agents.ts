import type {
  ClientAgentAction,
  ClientAgentToken,
  McpScope,
} from '@/lib/mcp/scopes'
import type { ClientToken } from '@/lib/whiteboard/types'

/**
 * Fetch wrappers for `/api/admin/agents/*`, all `no-store` (owner data, always fresh). Each
 * throws `Error(message)` with the server's own message on a non-2xx.
 */

const API = '/api/admin/agents/tokens'

export interface AgentsSnapshot {
  tokens: ClientAgentToken[]
  legacy: ClientToken[]
  actions: ClientAgentAction[]
}

async function failed(res: Response): Promise<never> {
  let message = `Request failed (${res.status})`
  try {
    message = ((await res.json()) as { error?: string }).error ?? message
  } catch {
    // Keep the status-only message.
  }
  throw new Error(message)
}

export async function getAgentsApi(): Promise<AgentsSnapshot> {
  const res = await fetch(API, { cache: 'no-store' })
  if (!res.ok) return failed(res)
  return res.json()
}

export async function createAgentTokenApi(
  name: string,
  scopes: McpScope[]
): Promise<{ token: string; record: ClientAgentToken }> {
  const res = await fetch(API, {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, scopes }),
  })
  if (!res.ok) return failed(res)
  return res.json()
}

export async function revokeAgentTokenApi(
  id: string
): Promise<{ kind: 'agent' | 'legacy' }> {
  const res = await fetch(`${API}/${id}`, {
    method: 'DELETE',
    cache: 'no-store',
  })
  if (!res.ok) return failed(res)
  return res.json()
}

export async function updateAgentTokenScopesApi(
  id: string,
  scopes: McpScope[]
): Promise<{ record: ClientAgentToken }> {
  const res = await fetch(`${API}/${id}`, {
    method: 'PATCH',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scopes }),
  })
  if (!res.ok) return failed(res)
  return res.json()
}

/** Only a revoked token can be deleted; an active one is a 409 from the server. */
export async function deleteAgentTokenApi(
  id: string
): Promise<{ deleted: true; kind: 'agent' | 'legacy' }> {
  const res = await fetch(`${API}/${id}?forever=1`, {
    method: 'DELETE',
    cache: 'no-store',
  })
  if (!res.ok) return failed(res)
  return res.json()
}
