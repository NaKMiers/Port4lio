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
import {
  createAgentItem,
  createAgentLink,
  loadAgentVisible,
} from '@/lib/whiteboard/data'
import { LIMITS } from '@/lib/whiteboard/limits'
import { VOCAB_KEY_PATTERN } from '@/lib/whiteboard/vocab'

/**
 * The whiteboard read tools, all through `loadAgentVisible` (the only agent read path).
 *
 * ```
 *                        /api/mcp                 /api/whiteboard/mcp (alias, one release)
 *   overview   whiteboard_overview        get_overview       ──▶ loadAgentVisible overview
 *   search     whiteboard_search          search_context     ──▶ loadAgentVisible search
 *   item       whiteboard_get_item        get_item           ──▶ loadAgentVisible item
 *                  scopes: read              scopes: read OR whiteboard:legacy (C5)
 *
 *   whiteboard_add_item · whiteboard_link   (write, /api/mcp only)   visible-only, keyed (R4)
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

/**
 * A meaning or status key. The list is the owner's (vocab.ts), so only the shape is checked
 * here; a key the list does not have comes back from the data layer naming the valid ones.
 */
const vocabKey = z
  .string()
  .regex(VOCAB_KEY_PATTERN, 'must be a meaning or status key, e.g. goal')

export function whiteboardReadTools(
  names: WhiteboardToolNames,
  scopes: readonly TokenScope[]
) {
  const hints = { search: names.search, item: names.item }
  const overview = defineTool({
    name: names.overview,
    title: 'Whiteboard overview',
    description: `Summary of the owner's whiteboards: frames with item counts, counts by meaning, the owner's list of meanings and statuses (the keys the other tools take), active items, and recently updated items. Titles and metadata only - call ${names.item} for a full card. Start here for questions like 'what are my active goals?'.`,
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
    description: `Search the owner's whiteboard cards, across every board agents can read (a board's own agent switch - not a share link). Full-text query over titles, bodies, tags and to-do rows (Vietnamese and English), plus optional filters. Dates are calendar days YYYY-MM-DD, both ends inclusive: from/to match the card's date (its 'when', or the day it was created), targetFrom/targetTo match its target-by date. Bodies are clipped; call ${names.item} for the full text.`,
    scopes,
    input: z.object({
      query: z.string().max(LIMITS.searchQuery).default(''),
      meanings: z.array(vocabKey).optional(),
      status: z.array(vocabKey).optional(),
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

/**
 * The two whiteboard writes (site MCP only; the alias stays read-only). Visible-only: a card
 * lands on a board, or in a frame, an agent can already read, and a link joins two items it
 * can see - `createAgentItem` / `createAgentLink` in `whiteboard/data.ts` hold those rules.
 * `whiteboard_update_item` was cut from the registry (acceptance.md D1): no write here can
 * change an owner-written card.
 */
export function whiteboardWriteTools() {
  const addItem = defineTool({
    name: 'whiteboard_add_item',
    title: 'Add a whiteboard card',
    description:
      "Add a text or to-do card to the owner's whiteboard: on a board agents can read (boardId, needed only when several are readable) or inside a visible frame (frameId from whiteboard_overview). Give it a meaning key and, for a meaning that has a status, a status key - both from the lists in whiteboard_overview (by default: dream, goal, failure, draft, note; statuses active, someday, done, dropped for a dream or goal). The card is tagged 'agent' and is visible to you afterwards; link it with whiteboard_link. The owner sees it on the next load of the board. Pass a clientRef so a retry does not add it twice.",
    scopes: ['write'],
    keyed: true,
    input: z.object({
      boardId: z.string().max(64).optional(),
      frameId: z.string().max(64).optional(),
      form: z.enum(['text', 'todo']).default('text'),
      title: z.string().min(1).max(LIMITS.title),
      body: z.string().max(LIMITS.body).optional(),
      meaning: vocabKey.optional(),
      status: vocabKey.optional(),
      todos: z
        .array(
          z.object({
            text: z.string().min(1).max(LIMITS.todoText),
            done: z.boolean().optional(),
          })
        )
        .max(LIMITS.todos)
        .optional(),
      tags: z
        .array(z.string().min(1).max(LIMITS.tagLength))
        .max(LIMITS.tags - 1)
        .optional(),
      when: day,
      targetBy: day,
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    async run(args, { setTarget }) {
      if (args.form !== 'todo' && args.todos?.length)
        return refuse("Only a to-do card has todos: pass form 'todo'.")
      const result = await createAgentItem(args)
      if (!result.ok)
        return refuse(
          result.error,
          result.status === 404 ? 'not-found' : 'invalid'
        )
      setTarget({ kind: 'whiteboard-item', id: result.value._id })
      return ok(
        JSON.stringify(
          {
            id: result.value._id,
            title: result.value.title,
            meaning: result.value.meaning,
            status: result.value.status,
            tags: result.value.tags,
            parentId: result.value.parentId,
          },
          null,
          2
        )
      )
    },
  })

  const link = defineTool({
    name: 'whiteboard_link',
    title: 'Link two whiteboard cards',
    description:
      'Draw a labelled arrow from one card to another, both visible to you and on the same board (ids from whiteboard_search or whiteboard_add_item). The label reads from -> to, e.g. "serves", "blocks", "led to". Pass a clientRef so a retry does not draw it twice.',
    scopes: ['write'],
    keyed: true,
    input: z.object({
      from: z.string().max(64),
      to: z.string().max(64),
      label: z.string().max(LIMITS.linkLabel).default(''),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    async run(args, { setTarget }) {
      const result = await createAgentLink(args)
      if (!result.ok)
        return refuse(
          result.error,
          result.status === 404 ? 'not-found' : 'invalid'
        )
      setTarget({ kind: 'whiteboard-link', id: result.value._id })
      return ok(
        JSON.stringify(
          {
            id: result.value._id,
            from: result.value.from,
            to: result.value.to,
            label: result.value.label,
          },
          null,
          2
        )
      )
    },
  })

  return [addItem, link]
}
