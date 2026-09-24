import 'server-only'

import { z } from 'zod'

import { defineTool, ok, refuse } from '@/lib/mcp/run-tool'
import type { TokenScope } from '@/lib/mcp/scopes'
import {
  isDayParam,
  renderItemDetail,
  renderOverview,
  renderSearchResults,
} from '@/lib/whiteboard/context'
import { loadAgentVisible } from '@/lib/whiteboard/data'
import { LIMITS, MEANINGS, STATUSES } from '@/lib/whiteboard/limits'

/**
 * The whiteboard read tools, all through `loadAgentVisible` (the only agent read path).
 *
 * ```
 *                        /api/mcp                 /api/whiteboard/mcp (alias, one release)
 *   overview   whiteboard_overview        get_overview       ──▶ loadAgentVisible overview
 *   search     whiteboard_search          search_context     ──▶ loadAgentVisible search
 *   item       whiteboard_get_item        get_item           ──▶ loadAgentVisible item
 *                  scopes: read              scopes: read OR whiteboard:legacy (C5)
 * ```
 *
 * One factory, two name sets: the alias keeps the three names existing `claude mcp add`
 * configs already call, bound to the same functions, so there is still one implementation.
 * The descriptions name the tools of their own server, because an agent told to "call
 * get_item" on a server that only has `whiteboard_get_item` would call a tool that is not
 * there.
 */

export interface WhiteboardToolNames {
  overview: string
  search: string
  item: string
}

export const SITE_WHITEBOARD_NAMES: WhiteboardToolNames = {
  overview: 'whiteboard_overview',
  search: 'whiteboard_search',
  item: 'whiteboard_get_item',
}

export const ALIAS_WHITEBOARD_NAMES: WhiteboardToolNames = {
  overview: 'get_overview',
  search: 'search_context',
  item: 'get_item',
}

const day = z
  .string()
  .refine(isDayParam, 'must be a calendar day, YYYY-MM-DD')
  .optional()

export function whiteboardReadTools(
  names: WhiteboardToolNames,
  scopes: readonly TokenScope[]
) {
  const hints = { search: names.search, item: names.item }
  const overview = defineTool({
    name: names.overview,
    title: 'Whiteboard overview',
    description: `Summary of the owner's whiteboards: frames with item counts, counts by meaning (dream, goal, failure, draft, note), active dreams and goals, and recently updated items. Titles and metadata only - call ${names.item} for a full card. Start here for questions like 'what are my active goals?'.`,
    scopes,
    input: z.object({}),
    annotations: { readOnlyHint: true, openWorldHint: false },
    async run() {
      return ok(
        renderOverview(await loadAgentVisible({ kind: 'overview' }), {
          tools: hints,
        })
      )
    },
  })

  const search = defineTool({
    name: names.search,
    title: 'Search the whiteboard',
    description: `Search the owner's whiteboard cards, across every board they share. Full-text query over titles, bodies, tags and to-do rows (Vietnamese and English), plus optional filters. Dates are calendar days YYYY-MM-DD, both ends inclusive: from/to match the card's date (its 'when', or the day it was created), targetFrom/targetTo match its target-by date. Bodies are clipped; call ${names.item} for the full text.`,
    scopes,
    input: z.object({
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
    async run(args) {
      const hasFilter =
        Boolean(args.meanings?.length) ||
        Boolean(args.status?.length) ||
        args.frameId !== undefined ||
        Boolean(args.from || args.to || args.targetFrom || args.targetTo)
      // D23: an empty call is a teaching error, not a silent "newest 10".
      if (!args.query.trim() && !hasFilter)
        return refuse(
          `Give a query or at least one filter. For a summary of the board, call ${names.overview}.`
        )

      const { results, input } = await loadAgentVisible({
        kind: 'search',
        ...args,
      })
      return ok(renderSearchResults(results, input, { tools: hints }))
    },
  })

  const item = defineTool({
    name: names.item,
    title: 'Get one whiteboard card',
    description: `One card in full: its body, to-do rows, metadata, and the titles and ids of the cards it links to and from. Use an id from ${names.overview} or ${names.search}.`,
    scopes,
    input: z.object({ id: z.string().max(64) }),
    annotations: { readOnlyHint: true, openWorldHint: false },
    async run({ id }) {
      const { item: found, input } = await loadAgentVisible({
        kind: 'item',
        id,
      })
      // Rule 6 + R3-14: hidden, unknown and malformed ids get this exact same answer.
      if (!found) return refuse('No item with that id.', 'not-found')
      return ok(renderItemDetail(found, input))
    },
  })

  return [overview, search, item]
}
