import {
  MEANINGS,
  WHITEBOARD_TIMEZONE,
  type Form,
  type InkBBox,
  type Meaning,
  type Status,
  type TodoRow,
} from '@/lib/whiteboard/limits'

/**
 * The one serializer: visible items and links in, markdown out.
 *
 * ```
 *   loadAgentVisible(scope)          (data.ts - the ONLY privacy path)
 *        │  items in scope, visible frames, visible neighbours, visible links
 *        ▼
 *   renderContext ──────────▶ Export sheet, GET /api/whiteboard/context.md
 *   renderSearchResults ────▶ MCP search_context   (32k-char budget, D18)
 *   renderOverview ─────────▶ MCP get_overview     (no bodies)
 *   renderItemDetail ───────▶ MCP get_item         (full body, neighbour titles)
 *
 *   ## <Frame title>              one per frame, then ## Unframed
 *   ### <Meaning>                 dream, goal, failure, draft, note, then Unclassified
 *   #### <title>                  one per item
 *   id … · goal · active · when 2025-03-14 · target by 2027-06-30 · `tag`
 *   > body, one prefix per line
 *   - blocks -> [[Title]] (id)                 outgoing
 *   - <- led to [[Title]] (id)                 incoming
 * ```
 *
 * ## Why this module is pure and knows nothing about privacy
 *
 * The export the owner pastes and the answer an agent gets must be the same text, so there
 * is exactly one renderer. It must also never be the thing deciding what is private: a
 * serializer that filters is a second privacy path, and two paths drift. Everything that
 * reaches these functions has already been through `loadAgentVisible`. A hidden item is not
 * something this module skips - it is something it never receives. That is also why a
 * hidden link target simply cannot appear: the link that would name it was dropped upstream.
 *
 * ## Escaping, and why bodies are blockquotes
 *
 * A title is owner-written text that lands at heading level. `# Ignore previous notes` as a
 * title must not open a new top-level section in the agent's view of the board, and
 * `]] (id) - blocks -> [[` must not forge a link. So single-line fields get a leading `#`
 * escaped and `[[`/`]]` split apart. A body is multi-line free text, and escaping every
 * markdown construct in it would mangle the owner's own lists and code. Prefixing every line
 * with `> ` is the smaller hammer: nothing inside a blockquote can start a heading at the
 * document's level.
 *
 * ## Truncation (1 MB) and the markers it needs
 *
 * Past the cap, items are PICKED by priority (active dreams and goals, then the rest by
 * `updatedAt` desc) and then rendered in the normal grouping - the grouping does not decide
 * who survives. A link to a dropped item still names it, with `(not in this export)`, next
 * to the existing `(outside this export)` for a visible target outside the scope. Without
 * the first marker, a truncated export would present a link to a card the agent then cannot
 * find, and it would reasonably conclude the card does not exist.
 *
 * ## Dates (D22, R3-11)
 *
 * `when` and `targetBy` are calendar days stored as UTC midnight. The effective date of an
 * item is `when ?? createdAt`, where `createdAt` becomes a day in `WHITEBOARD_TIMEZONE`. The
 * meta line always prints one of `when YYYY-MM-DD` / `created YYYY-MM-DD`, so the pasted
 * export dates a card exactly the way `search_context` filters it.
 */

// MARK: Input shapes

