/**
 * The geometry behind `whiteboard_compose`: an outline in, non-overlapping rectangles out.
 *
 * ```
 *   heading?  sections[{ title, cards[] }]  layout
 *        │              │                     │
 *        │              ▼                     │
 *        │   estimateCardHeight(card, width)  │   a card's canvas height is its CONTENT
 *        │              ▼                     │   (Canvas.tsx leaves it unset), so it is
 *        │   masonry inside each frame        │   predicted here from the same type sizes
 *        │   (next card ──▶ shortest column)  │   CardNode.tsx renders with
 *        │              ▼                     ▼
 *        │   frame = padding + columns ──▶ place frames:  columns │ grid │ timeline │ mindmap
 *        ▼                                                   ▼
 *   heading shape above (or the mindmap's centre) ──▶ shift so the top-left sits at `origin`
 * ```
 *
 * ## Why the server lays the board out and the agent does not
 *
 * The first version of the agent write path had the agent add one card at a time, and
 * `freePosition` put each one 80px to the right of the last: a 40-card board came out as a
 * single strip several metres long, with no grouping, that the owner then had to arrange by
 * hand. Handing the agent raw x/y instead does not fix that - it cannot see the canvas, does
 * not know how tall a card with four lines of body renders, and guesses overlapping
 * coordinates. What it CAN do well is describe structure. So it sends sections and cards, and
 * this module - which knows the card's type sizes - turns that into geometry.
 *
 * ## Why the height is an overestimate
 *
 * Text cards and to-do cards size to their content, so the stored `height` is only this
 * module's prediction. Guessing short makes the next card in the column overlap this one;
 * guessing tall only leaves a slightly bigger gap. The estimate therefore wraps on fewer
 * characters per line than the font would fit and rounds up.
 *
 * Pure: no mongoose, no `server-only`, so the unit tests can check the geometry directly.
 */

export const COMPOSE_LAYOUTS = [
  'columns',
  'grid',
  'timeline',
  'mindmap',
] as const
export type ComposeLayout = (typeof COMPOSE_LAYOUTS)[number]

/**
 * One compose call's ceiling. 150 items is a dense, readable board; past that a board is
 * better built in two calls, and a runaway agent cannot write more than this per call (its
 * calls are capped separately by WHITEBOARD_COMPOSE_LIMIT).
 */
export const COMPOSE_LIMITS = {
  sections: 12,
  cardsPerSection: 40,
  items: 150,
  links: 150,
  ref: 40,
  /** whiteboard_arrange: moves plus deletes in one call. */
  arrangeOps: 100,
} as const

/** `normal` is the canvas default (240); `wide` stays inside CardNode's 480 resize cap. */
export const CARD_WIDTHS = { normal: 240, wide: 340 } as const
export type CardWidth = keyof typeof CARD_WIDTHS

export interface LayoutCard {
  ref: string
  form: 'text' | 'todo' | 'shape'
  title: string
  body: string
  /** The to-do rows' texts: a long row wraps, so a count alone under-estimates. */
  todos: readonly string[]
  tags: readonly string[]
  /** The card shows a status or date line, which does not change its height (min-h row). */
  hasMeta: boolean
}

export interface LayoutSection {
  ref: string
  title: string
  cards: readonly LayoutCard[]
  /** Card columns inside the frame; defaults per layout. */
  columns?: number
  cardWidth?: CardWidth
}

