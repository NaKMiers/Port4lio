import { NextRequest } from 'next/server'

/**
 * Shared plumbing for the MCP API tests: a JSON-RPC client over a route handler called
 * directly, the way `whiteboard-agent.test.ts` does it.
 *
 * `after()` is not replaced here - `vi.mock` is hoisted per test file, so each file declares
 * its own queue (see the top of `mcp-core.test.ts`) and passes nothing to this module.
 */

export type RouteHandler = (request: NextRequest) => Promise<Response>

export interface RpcReply {
  status: number
  body: {
    result?: {
      content?: { type: string; text: string }[]
      isError?: boolean
      tools?: { name: string; annotations?: Record<string, unknown> }[]
      prompts?: { name: string }[]
      messages?: { content: { text: string } }[]
      [key: string]: unknown
    }
    error?: { code: number; message: string }
  }
}

let ipCounter = 0

/** A fresh client IP, so one test never spends another's front-door bucket. */
export function freshIp(prefix = 10): string {
  ipCounter += 1
  return `${prefix}.9.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`
}

export function agentRequest(
  url: string,
  {
    token,
    ip,
    method = 'POST',
    body,
    headers = {},
  }: {
    token?: string
    ip: string
    method?: string
    body?: unknown
    headers?: Record<string, string>
  }
) {
  return new NextRequest(url, {
    method,
    headers: {
      'x-forwarded-for': ip,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
      accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
}

export function mcpClient(post: RouteHandler, url: string) {
  let id = 0
  const ip = freshIp()

  async function rpc(
    token: string,
    method: string,
    params?: unknown
  ): Promise<RpcReply> {
    const res = await post(
      agentRequest(url, {
        token,
        ip,
        body: { jsonrpc: '2.0', id: ++id, method, params },
      })
    )
    const text = await res.text()
    return { status: res.status, body: text ? JSON.parse(text) : {} }
  }

  async function callTool(token: string, name: string, args: unknown = {}) {
    const reply = await rpc(token, 'tools/call', { name, arguments: args })
    if (reply.body.error)
      return {
        text: reply.body.error.message,
        isError: true,
        rpcError: reply.body.error,
      }
    return {
      text: reply.body.result?.content?.[0]?.text ?? '',
      isError: Boolean(reply.body.result?.isError),
      rpcError: undefined,
    }
  }

  async function toolNames(token: string) {
    const reply = await rpc(token, 'tools/list')
    return (reply.body.result?.tools ?? []).map(tool => tool.name).sort()
  }

  return { rpc, callTool, toolNames }
}