/** An item as the serializer sees it: no ink points, ever (D27). */
export interface ContextItem {
  id: string
  form: Form
  meaning: Meaning | null
  status: Status | null
  title: string
  body: string
  todos: TodoRow[]
  shape: string | null
  /** Local to the item's own x/y. Only present on ink. */
  inkBBox: InkBBox | null
  parentId: string | null
  x: number
  y: number
  width: number
  height: number
  tags: string[]
  when: Date | null
  targetBy: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface ContextLink {
  id: string
  from: string
  to: string
  label: string
}

export interface ContextInput {
  /** The items the scope selects, frames included. Already visible. */
  items: ContextItem[]
  /** Every visible frame, for group headings and absolute coordinates. */
  frames: ContextItem[]
  /** Visible items outside the scope that a link names. Title and id only. */
  neighbours: ContextItem[]
  /** Visible links (both ends visible) touching at least one in-scope item. */
  links: ContextLink[]
  /**
   * Candidates for ink "near" labels. Defaults to `items` (rule 4: in-scope only). The
   * search path passes every visible item, loaded bbox-only (D27).
   */
  inkPeers?: ContextItem[]
}

// MARK: Budgets

/** The full export. Measured in UTF-8 bytes, because that is what "1 MB" means on the wire. */
export const EXPORT_MAX_BYTES = 1_000_000
/** D18: every MCP tool answer, ~8k tokens at chars/4. */
export const MCP_BUDGET_CHARS = 32_000
/** D18: a body inside a search result. */
export const SEARCH_BODY_CLIP = 1_200
export const INK_NEAR_PX = 200
export const INK_NEAR_MAX = 3

const MEANING_LABEL: Record<Meaning, string> = {
  dream: 'Dreams',
  goal: 'Goals',
  failure: 'Failures',
  draft: 'Drafts',
  note: 'Notes',
}

// MARK: Escaping

/** A title, label, todo row or tag, made safe to sit on one markdown line. */
export function escapeInline(value: string): string {
  return value
    .replace(/[\r\n\u2028\u2029]+/g, ' ')
    .replace(/\[\[/g, '[ [')
    .replace(/\]\]/g, '] ]')
    .replace(/^(\s*)#/, '$1\\#')
}

export function quoteBody(body: string): string {
  return body
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => (line ? `> ${line}` : '>'))
    .join('\n')
}

function inlineCode(value: string): string {
  const clean = value.replace(/[\r\n]+/g, ' ')
  const longest = Math.max(
    0,
    ...(clean.match(/`+/g) ?? []).map(run => run.length)
  )
  const fence = '`'.repeat(longest + 1)
  return longest ? `${fence} ${clean} ${fence}` : `${fence}${clean}${fence}`
}

export function displayTitle(item: Pick<ContextItem, 'title' | 'form'>) {
  const title = item.title.trim()
  return title ? escapeInline(title) : `(untitled ${item.form})`
}

// MARK: Dates (D22)

const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: WHITEBOARD_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** A calendar-day field (UTC midnight) as `YYYY-MM-DD`. */
export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** An instant as the owner's calendar day. */
export function zonedDay(date: Date): string {
  return dayFormatter.format(date)
}

export function effectiveDay(item: Pick<ContextItem, 'when' | 'createdAt'>) {
  return item.when ? utcDay(item.when) : zonedDay(item.createdAt)
}

const DAY_ONLY = /^\d{4}-\d{2}-\d{2}$/

export function isDayParam(value: unknown): value is string {
  if (typeof value !== 'string' || !DAY_ONLY.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && utcDay(date) === value
}

/** Offset of `WHITEBOARD_TIMEZONE` from UTC at `instant`, in ms. */
function zoneOffsetMs(instant: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: WHITEBOARD_TIMEZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(instant))
  const get = (type: string) =>
    Number(parts.find(part => part.type === type)?.value)
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second')
  )
  return asUtc - Math.floor(instant / 1000) * 1000
}

/** The first instant of `day` in the owner's timezone. */
export function zonedDayStart(day: string): Date {
  const guess = Date.parse(`${day}T00:00:00.000Z`)
  return new Date(guess - zoneOffsetMs(guess))
}

function nextDay(day: string): string {
  const date = new Date(`${day}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + 1)
  return utcDay(date)
}

export interface DateRange {
  from?: string
  to?: string
}

export interface DateFilter {
  from?: string
  to?: string
  targetFrom?: string
  targetTo?: string
}

/**
 * The bounds a Mongo query needs for one inclusive `YYYY-MM-DD` range, in both of the
 * forms the date rule compares: UTC-midnight days (`when`, `targetBy`) and zoned instants
 * (`createdAt`). `to` is inclusive through the end of its day, so it becomes a strict upper
 * bound at the start of the next day.
 */
export function dayRangeBounds({ from, to }: DateRange) {
  return {
    dayFrom: from ? new Date(`${from}T00:00:00.000Z`) : undefined,
    dayToExclusive: to ? new Date(`${nextDay(to)}T00:00:00.000Z`) : undefined,
    instantFrom: from ? zonedDayStart(from) : undefined,
    instantToExclusive: to ? zonedDayStart(nextDay(to)) : undefined,
  }
}

function inRange(day: string | null, { from, to }: DateRange) {
  if (!from && !to) return true
  if (!day) return false
  return (!from || day >= from) && (!to || day <= to)
}

/** The date rule on one item, in memory. `data.ts` builds the same test as a query. */
export function matchesDateFilter(
  item: Pick<ContextItem, 'when' | 'createdAt' | 'targetBy'>,
  filter: DateFilter
): boolean {
  return (
    inRange(effectiveDay(item), { from: filter.from, to: filter.to }) &&
    inRange(item.targetBy ? utcDay(item.targetBy) : null, {
      from: filter.targetFrom,
      to: filter.targetTo,
    })
  )
}

// MARK: Geometry

interface Box {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** Canvas-absolute box: `parent.xy + item.xy` (+ point bounds for ink). Frames are flat. */
export function absoluteBox(
  item: ContextItem,
  framesById: ReadonlyMap<string, ContextItem>
): Box {
  const parent = item.parentId ? framesById.get(item.parentId) : undefined
  const ox = item.x + (parent?.x ?? 0)
  const oy = item.y + (parent?.y ?? 0)
  if (item.form === 'ink' && item.inkBBox)
    return {
      minX: ox + item.inkBBox.minX,
      minY: oy + item.inkBBox.minY,
      maxX: ox + item.inkBBox.maxX,
      maxY: oy + item.inkBBox.maxY,
    }
  return { minX: ox, minY: oy, maxX: ox + item.width, maxY: oy + item.height }
}

/** Gap between two boxes; 0 when they touch or overlap. */
export function boxGap(a: Box, b: Box): number {
  const dx = Math.max(0, a.minX - b.maxX, b.minX - a.maxX)
  const dy = Math.max(0, a.minY - b.maxY, b.minY - a.maxY)
  return Math.hypot(dx, dy)
}

/**
 * `[Sketch near: A, B, C]` - up to three visible peers within 200px of the stroke, nearest
 * first. Frames and other sketches are not neighbours: a frame contains the sketch rather
 * than sitting near it (its heading already says so), and "near another sketch" says
 * nothing.
 */
export function inkLabel(
  ink: ContextItem,
  peers: readonly ContextItem[],
  framesById: ReadonlyMap<string, ContextItem>
): string {
  const box = absoluteBox(ink, framesById)
  const near = peers
    .filter(
      peer => peer.id !== ink.id && peer.form !== 'ink' && peer.form !== 'frame'
    )
    .map(peer => ({ peer, gap: boxGap(box, absoluteBox(peer, framesById)) }))
    .filter(entry => entry.gap <= INK_NEAR_PX)
    .sort((a, b) => a.gap - b.gap || a.peer.id.localeCompare(b.peer.id))
    .slice(0, INK_NEAR_MAX)
    .map(entry => displayTitle(entry.peer))

  return near.length ? `[Sketch near: ${near.join(', ')}]` : '[Sketch]'
}

// MARK: Entry rendering

type TargetState = 'in' | 'outside' | 'truncated'

interface EntryContext {
  byId: ReadonlyMap<string, ContextItem>
  framesById: ReadonlyMap<string, ContextItem>
  outgoing: ReadonlyMap<string, ContextLink[]>
  incoming: ReadonlyMap<string, ContextLink[]>
  inkPeers: readonly ContextItem[]
  targetState: (id: string) => TargetState
}

export interface EntryOptions {
  /** Clip the body at N chars with a `get_item` pointer (D18). */
  clipBody?: number
  /** Print `in frame <title>` in the meta line - for flat lists with no frame headings. */
  showFrame?: boolean
  /** Leave the body out entirely (get_overview). */
  omitBody?: boolean
  /** Leave the links out (get_overview). */
  omitLinks?: boolean
}

export function metaLine(
  item: ContextItem,
  framesById?: ReadonlyMap<string, ContextItem>,
  showFrame = false
): string {
  const parts = [`id ${item.id}`]
  if (item.form !== 'text')
    parts.push(
      item.form === 'shape' && item.shape ? `shape ${item.shape}` : item.form
    )
  parts.push(item.meaning ?? 'unclassified')
  if (item.status) parts.push(item.status)
  parts.push(
    item.when
      ? `when ${utcDay(item.when)}`
      : `created ${zonedDay(item.createdAt)}`
  )
  if (item.targetBy) parts.push(`target by ${utcDay(item.targetBy)}`)
  if (showFrame && item.parentId) {
    const frame = framesById?.get(item.parentId)
    if (frame) parts.push(`in frame ${displayTitle(frame)}`)
  }
  if (item.tags.length) parts.push(item.tags.map(inlineCode).join(' '))
  return parts.join(' · ')
}

function linkLine(
  link: ContextLink,
  direction: 'out' | 'in',
  ctx: EntryContext
): string | null {
  const otherId = direction === 'out' ? link.to : link.from
  const other = ctx.byId.get(otherId)
  // Rule 3/7: a link whose other end is not visible is not rendered at all.
  if (!other) return null

  const label = link.label.trim()
    ? escapeInline(link.label.trim())
    : '(no label)'
  const state = ctx.targetState(otherId)
  const marker =
    state === 'outside'
      ? ' (outside this export)'
      : state === 'truncated'
        ? ' (not in this export)'
        : ''
  const target = `[[${displayTitle(other)}]] (${other.id})${marker}`
  return direction === 'out'
    ? `- ${label} -> ${target}`
    : `- <- ${label} ${target}`
}

function entryParts(
  item: ContextItem,
  ctx: EntryContext,
  options: EntryOptions = {}
): { lines: string[]; rows: string[]; links: string[] } {
  const lines = [
    `#### ${displayTitle(item)}`,
    metaLine(item, ctx.framesById, options.showFrame),
  ]

  if (!options.omitBody && item.body.trim()) {
    let body = item.body
    let clipped = false
    if (options.clipBody && body.length > options.clipBody) {
      body = body.slice(0, options.clipBody)
      clipped = true
    }
    lines.push(quoteBody(body))
    if (clipped) lines.push(`(clipped - get_item ${item.id})`)
  }

  // To-do rows are body-sized too (100 rows of 500 chars), so the D18 clip covers them: a
  // search entry keeps rows up to `clipBody` chars and points at get_item for the rest.
  const rows: string[] = []
  if (item.form === 'todo') {
    let used = 0
    for (const [index, row] of item.todos.entries()) {
      const line = `- [${row.done ? 'x' : ' '}] ${escapeInline(row.text)}`
      if (options.clipBody && used + line.length > options.clipBody) {
        rows.push(
          `(${item.todos.length - index} more rows - get_item ${item.id})`
        )
        break
      }
      rows.push(line)
      used += line.length + 1
    }
  }

  if (item.form === 'ink')
    lines.push(inkLabel(item, ctx.inkPeers, ctx.framesById))

  const links: string[] = []
  if (!options.omitLinks) {
    for (const link of ctx.outgoing.get(item.id) ?? []) {
      const line = linkLine(link, 'out', ctx)
      if (line) links.push(line)
    }
    for (const link of ctx.incoming.get(item.id) ?? []) {
      const line = linkLine(link, 'in', ctx)
      if (line) links.push(line)
    }
  }

  return { lines, rows, links }
}

function renderEntry(
  item: ContextItem,
  ctx: EntryContext,
  options: EntryOptions = {}
): string {
  const { lines, rows, links } = entryParts(item, ctx, options)
  // Ink items have no rows, so the ink label (last in `lines`) never lands after them.
  return [...lines, ...rows, ...links].join('\n')
}

function byRecency(a: ContextItem, b: ContextItem) {
  return (
    b.updatedAt.getTime() - a.updatedAt.getTime() || a.id.localeCompare(b.id)
  )
}

function groupLinks(links: readonly ContextLink[]) {
  const outgoing = new Map<string, ContextLink[]>()
  const incoming = new Map<string, ContextLink[]>()
  const sorted = [...links].sort(
    (a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id)
  )
  for (const link of sorted) {
    outgoing.set(link.from, [...(outgoing.get(link.from) ?? []), link])
    incoming.set(link.to, [...(incoming.get(link.to) ?? []), link])
  }
  return { outgoing, incoming }
}

function buildEntryContext(
  input: ContextInput,
  targetState: (id: string) => TargetState
): EntryContext {
  const byId = new Map<string, ContextItem>()
  for (const item of [...input.neighbours, ...input.frames, ...input.items])
    byId.set(item.id, item)
  const framesById = new Map(input.frames.map(frame => [frame.id, frame]))
  for (const item of input.items)
    if (item.form === 'frame') framesById.set(item.id, item)
  return {
    byId,
    framesById,
    ...groupLinks(input.links),
    inkPeers: input.inkPeers ?? input.items,
    targetState,
  }
}

// MARK: Full export

export function isPriority(item: ContextItem) {
  return (
    item.status === 'active' &&
    (item.meaning === 'dream' || item.meaning === 'goal')
  )
}

/** Active dreams and goals first, then everything by `updatedAt` desc (the truncation order). */
export function priorityOrder(items: readonly ContextItem[]): ContextItem[] {
  return [...items].sort(
    (a, b) => Number(isPriority(b)) - Number(isPriority(a)) || byRecency(a, b)
  )
}

const encoder = new TextEncoder()
export const byteLength = (text: string) => encoder.encode(text).length

export interface RenderedContext {
  markdown: string
  /** Items in the scope. */
  totalCount: number
  /** Items actually rendered. Smaller than `totalCount` only when truncated. */
  renderedCount: number
  truncated: boolean
}

function frameOrder(a: ContextItem, b: ContextItem) {
  return a.y - b.y || a.x - b.x || a.id.localeCompare(b.id)
}

function renderGrouped(
  picked: readonly ContextItem[],
  ctx: EntryContext
): string {
  const inScopeFrames = picked.filter(item => item.form === 'frame')
  const sectionIds = new Set(inScopeFrames.map(frame => frame.id))
  for (const item of picked)
    if (item.parentId && ctx.framesById.has(item.parentId))
      sectionIds.add(item.parentId)

  const sections = [...sectionIds]
    .map(id => ctx.framesById.get(id))
    .filter((frame): frame is ContextItem => Boolean(frame))
    .sort(frameOrder)

  const pickedIds = new Set(picked.map(item => item.id))
  const blocks: string[] = []

  const renderMembers = (members: ContextItem[]) => {
    const byMeaning = new Map<Meaning | null, ContextItem[]>()
    for (const item of members)
      byMeaning.set(item.meaning, [
        ...(byMeaning.get(item.meaning) ?? []),
        item,
      ])
    for (const meaning of [...MEANINGS, null] as const) {
      const group = byMeaning.get(meaning)
      if (!group?.length) continue
      blocks.push(`### ${meaning ? MEANING_LABEL[meaning] : 'Unclassified'}`)
      for (const item of [...group].sort(byRecency))
        blocks.push(renderEntry(item, ctx))
    }
  }

  for (const frame of sections) {
    blocks.push(`## ${displayTitle(frame)}`)
    if (pickedIds.has(frame.id)) {
      // The frame's own entry: meta, body and links, without a second heading.
      const entry = renderEntry(frame, ctx).split('\n').slice(1).join('\n')
      blocks.push(entry)
    } else blocks.push(`id ${frame.id} · frame`)
    renderMembers(
      picked.filter(item => item.form !== 'frame' && item.parentId === frame.id)
    )
  }

  const unframed = picked.filter(
    item =>
      item.form !== 'frame' && !(item.parentId && sectionIds.has(item.parentId))
  )
  if (unframed.length) {
    blocks.push('## Unframed')
    renderMembers(unframed)
  }

  return blocks.join('\n\n')
}

const EXPORT_HEADER = [
  '# Whiteboard',
  '',
  "The owner's own notes: dreams, goals, failures, drafts and notes, grouped by frame and meaning. Every item has an id; links name the other item's title and id.",
].join('\n')

/**
 * The full export (Export sheet, `context.md`). Grouped frame > meaning > item, capped at
 * `maxBytes`, truncated by priority with a closing line pointing at `search_context`.
 */
export function renderContext(
  input: ContextInput,
  { maxBytes = EXPORT_MAX_BYTES }: { maxBytes?: number } = {}
): RenderedContext {
  const total = input.items.length
  if (total === 0)
    return { markdown: '', totalCount: 0, renderedCount: 0, truncated: false }

  const scopeIds = new Set(input.items.map(item => item.id))
  const full = buildEntryContext(input, id =>
    scopeIds.has(id) ? 'in' : 'outside'
  )
  const whole = `${EXPORT_HEADER}\n\n${renderGrouped(input.items, full)}\n`
  if (byteLength(whole) <= maxBytes)
    return {
      markdown: whole,
      totalCount: total,
      renderedCount: total,
      truncated: false,
    }

  // Over budget: pick by priority with a pessimistic size per entry (every link carrying the
  // longer marker, plus a heading allowance), then render and trim if the estimate was low.
  const footer = (n: number) =>
    `(truncated: ${n} of ${total} items - use search_context)`
  const reserve = byteLength(EXPORT_HEADER) + byteLength(footer(total)) + 64
  const pessimistic = buildEntryContext(input, id =>
    scopeIds.has(id) ? 'truncated' : 'outside'
  )

  const picked: ContextItem[] = []
  let used = reserve
  for (const item of priorityOrder(input.items)) {
    const cost = byteLength(renderEntry(item, pessimistic)) + 160
    if (used + cost > maxBytes) break
    picked.push(item)
    used += cost
  }

  const render = (chosen: ContextItem[]) => {
    const chosenIds = new Set(chosen.map(item => item.id))
    const ctx = buildEntryContext(input, id =>
      chosenIds.has(id) ? 'in' : scopeIds.has(id) ? 'truncated' : 'outside'
    )
    return `${EXPORT_HEADER}\n\n${renderGrouped(chosen, ctx)}\n\n${footer(chosen.length)}\n`
  }

  let markdown = render(picked)
  while (picked.length > 0 && byteLength(markdown) > maxBytes) {
    picked.pop()
    markdown = render(picked)
  }

  return {
    markdown,
    totalCount: total,
    renderedCount: picked.length,
    truncated: true,
  }
}

// MARK: MCP tool answers (D18)

/** Append blocks until the next one would pass the budget; say how many were left out. */
function withinBudget(
  head: string,
  blocks: readonly string[],
  more: (n: number) => string,
  budget = MCP_BUDGET_CHARS
): string {
  const out = [head]
  let used = head.length
  for (const [index, block] of blocks.entries()) {
    const tail = more(blocks.length - index)
    if (used + block.length + 2 + tail.length + 2 > budget) {
      out.push(tail)
      return out.join('\n\n')
    }
    out.push(block)
    used += block.length + 2
  }
  return out.join('\n\n')
}

/**
 * `search_context`: results in rank order, each one entry with its links, bodies clipped at
 * 1,200 chars. Entries stop at the 32k budget with `(N more - narrow the search)`.
 */
export function renderSearchResults(
  results: readonly ContextItem[],
  input: Omit<ContextInput, 'items'>,
  { budget = MCP_BUDGET_CHARS }: { budget?: number } = {}
): string {
  if (results.length === 0) return 'No matching items.'

  const ctx = buildEntryContext({ ...input, items: [...results] }, () => 'in')
  const blocks = results.map(item =>
    renderEntry(item, ctx, { clipBody: SEARCH_BODY_CLIP, showFrame: true })
  )
  const head = `${results.length} matching item${results.length === 1 ? '' : 's'}:`
  return withinBudget(
    head,
    blocks,
    n => `(${n} more - narrow the search)`,
    budget
  )
}

export interface OverviewInput {
  frames: { item: ContextItem; visibleCount: number }[]
  meaningCounts: Record<Meaning | 'none', number>
  totalVisible: number
  /** Active dreams and goals, newest first, max 20. */
  active: ContextItem[]
  /** The 10 most recently updated visible items. */
  recent: ContextItem[]
  framesById: ReadonlyMap<string, ContextItem>
}

/** `get_overview`: titles and meta only, never a body. */
export function renderOverview(
  input: OverviewInput,
  { budget = MCP_BUDGET_CHARS }: { budget?: number } = {}
): string {
  const line = (item: ContextItem) =>
    `- ${displayTitle(item)} - ${metaLine(item, input.framesById, true)}`

  const counts = [...MEANINGS, 'none' as const]
    .map(m => `${m === 'none' ? 'unclassified' : m} ${input.meaningCounts[m]}`)
    .join(', ')

  const blocks = [
    `# Whiteboard overview\n\n${input.totalVisible} visible items (${counts}).`,
    input.frames.length
      ? `## Frames\n${input.frames
          .map(
            ({ item, visibleCount }) =>
              `- ${displayTitle(item)} (${item.id}) - ${visibleCount} item${visibleCount === 1 ? '' : 's'}`
          )
          .join('\n')}`
      : '## Frames\n(none)',
    `## Active dreams and goals\n${
      input.active.length ? input.active.map(line).join('\n') : '(none)'
    }`,
    `## Recently updated\n${
      input.recent.length ? input.recent.map(line).join('\n') : '(none)'
    }`,
    'Use search_context for a topic or date range, and get_item <id> for a full card.',
  ]

  // Overview blocks are whole sections; clip a section's lines rather than dropping it.
  let out = ''
  for (const block of blocks) {
    const next = out ? `${out}\n\n${block}` : block
    if (next.length <= budget) {
      out = next
      continue
    }
    const lines = block.split('\n')
    let partial = out ? `${out}\n\n${lines[0]}` : lines[0]
    let kept = 1
    for (const l of lines.slice(1)) {
      const tail = `\n(${lines.length - kept - 1} more)`
      if (partial.length + l.length + 1 + tail.length > budget) break
      partial += `\n${l}`
      kept++
    }
    out = `${partial}\n(${lines.length - kept} more)`
    break
  }
  return out
}

/** `get_item`: the full body, links with neighbour titles and ids only. */
export function renderItemDetail(
  item: ContextItem,
  input: Omit<ContextInput, 'items'>,
  { budget = MCP_BUDGET_CHARS }: { budget?: number } = {}
): string {
  const ctx = buildEntryContext({ ...input, items: [item] }, () => 'in')
  // The body is capped at 20,000 by limits.ts and always fits. To-do rows (up to 100 of 500
  // chars) and links are not, so both are added only while the answer stays in budget.
  const { lines, rows, links } = entryParts(item, ctx, { showFrame: true })

  let out = lines.join('\n')
  const append = (entries: string[], noun: string) => {
    for (const [index, entry] of entries.entries()) {
      const tail = `\n(${entries.length - index} more ${noun})`
      if (out.length + entry.length + 1 + tail.length > budget) {
        out += tail
        return false
      }
      out += `\n${entry}`
    }
    return true
  }
  if (append(rows, 'rows')) append(links, 'links')
  else if (links.length) out += `\n(${links.length} more links)`
  return out
}
