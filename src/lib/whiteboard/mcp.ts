import 'server-only'

import { createMcpHandler } from 'mcp-handler'
import { z } from 'zod'

import {
  isDayParam,
  renderItemDetail,
  renderOverview,
  renderSearchResults,
} from '@/lib/whiteboard/context'
import { loadAgentVisible } from '@/lib/whiteboard/data'
import { LIMITS, MEANINGS, STATUSES } from '@/lib/whiteboard/limits'

/**
 * The read-only MCP server: exactly three tools, all through `loadAgentVisible`.
 *
 * ```
 *   POST /api/whiteboard/mcp ──▶ guardAgent ──▶ mcpHandler (mcp-handler 2, stateless)
 *                                                   │
 *        get_overview      ──▶ loadAgentVisible({ kind: 'overview' }) ──▶ renderOverview
 *        search_context    ──▶ loadAgentVisible({ kind: 'search' })   ──▶ renderSearchResults
 *        get_item          ──▶ loadAgentVisible({ kind: 'item' })     ──▶ renderItemDetail
 *                                                   │
 *                              every answer <= ~32,000 chars (D18, in context.ts)
 * ```
 *
 * No resource (D15: a full-board resource overflows Claude Code's 25k-token output cap) and
 * no write tool (agents are read-only in v1). Tool errors are MCP `isError` results, not
 * JSON-RPC errors, so the agent reads the message and corrects itself.
 */

const day = z
  .string()
  .refine(isDayParam, 'must be a calendar day, YYYY-MM-DD')
  .optional()

const EMPTY_SEARCH =
  'Give a query or at least one filter. For a summary of the board, call get_overview.'

const text = (value: string, isError = false) => ({
  content: [{ type: 'text' as const, text: value }],
  ...(isError ? { isError: true } : {}),
})

export const mcpHandler = createMcpHandler(
  server => {
    server.registerTool(
      'get_overview',
      {
        title: 'Whiteboard overview',
        description:
          "Summary of the owner's whiteboards: frames with item counts, counts by meaning (dream, goal, failure, draft, note), active dreams and goals, and recently updated items. Titles and metadata only - call get_item for a full card. Start here for questions like 'what are my active goals?'.",
        inputSchema: z.object({}),
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      async () =>
        text(renderOverview(await loadAgentVisible({ kind: 'overview' })))
    )

    server.registerTool(
      'search_context',
      {
        title: 'Search the whiteboard',
        description:
          "Search the owner's whiteboard cards, across every board they share. Full-text query over titles, bodies, tags and to-do rows (Vietnamese and English), plus optional filters. Dates are calendar days YYYY-MM-DD, both ends inclusive: from/to match the card's date (its 'when', or the day it was created), targetFrom/targetTo match its target-by date. Bodies are clipped; call get_item for the full text.",
        inputSchema: z.object({
          query: z.string().max(LIMITS.searchQuery).default(''),
          meanings: z.array(z.enum(MEANINGS)).optional(),
          status: z.array(z.enum(STATUSES)).optional(),
          frameId: z.string().max(64).optional(),
          from: day,
          to: day,
          targetFrom: day,
          targetTo: day,
          limit: z.number().int().min(1).max(25).default(10),
        }),
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      async args => {
        const hasFilter =
          Boolean(args.meanings?.length) ||
          Boolean(args.status?.length) ||
          args.frameId !== undefined ||
          Boolean(args.from || args.to || args.targetFrom || args.targetTo)
        // D23: an empty call is a teaching error, not a silent "newest 10".
        if (!args.query.trim() && !hasFilter) return text(EMPTY_SEARCH, true)

        const { results, input } = await loadAgentVisible({
          kind: 'search',
          ...args,
        })
        return text(renderSearchResults(results, input))
      }
    )

    server.registerTool(
      'get_item',
      {
        title: 'Get one whiteboard card',
        description:
          'One card in full: its body, to-do rows, metadata, and the titles and ids of the cards it links to and from. Use an id from get_overview or search_context.',
        inputSchema: z.object({ id: z.string().max(64) }),
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      async ({ id }) => {
        const { item, input } = await loadAgentVisible({ kind: 'item', id })
        // Rule 6 + R3-14: hidden, unknown and malformed ids get this exact same answer.
        if (!item) return text('No item with that id.', true)
        return text(renderItemDetail(item, input))
      }
    )
  },
  {
    serverInfo: { name: 'port4lio-whiteboard', version: '1.0.0' },
    instructions:
      "The owner's private whiteboards: dreams, goals, failures, drafts and notes, linked with labelled arrows. They may keep several boards and share only some of them; you see the shared ones. Read-only. Start with get_overview, then search_context, then get_item for detail. Cite item ids.",
  }
)

/**
 * The approved contract is JSON responses, no SSE (D17). mcp-handler's stateless 2025-era
 * path answers every request as a one-message `text/event-stream`, and exposes no switch for
 * the SDK's `enableJsonResponse`. A stateless tool call cannot stream anything anyway, so the
 * stream is always exactly one JSON-RPC message; this unwraps it. Anything else (202, 405,
 * a 406, a non-SSE body) passes through untouched.
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
