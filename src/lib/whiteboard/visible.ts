import {
  matchesDateFilter,
  renderContext,
  type ContextInput,
  type ContextItem,
  type ContextLink,
} from '@/lib/whiteboard/context'
import { isObjectIdString } from '@/lib/whiteboard/limits'
import type {
  ClientItem,
  ClientLink,
  ExportScope,
} from '@/lib/whiteboard/types'

/**
 * The Export sheet's privacy filter, in memory: one board the browser already holds in, the
 * same `ContextInput` `loadAgentVisible` would build out.
 *
 * ```
 *   board.data (live, unsaved edits included)
 *        │ selectExportInput(scope)          this file - rules 0, 1, 2, 7 over plain arrays
 *        ▼
 *   renderContext ──▶ Export sheet preview   (context.ts, the one serializer)
 *
 *   Mongo ──▶ loadAgentVisible(scope) ──▶ renderContext ──▶ context.md, MCP
 *                 data.ts - the same rules as queries
 * ```
 *
 * ## Why there are two filters now, and what keeps them one
 *
 * The preview used to be a `POST /context` that ran `loadAgentVisible` on the server, so the
 * owner's copy and an agent's read went through literally the same code. The price was a
 * round trip and ~6 queries per edit while the sheet was open, and a preview that showed the
 * database rather than the canvas - with auto-save off (D31) it lagged until Save.
 *
 * So the filter now exists twice, and the thing that makes that safe is
 * `tests/api/whiteboard-export-parity.test.ts`: it seeds a board with every edge case the
 * rules have (hidden frame, hidden card in a visible frame, a parent that does not exist,
 * links into hidden cards, dates either side of the timezone's midnight) and asserts both
 * paths render byte-identical markdown with the same counts, for every scope. Change a rule
 * in one place and that test fails until the other matches. Do not "simplify" this file
 * without running it.
 *
 * The rules, in the order `loadExport` applies them:
 *
 * - The board is hidden: nothing, `scopeHidden`, and every item on it counted as held back.
 * - An item is visible when its own switch is on and it is unframed or inside a visible
 *   frame. A `parentId` naming a frame that is not there is NOT unframed - it is hidden, as
 *   the query's `parentId $in <visible frames>` makes it.
 * - A hidden frame scope answers like a hidden board: `scopeHidden`, frame plus children
 *   counted. An unknown or malformed frame id is an empty export with nothing counted.
 * - `excludedCount` is the scope's candidates minus the visible ones.
 * - A link is rendered only when both ends are shown (in scope, or a visible neighbour).
 */

/** What an export scope selects, before rendering. Also `loadAgentVisible`'s export answer. */
export interface ExportLoad {
  input: ContextInput
  excludedCount: number
  scopeHidden: boolean
}

const utcMidnight = (day: string) => new Date(`${day}T00:00:00.000Z`)

/** A canvas item as the serializer sees it - `toContextItem` in data.ts, from wire shapes. */
export function clientToContextItem(
  item: ClientItem,
  boardId?: string
): ContextItem {
  return {
    id: item._id,
    boardId,
    form: item.form,
    meaning: item.meaning ?? null,
    status: item.status ?? null,
    title: item.title ?? '',
    body: item.body ?? '',
    todos: (item.todos ?? []).map(({ id, text, done }) => ({ id, text, done })),
    shape: item.shape ?? null,
    // D27: never the points.
    inkBBox: item.ink?.bbox ?? null,
    parentId: item.parentId,
    x: item.x,
    y: item.y,
    width: item.width,
    height: item.height,
    tags: item.tags ?? [],
    when: item.when ? utcMidnight(item.when) : null,
    targetBy: item.targetBy ? utcMidnight(item.targetBy) : null,
    createdAt: new Date(item.createdAt),
    updatedAt: new Date(item.updatedAt),
  }
}

function toContextLink(link: ClientLink): ContextLink {
  return { id: link._id, from: link.from, to: link.to, label: link.label }
}

