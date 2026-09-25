import 'server-only'

import { z } from 'zod'

import { defineTool, hashArgs, ok, refuse } from '@/lib/mcp/run-tool'
import type { TokenScope } from '@/lib/mcp/scopes'
import {
  WHITEBOARD_AGENT_WRITE_LIMIT,
  WHITEBOARD_COMPOSE_LIMIT,
} from '@/lib/rate-limit'
import {
  COMPOSE_LAYOUTS,
  COMPOSE_LIMITS,
} from '@/lib/whiteboard/compose-layout'
import {
  isDayParam,
  renderItemDetail,
  renderOverview,
  renderSearchResults,
} from '@/lib/whiteboard/context'
import {
  arrangeAgentItems,
  composeAgentBoard,
  createAgentItem,
  createAgentLink,
  loadAgentVisible,
} from '@/lib/whiteboard/data'
import { LIMITS, SHAPES } from '@/lib/whiteboard/limits'
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
 *   whiteboard_add_item · whiteboard_link        (write, /api/mcp only)   visible-only, keyed (R4)
 *   whiteboard_compose · whiteboard_arrange      (write, /api/mcp only)   see whiteboardWriteTools
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

// MARK: Writes

const tags = z
  .array(z.string().min(1).max(LIMITS.tagLength))
  .max(LIMITS.tags - 1)
  .optional()

const todos = z
  .array(
    z.object({
      text: z.string().min(1).max(LIMITS.todoText),
      done: z.boolean().optional(),
    })
  )
  .max(LIMITS.todos)
  .optional()

const itemId = z.string().max(64)

/** A name the agent picks so links can point at a card before it has an id. */
const ref = z
  .string()
  .trim()
  .min(1)
  .max(COMPOSE_LIMITS.ref)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
    'must be letters, digits, dots, hyphens or underscores, e.g. goals or ship-v2'
  )

const composeCard = z.object({
  ref: ref.optional(),
  form: z.enum(['text', 'todo', 'shape']).default('text'),
  shape: z.enum(SHAPES).optional(),
  title: z.string().min(1).max(LIMITS.title),
  body: z.string().max(LIMITS.body).optional(),
  meaning: vocabKey.optional(),
  status: vocabKey.optional(),
  todos,
  tags,
  when: day,
  targetBy: day,
})

const composeSection = z.object({
  ref: ref.optional(),
  title: z.string().min(1).max(LIMITS.title),
  columns: z.number().int().min(1).max(4).optional(),
  cardWidth: z.enum(['normal', 'wide']).optional(),
  cards: z.array(composeCard).max(COMPOSE_LIMITS.cardsPerSection),
})

/**
 * The whiteboard writes (site MCP only; the alias stays read-only). Visible-only: an item
 * lands on a board, or in a frame, an agent can already read, and a link joins two items it
 * can see - the rules live in `whiteboard/data.ts`, not here.
 *
 * ```
 *   whiteboard_add_item   one card, placed right of everything          ─▶ createAgentItem
 *   whiteboard_link       one arrow between two visible items           ─▶ createAgentLink
 *   whiteboard_compose    a whole outline, laid out by the server       ─▶ composeAgentBoard
 *   whiteboard_arrange    move / resize / delete items tagged `agent`   ─▶ arrangeAgentItems
 * ```
 *
 * `whiteboard_update_item` was cut from the registry (acceptance.md D1): no write here can
 * change an owner-written card. `whiteboard_arrange` keeps that line - it refuses any id
 * that is not both visible and tagged `agent`.
 */