export interface LayoutInput {
  layout: ComposeLayout
  /** A banner shape above the sections, or `null` for none. A mindmap always has a centre. */
  heading: string | null
  sections: readonly LayoutSection[]
  /** Where the top-left of the whole composition lands on the canvas. */
  origin: { x: number; y: number }
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** A placed item. Cards are relative to their frame (`parentRef`), as the canvas stores them. */
export interface Placed extends Rect {
  ref: string
  parentRef: string | null
}

export type Side = 't' | 'r' | 'b' | 'l'

export interface AutoLink {
  from: string
  to: string
  fromHandle: Side
  toHandle: Side
}

export interface LayoutResult {
  heading: Placed | null
  frames: Placed[]
  cards: Placed[]
  /** Arrows the layout itself implies: timeline order, mindmap spokes. */
  autoLinks: AutoLink[]
  /** The whole composition, canvas-absolute. */
  bounds: Rect
}

// MARK: Spacing

const FRAME_PAD_X = 24
/** Room under the frame's title tab, which hangs 14px over the top border (FrameNode.tsx). */
const FRAME_PAD_TOP = 36
const FRAME_PAD_BOTTOM = 24
const CARD_GAP = 20
const FRAME_GAP = 72
/** Wider than FRAME_GAP so the arrow between two phases has a visible run. */
const TIMELINE_GAP = 136
const MINDMAP_GAP_X = 180
const MINDMAP_GAP_Y = 56
const HEADING_HEIGHT = 76
const HEADING_GAP = 56
const SHAPE_HEIGHT = 96
const CENTRE = { width: 280, height: 132 }
/** FrameNode's NodeResizer minimums: a frame smaller than this cannot be resized back. */
const FRAME_MIN = { width: 220, height: 140 }
const FRAME_MAX_TITLE_WIDTH = 640
const MAX_COLUMNS = 4

// MARK: Card height

/**
 * Type sizes from CardNode.tsx (its `CHIP_CLS` / `BODY_TEXT_CLS` note): `py-3.5` plus the
 * border (30), the chip row (26: an 11.5px chip with `py-1`), the title (`mt-2.5 mb-1.5`,
 * 18px at `leading-[1.3]`), the body (15.5px at `leading-[1.45]`, clamped at 6 lines, then a 13px
 * "... more"), to-do rows (`space-y-1`, 15.5px beside a 17px box and an 8px gap, wrapping)
 * plus the 13px "n of m done" line, and the 12.5px tag row. Character widths are the old
 * per-em measurements scaled to the new sizes; `tests/e2e` checks the result against cards
 * the browser actually renders.
 */
const CARD = {
  padX: 32,
  padY: 30,
  chipRow: 26,
  titleMargin: 16,
  titleLine: 24,
  titleCharPx: 10.7,
  bodyLine: 22.5,
  bodyCharPx: 8.2,
  bodyClamp: 6,
  moreLink: 20,
  /** The 17px checkbox plus `gap-2`, taken off the row's text width. */
  todoBox: 25,
  todoCharPx: 8.2,
  todoLine: 21.4,
  todoRowMin: 22,
  todoGap: 4,
  todoFooter: 27,
  tagRow: 28,
  tagCharPx: 8,
  tagChrome: 22,
  createdLine: 22,
} as const

/** Wrapped line count for pre-line text, breaking on fewer characters than would fit. */
export function wrappedLines(text: string, charsPerLine: number): number {
  const perLine = Math.max(1, Math.floor(charsPerLine * 0.9))
  return text
    .split('\n')
    .reduce(
      (lines, line) => lines + Math.max(1, Math.ceil(line.length / perLine)),
      0
    )
}

export function estimateCardHeight(card: LayoutCard, width: number): number {
  if (card.form === 'shape') return SHAPE_HEIGHT
  const inner = width - CARD.padX
  let height = CARD.padY + CARD.chipRow + CARD.titleMargin
  height +=
    wrappedLines(card.title || 'Untitled', inner / CARD.titleCharPx) *
    CARD.titleLine

  // Truthiness, as CardNode tests it: a newline-only body still renders (pre-line).
  if (card.form === 'text' && card.body) {
    const lines = wrappedLines(card.body, inner / CARD.bodyCharPx)
    height += Math.min(lines, CARD.bodyClamp) * CARD.bodyLine
    if (lines > CARD.bodyClamp) height += CARD.moreLink
  }
  if (card.form === 'todo' && card.todos.length) {
    const perLine = (inner - CARD.todoBox) / CARD.todoCharPx
    height += 4 + CARD.todoFooter
    for (const row of card.todos)
      height +=
        Math.max(CARD.todoRowMin, wrappedLines(row, perLine) * CARD.todoLine) +
        CARD.todoGap
  }

  if (card.tags.length) {
    const tagPx = card.tags.reduce(
      (sum, tag) => sum + tag.length * CARD.tagCharPx + CARD.tagChrome,
      0
    )
    height += 8 + Math.ceil(tagPx / inner) * CARD.tagRow
  }
  // CardNode's "created <date>" line, shown on a bare text card.
  if (card.form === 'text' && !card.body && !card.hasMeta)
    height += CARD.createdLine

  return Math.ceil((height * 1.04) / 4) * 4
}

// MARK: One frame

interface FrameBox {
  ref: string
  width: number
  height: number
  cards: Placed[]
}

function defaultColumns(layout: ComposeLayout) {
  return layout === 'grid' ? 2 : 1
}

/**
 * Masonry: each card goes under the shortest column so far. Reading order is kept within a
 * column and roughly across them, and no column runs far past the others - which is what a
 * row-by-row grid of content-sized cards cannot promise.
 */
function layoutFrame(section: LayoutSection, layout: ComposeLayout): FrameBox {
  const cardWidth = CARD_WIDTHS[section.cardWidth ?? 'normal']
  const columns = Math.max(
    1,
    Math.min(
      section.columns ?? defaultColumns(layout),
      MAX_COLUMNS,
      section.cards.length || 1
    )
  )
  const bottoms = new Array<number>(columns).fill(0)
  const cards: Placed[] = []

  for (const card of section.cards) {
    let column = 0
    for (let index = 1; index < columns; index += 1)
      if (bottoms[index] < bottoms[column]) column = index
    const height = estimateCardHeight(card, cardWidth)
    cards.push({
      ref: card.ref,
      parentRef: section.ref,
      x: FRAME_PAD_X + column * (cardWidth + CARD_GAP),
      y: FRAME_PAD_TOP + bottoms[column],
      width: cardWidth,
      height,
    })
    bottoms[column] += height + CARD_GAP
  }

  const contentHeight = Math.max(0, Math.max(...bottoms) - CARD_GAP)
  const titleWidth = Math.min(
    FRAME_MAX_TITLE_WIDTH,
    Math.ceil(section.title.length * 7.6) + 64
  )
  return {
    ref: section.ref,
    width: Math.max(
      FRAME_MIN.width,
      titleWidth,
      FRAME_PAD_X * 2 + columns * cardWidth + (columns - 1) * CARD_GAP
    ),
    height: Math.max(
      FRAME_MIN.height,
      FRAME_PAD_TOP + contentHeight + FRAME_PAD_BOTTOM
    ),
    cards,
  }
}

// MARK: Arranging frames

type Positioned = FrameBox & { x: number; y: number }

function inRow(boxes: FrameBox[], gap: number): Positioned[] {
  let x = 0
  return boxes.map(box => {
    const placed = { ...box, x, y: 0 }
    x += box.width + gap
    return placed
  })
}

/** Columns aligned across rows: each grid column is as wide as its widest frame. */
function inGrid(boxes: FrameBox[]): Positioned[] {
  const perRow =
    boxes.length <= 3 ? boxes.length : Math.ceil(Math.sqrt(boxes.length))
  const columnWidths = new Array<number>(perRow).fill(0)
  boxes.forEach((box, index) => {
    const column = index % perRow
    columnWidths[column] = Math.max(columnWidths[column], box.width)
  })

  const placed: Positioned[] = []
  let y = 0
  for (let start = 0; start < boxes.length; start += perRow) {
    const row = boxes.slice(start, start + perRow)
    let x = 0
    row.forEach((box, column) => {
      placed.push({ ...box, x, y })
      x += columnWidths[column] + FRAME_GAP
    })
    y += Math.max(...row.map(box => box.height)) + FRAME_GAP
  }
  return placed
}

/**
 * Sections alternate right, left, right... around a centre, each side a vertical stack
 * centred on it - the shape people draw by hand, and one where no spoke crosses a frame.
 */
function inMindmap(boxes: FrameBox[]): {
  frames: Positioned[]
  centre: Rect
} {
  const right = boxes.filter((_, index) => index % 2 === 0)
  const left = boxes.filter((_, index) => index % 2 === 1)
  const stackHeight = (side: FrameBox[]) =>
    side.reduce((sum, box) => sum + box.height, 0) +
    Math.max(0, side.length - 1) * MINDMAP_GAP_Y
  const tallest = Math.max(stackHeight(right), stackHeight(left), CENTRE.height)
  const centre = {
    x: 0,
    y: (tallest - CENTRE.height) / 2,
    ...CENTRE,
  }

  const stack = (side: FrameBox[], xOf: (box: FrameBox) => number) => {
    let y = (tallest - stackHeight(side)) / 2
    return side.map(box => {
      const placed = { ...box, x: xOf(box), y }
      y += box.height + MINDMAP_GAP_Y
      return placed
    })
  }
  return {
    centre,
    frames: [
      ...stack(right, () => CENTRE.width + MINDMAP_GAP_X),
      ...stack(left, box => -MINDMAP_GAP_X - box.width),
    ],
  }
}

// MARK: Handles

/**
 * Which sides an arrow should leave and enter by. React Flow draws an edge with no handle
 * from the node's first one (the top), so a link to a card on the right would loop up and
 * over. Horizontal is preferred: side-by-side frames are the common case here.
 */
export function pickHandles(from: Rect, to: Rect): [Side, Side] {
  const dx = to.x + to.width / 2 - (from.x + from.width / 2)
  const dy = to.y + to.height / 2 - (from.y + from.height / 2)
  if (Math.abs(dx) * 0.75 >= Math.abs(dy))
    return dx >= 0 ? ['r', 'l'] : ['l', 'r']
  return dy >= 0 ? ['b', 't'] : ['t', 'b']
}

// MARK: Entry point

const round = (value: number) => Math.round(value)

export function layoutComposition(input: LayoutInput): LayoutResult {
  const boxes = input.sections.map(section =>
    layoutFrame(section, input.layout)
  )
  const autoLinks: AutoLink[] = []
  let heading: Placed | null = null
  let frames: Positioned[]

  if (input.layout === 'mindmap') {
    const mindmap = inMindmap(boxes)
    frames = mindmap.frames
    // Always drawn: the spokes need a hub. The caller names it (the board title when the
    // agent gave no heading).
    heading = { ref: 'heading', parentRef: null, ...mindmap.centre }
    for (const frame of frames) {
      const [fromHandle, toHandle] = pickHandles(heading, frame)
      autoLinks.push({ from: heading.ref, to: frame.ref, fromHandle, toHandle })
    }
  } else {
    frames =
      input.layout === 'grid'
        ? inGrid(boxes)
        : inRow(boxes, input.layout === 'timeline' ? TIMELINE_GAP : FRAME_GAP)
    if (input.layout === 'timeline')
      for (let index = 1; index < frames.length; index += 1)
        autoLinks.push({
          from: frames[index - 1].ref,
          to: frames[index].ref,
          fromHandle: 'r',
          toHandle: 'l',
        })

    if (input.heading !== null) {
      const span = Math.max(0, ...frames.map(frame => frame.x + frame.width))
      const width = Math.max(320, Math.min(span, 640))
      heading = {
        ref: 'heading',
        parentRef: null,
        x: (span - width) / 2,
        y: 0,
        width,
        height: HEADING_HEIGHT,
      }
      frames = frames.map(frame => ({
        ...frame,
        y: frame.y + HEADING_HEIGHT + HEADING_GAP,
      }))
    }
  }

  // Shift so the composition's top-left corner is `origin`.
  const all: Rect[] = [...frames, ...(heading ? [heading] : [])]
  const minX = Math.min(0, ...all.map(rect => rect.x))
  const minY = Math.min(0, ...all.map(rect => rect.y))
  const dx = input.origin.x - minX
  const dy = input.origin.y - minY
  const moved = <T extends Rect>(rect: T): T => ({
    ...rect,
    x: round(rect.x + dx),
    y: round(rect.y + dy),
  })

  const placedFrames = frames.map(frame => {
    const { cards: _cards, ...rect } = moved(frame)
    return { ...rect, parentRef: null } as Placed
  })
  const placedHeading = heading ? moved(heading) : null
  const everything: Rect[] = [
    ...placedFrames,
    ...(placedHeading ? [placedHeading] : []),
  ]
  const right = Math.max(input.origin.x, ...everything.map(r => r.x + r.width))
  const bottom = Math.max(
    input.origin.y,
    ...everything.map(r => r.y + r.height)
  )

  return {
    heading: placedHeading,
    frames: placedFrames,
    // Relative to their frame, so the shift above does not apply.
    cards: frames.flatMap(frame => frame.cards),
    autoLinks,
    bounds: {
      x: input.origin.x,
      y: input.origin.y,
      width: right - input.origin.x,
      height: bottom - input.origin.y,
    },
  }
}
