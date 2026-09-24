import 'server-only'

import { NextResponse } from 'next/server'

import { jsonError } from '@/lib/api-response'

/**
 * The HTTP edges shared by every agent route: `/api/mcp`, the `/api/whiteboard/mcp` alias
 * and `/api/whiteboard/context.md`.
 *
 * Every response is `no-store, private`. Agent answers carry the owner's private data, and a
 * shared cache or a browser back/forward cache holding a copy is a leak nobody would notice.
 * 401s get the header too: a cached 401 for a URL that later succeeds is its own bug.
 */

export const NO_STORE = 'no-store, private'

export function noStore<T extends Response>(response: T): T {
  response.headers.set('Cache-Control', NO_STORE)
  return response
}

export function agentJson(body: unknown, init?: ResponseInit) {
  return noStore(NextResponse.json(body, init))
}

export function agentError(message: string, status: number) {
  return noStore(jsonError(message, status))
}

/** GET and DELETE on an MCP route: no session exists, so there is nothing to operate on. */
export function methodNotAllowed() {
  const res = agentJson(
    {
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed.' },
      id: null,
    },
    { status: 405 }
  )
  res.headers.set('Allow', 'POST')
  return res
}

/**
 * The approved contract is JSON responses, no SSE (whiteboard D17). mcp-handler's stateless
 * 2025-era path answers every request as a one-message `text/event-stream`, and exposes no
 * switch for the SDK's `enableJsonResponse`. A stateless tool call cannot stream anything
 * anyway, so the stream is always exactly one JSON-RPC message; this unwraps it. Anything
 * else (202, 405, a 406, a non-SSE body) passes through untouched.
 */
export async function sseToJson(response: Response): Promise<Response> {
  if (!response.headers.get('content-type')?.includes('text/event-stream'))
    return response

  const body = await response.text()
  const messages = body
    .split(/\r?\n/)
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice(5).trim())
    .filter(Boolean)
    .map(line => JSON.parse(line) as unknown)
  // Keep responses only; a notification interleaved on the stream has no id.
  const replies = messages.filter(
    m => m && typeof m === 'object' && 'id' in (m as object)
  )
  const payload = replies.length === 1 ? replies[0] : replies

  const headers = new Headers(response.headers)
  headers.set('Content-Type', 'application/json')
  headers.delete('Content-Length')
  return new Response(JSON.stringify(payload), {
    status: response.status,
    headers,
  })
}

/**
 * The transport insists the client accepts BOTH `application/json` and `text/event-stream`
 * (406 otherwise). Since the answer is always JSON here, a client that only asks for JSON is
 * asking for exactly what it gets, so the header is widened before the SDK sees it.
 */
export function withAcceptBoth(request: Request): Request {
  const accept = request.headers.get('accept') ?? ''
  if (
    accept.includes('application/json') &&
    accept.includes('text/event-stream')
  )
    return request
  const headers = new Headers(request.headers)
  headers.set('accept', 'application/json, text/event-stream')
  return new Request(request, { headers })
}