export function selectExportInput(
  board: {
    boardId?: string
    items: readonly ClientItem[]
    links: readonly ClientLink[]
    /** The board's own agent switch (D32). */
    visible: boolean
  },
  scope: ExportScope
): ExportLoad {
  const { items, boardId } = board
  const toContext = (item: ClientItem) => clientToContextItem(item, boardId)

  if (!board.visible)
    return {
      input: { items: [], frames: [], neighbours: [], links: [] },
      excludedCount: items.length,
      scopeHidden: true,
    }

  const visibleFrames = items.filter(
    item => item.form === 'frame' && item.includeInAi
  )
  const visibleFrameIds = new Set(visibleFrames.map(frame => frame._id))
  const isVisible = (item: ClientItem) =>
    item.includeInAi &&
    (item.parentId === null || visibleFrameIds.has(item.parentId))

  const frames = visibleFrames.map(toContext)
  const empty: ExportLoad = {
    input: { items: [], frames, neighbours: [], links: [] },
    excludedCount: 0,
    scopeHidden: false,
  }

  let candidates: ClientItem[]
  switch (scope.kind) {
    case 'all':
      candidates = [...items]
      break
    case 'frame': {
      if (!isObjectIdString(scope.id)) return empty
      const id = scope.id.toLowerCase()
      const frame = items.find(item => item._id === id && item.form === 'frame')
      if (!frame) return empty
      const members = items.filter(
        item => item._id === id || item.parentId === id
      )
      if (!frame.includeInAi)
        return { ...empty, excludedCount: members.length, scopeHidden: true }
      candidates = members
      break
    }
    case 'selection': {
      const ids = new Set(
        scope.ids.filter(isObjectIdString).map(id => id.toLowerCase())
      )
      if (ids.size === 0) return empty
      candidates = items.filter(item => ids.has(item._id))
      break
    }
    case 'filter': {
      const { meanings = [], status = [] } = scope
      candidates = items.filter(
        item =>
          (!meanings.length ||
            (item.meaning !== null && meanings.includes(item.meaning))) &&
          (!status.length ||
            (item.status !== null && status.includes(item.status))) &&
          matchesDateFilter(
            {
              when: item.when ? utcMidnight(item.when) : null,
              targetBy: item.targetBy ? utcMidnight(item.targetBy) : null,
              createdAt: new Date(item.createdAt),
            },
            scope
          )
      )
      break
    }
  }

  const inScope = candidates.filter(isVisible)
  const scopeIds = new Set(inScope.map(item => item._id))
  const byId = new Map(items.map(item => [item._id, item]))

  // `linksAndNeighbours`: links touching the scope, the visible items at their other ends,
  // and only the links whose both ends are then shown.
  const touching = board.links.filter(
    link => scopeIds.has(link.from) || scopeIds.has(link.to)
  )
  const neighbourIds = new Set<string>()
  for (const link of touching)
    for (const end of [link.from, link.to]) {
      const other = byId.get(end)
      if (!scopeIds.has(end) && other && isVisible(other)) neighbourIds.add(end)
    }
  const shown = new Set([...scopeIds, ...neighbourIds])

  return {
    input: {
      items: inScope.map(toContext),
      // `visibleBoardSections` names boards only when there are two or more; this is one.
      boards: [],
      frames,
      neighbours: [...neighbourIds].map(id => toContext(byId.get(id)!)),
      links: touching
        .filter(link => shown.has(link.from) && shown.has(link.to))
        .map(toContextLink),
    },
    excludedCount: Math.max(0, candidates.length - inScope.length),
    scopeHidden: false,
  }
}

/** What the Export sheet shows (D25): the markdown, and what the filter left out. */
export interface ExportPreview {
  markdown: string
  /** In-scope items the privacy filter dropped. */
  excludedCount: number
  /** The scope is a hidden frame, or the board itself is hidden. */
  scopeHidden: boolean
  totalCount: number
  renderedCount: number
  truncated: boolean
}

export function buildExportPreview(
  board: Parameters<typeof selectExportInput>[0],
  scope: ExportScope
): ExportPreview {
  const { input, excludedCount, scopeHidden } = selectExportInput(board, scope)
  const { markdown, totalCount, renderedCount, truncated } =
    renderContext(input)
  return {
    markdown,
    excludedCount,
    scopeHidden,
    totalCount,
    renderedCount,
    truncated,
  }
}