export function whiteboardWriteTools() {
  const addItem = defineTool({
    name: 'whiteboard_add_item',
    title: 'Add a whiteboard card',
    description:
      "Add ONE text or to-do card to the owner's whiteboard: on a board agents can read (boardId, needed only when several are readable) or inside a visible frame (frameId from whiteboard_overview). It is placed to the right of everything already there, so for more than a few cards - or anything that should be grouped and laid out - use whiteboard_compose instead. Give it a meaning key and, for a meaning that has a status, a status key - both from the lists in whiteboard_overview (by default: dream, goal, failure, draft, note; statuses active, someday, done, dropped for a dream or goal). The card is tagged 'agent' and is visible to you afterwards; link it with whiteboard_link. The owner sees it on the next load of the board. Pass a clientRef so a retry does not add it twice.",
    scopes: ['write'],
    keyed: true,
    cost: () => [WHITEBOARD_AGENT_WRITE_LIMIT],
    input: z.object({
      boardId: z.string().max(64).optional(),
      frameId: z.string().max(64).optional(),
      form: z.enum(['text', 'todo']).default('text'),
      title: z.string().min(1).max(LIMITS.title),
      body: z.string().max(LIMITS.body).optional(),
      meaning: vocabKey.optional(),
      status: vocabKey.optional(),
      todos,
      tags,
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
    cost: () => [WHITEBOARD_AGENT_WRITE_LIMIT],
    input: z.object({
      from: itemId,
      to: itemId,
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

  const compose = defineTool({
    name: 'whiteboard_compose',
    title: 'Compose a whole whiteboard',
    description: [
      'Build a complete, laid-out board section in one call: you describe the structure, the server does the geometry (frame sizes, card positions, spacing, arrow sides), so nothing overlaps. Target a board agents can read (boardId; optional when only one is readable) or start a fresh one with newBoard: { title } - it is created shared with agents. The composition is placed to the right of whatever is already on the board, and never changes an existing card.',
      "layout: 'columns' (sections side by side, like a kanban), 'grid' (sections in rows, two card columns each by default), 'timeline' (sections left to right as phases, joined by arrows in order) or 'mindmap' (a centre shape named heading - or the board title - with sections around it and a spoke to each).",
      'heading: an optional banner shape above everything (the centre, for a mindmap). sections: each becomes a titled frame; its cards are text (title + body), todo (title + todos) or shape (a rect, ellipse or diamond with a one-line title - good for callouts). columns (1-4) and cardWidth (normal | wide) are per section.',
      'Give cards a meaning (and a status where the meaning tracks one) from whiteboard_overview: meaning is the only colour on the board, so it is what makes the board readable at a glance. A card body is plain text that shows 6 lines before "... more" - split long content into several cards.',
      "ref: a short name you give a section or card (default section-1, section-1.card-2). links: [{ from, to, label }] take refs, or ids of visible items already on the board, and the label reads from -> to. The heading's ref is 'heading'.",
      `At most ${COMPOSE_LIMITS.items} items (heading + frames + cards) and ${COMPOSE_LIMITS.links} links per call; everything is checked before anything is written. The result maps every ref to its id and gives the composition's bounds - use whiteboard_arrange with those ids to adjust it. Every item is tagged 'agent'. Pass a clientRef: a retry after a timeout finishes the same board instead of drawing a second one.`,
    ].join('\n\n'),
    scopes: ['write'],
    keyed: true,
    cost: () => [WHITEBOARD_COMPOSE_LIMIT],
    lazyCost: true,
    input: z.object({
      boardId: z.string().max(64).optional(),
      newBoard: z
        .object({ title: z.string().trim().min(1).max(LIMITS.title) })
        .optional(),
      layout: z.enum(COMPOSE_LAYOUTS).default('columns'),
      heading: z.string().trim().min(1).max(LIMITS.title).optional(),
      sections: z.array(composeSection).min(1).max(COMPOSE_LIMITS.sections),
      links: z
        .array(
          z.object({
            from: z.string().max(64),
            to: z.string().max(64),
            label: z.string().max(LIMITS.linkLabel).optional(),
          })
        )
        .max(COMPOSE_LIMITS.links)
        .optional(),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    async run(args, { token, setTarget, spend }) {
      for (const [s, section] of args.sections.entries())
        for (const [c, card] of section.cards.entries()) {
          const where = `sections[${s}].cards[${c}]`
          if (card.form !== 'todo' && card.todos?.length)
            return refuse(
              `${where}: only a to-do card has todos - pass form 'todo'.`
            )
          if (card.form !== 'shape' && card.shape)
            return refuse(
              `${where}: only a shape card has a shape - pass form 'shape'.`
            )
          // Stored but never drawn on a to-do or shape card: it would be invisible text.
          if (card.form !== 'text' && card.body?.trim())
            return refuse(
              `${where}: only a text card shows a body - put the detail in the title, the to-do rows, or a text card beside it.`
            )
        }

      // Spent here, after the cheap shape checks: a malformed outline costs nothing.
      const limited = await spend()
      if (limited) return limited

      // `defineTool` adds clientRef to a keyed tool's schema, not to its type.
      const { clientRef, ...outline } = args as typeof args & {
        clientRef?: string
      }
      // The arguments are in the seed, not just the key: runTool lets a clientRef be reused
      // with a DIFFERENT outline once its row is past the 24 h window, and a seed of token +
      // key alone would then derive the old call's ids - every upsert a no-op, the new
      // outline silently dropped, and `ok` returned. Same key and same outline still
      // converge, which is the retry the seed exists for.
      const result = await composeAgentBoard(outline, {
        seed: clientRef
          ? `${token.tokenId}:${clientRef}:${hashArgs(outline)}`
          : null,
      })
      if (!result.ok)
        return refuse(
          result.error,
          result.status === 404 ? 'not-found' : 'invalid'
        )
      setTarget({ kind: 'whiteboard-board', id: result.value.board.id })
      return ok(
        JSON.stringify(
          {
            ...result.value,
            next: `The owner opens it at ${result.value.board.path}. Adjust with whiteboard_arrange (ids above); add to it with another whiteboard_compose on boardId ${result.value.board.id}.`,
          },
          null,
          2
        )
      )
    },
  })

  const arrange = defineTool({
    name: 'whiteboard_arrange',
    title: 'Move, resize or delete agent items',
    description:
      "Tidy what you wrote: move or resize items (x, y, width, height), or delete them. Only items that are visible to you AND tagged 'agent' - the ones whiteboard_add_item and whiteboard_compose made - can be touched; one id that is not refuses the whole call, and nothing is changed. A card inside a frame uses the frame's own coordinates (0,0 is the frame's top-left). Text and to-do cards size their height to their content, so height only matters for frames and shapes. A frame you made that the owner has since put their own cards into is theirs to move: it is refused, since moving or deleting a frame moves or un-frames everything in it. Deleting an item removes its arrows. If the owner removes the 'agent' tag from a card, it is theirs and you can no longer touch it. Pass a clientRef so a retry does not act twice.",
    scopes: ['write'],
    keyed: true,
    cost: () => [WHITEBOARD_AGENT_WRITE_LIMIT],
    input: z.object({
      moves: z
        .array(
          z.object({
            id: itemId,
            x: z.number().finite().optional(),
            y: z.number().finite().optional(),
            width: z.number().finite().min(1).optional(),
            height: z.number().finite().min(1).optional(),
          })
        )
        .max(COMPOSE_LIMITS.arrangeOps)
        .optional(),
      deletes: z.array(itemId).max(COMPOSE_LIMITS.arrangeOps).optional(),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    async run(args, { setTarget }) {
      const ops = (args.moves?.length ?? 0) + (args.deletes?.length ?? 0)
      if (ops > COMPOSE_LIMITS.arrangeOps)
        return refuse(
          `At most ${COMPOSE_LIMITS.arrangeOps} moves and deletes per call; split it.`
        )
      const result = await arrangeAgentItems(args)
      if (!result.ok)
        return refuse(
          result.error,
          result.status === 404 ? 'not-found' : 'invalid'
        )
      const first = result.value.moved[0] ?? result.value.deleted[0]
      if (first) setTarget({ kind: 'whiteboard-item', id: first })
      return ok(JSON.stringify(result.value, null, 2))
    },
  })

  return [addItem, link, compose, arrange]
}
