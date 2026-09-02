import {
  CELL,
  INK,
  POLYGON_SIDES,
  polygonPoints,
  starPoints,
  STAR_POINTS,
  STROKE_WIDTH,
  SYMMETRY,
  type Shading,
  type ShapeKind,
} from '@/lib/iq/items/primitives'

/**
 * What a v2 cell is, and how two cells are told apart.
 *
 * ```
 *   Cell ──cellDraws()──▶ SlottedDraw[] ──┬── drawSvg()         → what the taker sees
 *                                         └── drawFingerprint() → what verify trusts
 * ```
 *
 * ## A slotted record, not a list of layers
 *
 * v1 gave each cell exactly one element, so composites - a frame with something inside it, a
 * lattice carrying dots, a frame plus a tally plus a corner marker - were unrepresentable.
 * The obvious replacement is a list of layers. This is not that, and the reason is
 * correctness rather than taste.
 *
 * A list has an order. That order is meaningful in the type and meaningless in the picture,
 * so it has to be canonicalised before keying AND chosen before rendering - two decisions in
 * two files, free to drift. Worse, a list makes "two frames" representable, which renders as
 * a smudge and type-checks fine.
 *
 * At most one element per named slot, with paint order fixed by `SLOT_ORDER`, removes both
 * problems: every picture this model can express has exactly one encoding, so there is no
 * order to canonicalise and nothing to get wrong. The element classes are a closed set
 * because the reference vocabulary is a closed set - frame, field, tally, inner, mark is all
 * of it. If a rule ever needs two independent inner shapes, add a slot; do not open a slot
 * to a list.
 *
 * The empty cell is `{}`. A plain centred shape - every v1 item - is `{ inner }`.
 *
 * ## Placement and size are enumerated, never floats
 *
 * This is the single most load-bearing decision in the file. `cellKey` decides whether two
 * options are the same picture, and a float that drifts by 1e-15 makes one picture look like
 * two - which ships an item with two correct answers, one marked wrong.
 *
 * v1 gets away with floats only because `size-scale` puts one element in the cell and wraps
 * every value in `toFixed(2)`. With three elements per cell that discipline would have to
 * hold in every rule and every distractor builder, and the cost of a single miss is a taker
 * penalised for being right. An integer index into a table cannot drift. A future
 * `scale: number` on an element would be a correctness regression that type-checks, which is
 * why the tables below are closed sets rather than validated ranges.
 */

/** Where an element sits. Enumerated - see the note above about floats. */
export type Anchor = 'center' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw'
export type CornerAnchor = Extract<Anchor, 'ne' | 'se' | 'sw' | 'nw'>

export const ANCHORS: readonly Anchor[] = [
  'center',
  'n',
  'ne',
  'e',
  'se',
  's',
  'sw',
  'w',
  'nw',
]

/**
 * The perimeter, in travel order, for rules that move an element around the cell.
 *
 * Eight positions excluding the centre, so a translation rule has a cycle to step through.
 * Order is geometric (clockwise from north), not the declaration order above, because a
 * solver reads it as movement - a "step" that teleported across the cell would not be
 * discoverable as a step.
 */
export const PERIMETER: readonly Anchor[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']

export const CORNERS: readonly CornerAnchor[] = ['ne', 'se', 'sw', 'nw']

/**
 * Anchor geometry, in cell units. The only source of truth for placement.
 *
 * Off-centre anchors sit 26 units from the middle, which is far enough that two different
 * anchors can never be confused for one another at any size the tables below allow.
 */
export const ANCHOR_POINTS: Record<Anchor, readonly [number, number]> = {
  center: [50, 50],
  n: [50, 24],
  ne: [76, 24],
  e: [76, 50],
  se: [76, 76],
  s: [50, 76],
  sw: [24, 76],
  w: [24, 50],
  nw: [24, 24],
}

/**
 * Radii, as a fraction of half the cell. A cell stores the INDEX, never the value.
 *
 * Steps are 0.06 apart, matching the spacing v1's size ladder found legible. Note that one
 * step apart is NOT perceptually distinct - `perceptuallyDistinct` below requires two - so a
 * rule wanting visibly different sizes must move by at least two entries.
 */
export const SIZE_STEPS: readonly number[] = [
  0.16, 0.22, 0.28, 0.34, 0.4, 0.46, 0.52, 0.58, 0.64, 0.7, 0.76, 0.82, 0.88, 0.94,
]

/**
 * The most strokes a tally may hold.
 *
 * Same argument as v1's `MAX_BARS`, which this replaces: counting is meant to be the easy
 * half of a counting item, and past about seven near-identical strokes the work becomes
 * tallying rather than reasoning - which measures patience.
 */
export const MAX_TALLY = 7

/** What every drawn shape carries, factored so the fingerprint has one shape case. */
export type ShapeBody = {
  kind: ShapeKind
  shading: Shading
  /** Whole degrees. Integer on purpose - a non-integer re-opens the float hole. */
  rotationDeg: number
  /** Index into `SIZE_STEPS`. */
  sizeStep: number
}

/** A closed outline other elements sit inside. Always cell-centred, hence no anchor. */
export type FrameElement = { class: 'frame' } & ShapeBody

/** The element rules usually transform: one shape, anywhere on the anchor grid. */
export type InnerElement = { class: 'inner'; anchor: Anchor } & ShapeBody

/** A small second dimension, corner-only, so it never competes with `inner` for space. */
export type MarkElement = { class: 'mark'; anchor: CornerAnchor } & ShapeBody

/** An n-by-n lattice of dots, some filled. The counting and set-logic medium. */
export type FieldElement = {
  class: 'field'
  size: number
  /** Lattice indices, row-major. Order is not significant; the key sorts. */
  filled: readonly number[]
}

/** N strokes. The addition/subtraction medium. */
export type TallyElement = {
  class: 'tally'
  count: number
  anchor: Anchor
}

export type Element =
  | FrameElement
  | InnerElement
  | MarkElement
  | FieldElement
  | TallyElement

export type Cell = {
  frame?: FrameElement
  field?: FieldElement
  tally?: TallyElement
  inner?: InnerElement
  mark?: MarkElement
}

/** Paint order, back to front. Fixed here, never taken from construction order. */
export const SLOT_ORDER = ['frame', 'field', 'tally', 'inner', 'mark'] as const
export type Slot = (typeof SLOT_ORDER)[number]

/**
 * One primitive resolved to where it actually lands in the 100x100 cell box.
 *
 * Elements expand into these: a `field` becomes one `dot` per lattice slot, a `tally`
 * becomes N `stroke`s. The expansion is what makes the occlusion check exact - a filled
 * shape covering three dots of a lattice is visible at this level and invisible at the
 * element level.
 */
export type Draw =
  | {
      form: 'shape'
      kind: ShapeKind
      shading: Shading
      rotationDeg: number
      cx: number
      cy: number
      r: number
    }
  | { form: 'dot'; cx: number; cy: number; r: number; filled: boolean }
  | { form: 'stroke'; cx: number; cy: number; w: number; h: number }

/** A draw plus the slot it came from. The slot is for pairing, never for keying. */
export type SlottedDraw = { slot: Slot; draw: Draw }

/**
 * How much bleed past the cell edge is tolerated.
 *
 * Not zero, because a shape sitting exactly on an anchor reads better with its outline
 * touching the edge than floating inside it. Well under the 12-unit gap between cells, so a
 * shape can never reach its neighbour.
 */
const EDGE_BLEED = 2

/**
 * The largest radius an anchor can hold without spilling into the next cell.
 *
 * SVG does not clip by default, so nothing fails when a shape overflows - it simply paints
 * across its neighbours and over the `?` placeholder. v1 shipped exactly that bug in
 * `barStripSvg` for months, invisible in code and obvious on screen.
 */
function maxRadiusAt(cx: number, cy: number): number {
  return Math.min(cx, cy, CELL - cx, CELL - cy) + EDGE_BLEED
}

/**
 * Radius for a size step at a position, clamped to the space actually available.
 *
 * Clamping rather than rejecting, and it is safe for one specific reason: this is the only
 * path to a radius, and it feeds BOTH `drawSvg` and `drawFingerprint`. So two cells whose
 * radii clamp to the same value also key the same, and the "renders alike, keys differently"
 * failure - the one that ships two right answers - cannot arise from it.
 *
 * The residual risk is the opposite and much cheaper: a size rule running at a corner anchor
 * can clamp two of its steps onto one radius, producing a cell that did not change. That is
 * a degenerate item, not an unfair one, and it is caught downstream - the clamped cells key
 * identically, so the option panel collides and verification rejects the item.
 */
function radiusOf(sizeStep: number, cx: number, cy: number): number {
  const fraction = SIZE_STEPS[sizeStep] ?? SIZE_STEPS[SIZE_STEPS.length - 1] ?? 0.78
  return Math.min((CELL / 2) * fraction, maxRadiusAt(cx, cy))
}

function shapeDraw(body: ShapeBody, anchor: Anchor): Draw {
  const [cx, cy] = ANCHOR_POINTS[anchor]
  return {
    form: 'shape',
    kind: body.kind,
    shading: body.shading,
    rotationDeg: body.rotationDeg,
    cx,
    cy,
    r: radiusOf(body.sizeStep, cx, cy),
  }
}

/** Lattice geometry, matching v1's `dotGridSvg` so the two versions look like one product. */
function fieldDraws(element: FieldElement): Draw[] {
  const gap = CELL / (element.size + 1)
  const r = Math.min(gap * 0.3, 7)
  const on = new Set(element.filled)
  const out: Draw[] = []
  for (let row = 0; row < element.size; row += 1) {
    for (let col = 0; col < element.size; col += 1) {
      out.push({
        form: 'dot',
        cx: gap * (col + 1),
        cy: gap * (row + 1),
        r,
        filled: on.has(row * element.size + col),
      })
    }
  }
  return out
}

/**
 * Strokes in a fixed-width band, so the count is the only signal.
 *
 * The span does not grow with the count, for the reason v1's `barStripSvg` records: if it
 * did, a wider block would BE the answer and nobody would have to count. Bars thin out
 * instead, and are clamped so two strokes do not render as slabs.
 */
const TALLY_SPAN = 44
const TALLY_HEIGHT = 26

function tallyDraws(element: TallyElement): Draw[] {
  const [ax, ay] = ANCHOR_POINTS[element.anchor]
  const slot = TALLY_SPAN / element.count
  const w = Math.max(2.5, Math.min(8, slot * 0.55))
  const drawn = (element.count - 1) * slot + w
  const startX = ax - drawn / 2
  return Array.from({ length: element.count }, (_, i) => ({
    form: 'stroke' as const,
    cx: startX + i * slot + w / 2,
    cy: ay,
    w,
    h: TALLY_HEIGHT,
  }))
}

/**
 * Every draw a cell produces, in paint order, tagged with its slot.
 *
 * The ONLY place cell geometry is computed. If the renderer did its own arithmetic, "keys
 * the same if and only if renders the same" would be a promise maintained by hand in two
 * files; routed through here it is a property of the code.
 */
export function cellDraws(cell: Cell): SlottedDraw[] {
  const out: SlottedDraw[] = []
  for (const slot of SLOT_ORDER) {
    const element = cell[slot]
    if (!element) continue
    switch (element.class) {
      case 'frame':
        out.push({ slot, draw: shapeDraw(element, 'center') })
        break
      case 'field':
        for (const draw of fieldDraws(element)) out.push({ slot, draw })
        break
      case 'tally':
        for (const draw of tallyDraws(element)) out.push({ slot, draw })
        break
      default:
        out.push({ slot, draw: shapeDraw(element, element.anchor) })
    }
  }
  return out
}

// ---------------------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------------------

function fillFor(shading: Shading): string {
  return shading === 'filled' ? INK : 'none'
}

function pointsFor(kind: ShapeKind, r: number, rotationDeg: number, cx: number, cy: number): string {
  const stars = STAR_POINTS[kind as 'star4' | 'star5' | 'star6']
  if (stars) return starPoints(stars, r, rotationDeg, cx, cy)
  const sides = POLYGON_SIDES[kind]
  if (sides) return polygonPoints(sides, r, rotationDeg, cx, cy)
  // `diamond` is a 4-gon whose name carries the intent rather than the geometry.
  return polygonPoints(4, r, rotationDeg, cx, cy)
}

/**
 * One draw as SVG children.
 *
 * Geometry is passed down into the primitives rather than applied as a wrapping
 * `<g transform="scale()">`, and that is deliberate: a scaling transform also scales
 * `stroke-width`, so a small inner shape would render as a hairline and disappear entirely
 * at certificate raster sizes. `vector-effect="non-scaling-stroke"` would fix it in a
 * browser and is ignored by Satori, which renders the certificate card. Absolute strokes
 * everywhere is the only option that works in both.
 *
 * `uid` namespaces the clip path. It must be unique per DRAW, not per cell: one composite
 * can hold three half-shaded shapes, and duplicate ids inside one SVG document silently
 * cross-clip - which looks like a rendering glitch and is actually a wrong answer on screen.
 */
export function drawSvg(draw: Draw, uid: string): string {
  if (draw.form === 'dot') {
    return `<circle cx="${draw.cx.toFixed(2)}" cy="${draw.cy.toFixed(2)}" r="${draw.r.toFixed(2)}" fill="${draw.filled ? INK : 'none'}" stroke="${INK}" stroke-width="1.5"/>`
  }

  if (draw.form === 'stroke') {
    return `<rect x="${(draw.cx - draw.w / 2).toFixed(2)}" y="${(draw.cy - draw.h / 2).toFixed(2)}" width="${draw.w.toFixed(2)}" height="${draw.h.toFixed(2)}" fill="${INK}"/>`
  }

  const stroke = `stroke="${INK}" stroke-width="${STROKE_WIDTH}" stroke-linejoin="round"`

  if (draw.kind === 'circle') {
    const body = `cx="${draw.cx.toFixed(2)}" cy="${draw.cy.toFixed(2)}" r="${draw.r.toFixed(2)}"`
    if (draw.shading !== 'half') {
      return `<circle ${body} fill="${fillFor(draw.shading)}" ${stroke}/>`
    }
    return `<clipPath id="h-${uid}"><rect x="0" y="${(draw.cy - draw.r).toFixed(2)}" width="${draw.cx.toFixed(2)}" height="${(draw.r * 2).toFixed(2)}"/></clipPath><circle ${body} fill="${INK}" clip-path="url(#h-${uid})"/><circle ${body} fill="none" ${stroke}/>`
  }

  const points = pointsFor(draw.kind, draw.r, draw.rotationDeg, draw.cx, draw.cy)
  if (draw.shading !== 'half') {
    return `<polygon points="${points}" fill="${fillFor(draw.shading)}" ${stroke}/>`
  }
  return `<clipPath id="h-${uid}"><rect x="0" y="${(draw.cy - draw.r).toFixed(2)}" width="${draw.cx.toFixed(2)}" height="${(draw.r * 2).toFixed(2)}"/></clipPath><polygon points="${points}" fill="${INK}" clip-path="url(#h-${uid})"/><polygon points="${points}" fill="none" ${stroke}/>`
}

/** A whole cell as SVG children, paint-ordered, with per-draw clip-path ids. */
export function cellSvg(cell: Cell, uid: string): string {
  return cellDraws(cell)
    .map(({ draw }, index) => drawSvg(draw, `${uid}-${index}`))
    .join('')
}

// ---------------------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------------------

/**
 * Quantisation grid for coordinates entering the key.
 *
 * `Math.round`, not `toFixed`: `(-0.0001).toFixed(2)` is the string `"-0.00"`, which keys
 * differently from `"0.00"` for a difference no eye can see. Adding zero collapses `-0`.
 */
function q(value: number): number {
  return Math.round(value * 4) + 0
}

/**
 * Rotation reduced by the shape's symmetry, then bucketed.
 *
 * The reduction is the correctness part: a square at 0 and at 90 are one picture. The
 * bucketing handles two nuisances at once - `heptagon`'s period is 360/7, so reducing an
 * integer angle by it yields values that differ in the fifteenth decimal place; and angles a
 * degree apart are the same picture to a human. Five degrees is well below the fifteen that
 * `perceptuallyDistinct` demands, so anything this collapses was indistinguishable anyway.
 */
const ROTATION_BUCKET = 5

function rotationBucket(kind: ShapeKind, rotationDeg: number): number {
  const period = SYMMETRY[kind]
  const reduced = ((rotationDeg % period) + period) % period
  const buckets = Math.max(1, Math.round(period / ROTATION_BUCKET))
  return Math.round(reduced / ROTATION_BUCKET) % buckets
}

/**
 * Structural identity of one draw. Never contains a slot.
 *
 * A square drawn in the `frame` slot and the same square drawn centred in the `inner` slot
 * at the same size are ONE picture. A key that told them apart would let a rule offer both
 * as options.
 */
function drawFingerprint(draw: Draw): string {
  switch (draw.form) {
    case 'shape':
      return `s:${draw.kind}:${draw.shading}:${rotationBucket(draw.kind, draw.rotationDeg)}:${q(draw.cx)}:${q(draw.cy)}:${q(draw.r)}`
    case 'dot':
      return `d:${draw.filled ? 1 : 0}:${q(draw.cx)}:${q(draw.cy)}:${q(draw.r)}`
    default:
      return `k:${q(draw.cx)}:${q(draw.cy)}:${q(draw.w)}:${q(draw.h)}`
  }
}

/**
 * The one key. Used by distractor de-duplication, by verification, and by the tests.
 *
 * v1 had two - a fine `cellKey` used when building distractors and a coarser `identity` used
 * when gating them - so rules de-duplicated on a different key from the one that decided
 * whether an item could ship. It was sound only by the accident that one implied the other.
 *
 * ## The key must be a COARSENING
 *
 * Verification rejects on collision, so the two error directions are wildly asymmetric:
 *
 * ```
 *   renders same, keys differently ──▶ verify passes ──▶ TWO RIGHT ANSWERS SHIP
 *   renders differently, keys same ──▶ verify rejects ──▶ wasted retry, harmless
 * ```
 *
 * Every doubt therefore resolves toward collapsing. The instinct when writing a key is to
 * add fields for safety; here that is precisely backwards.
 *
 * Sorted and de-duplicated: sorted because slot order is a paint decision that
 * `noHiddenLayers` makes visually irrelevant, and de-duplicated because two elements
 * resolved to the same place paint the same ink twice and a human sees one of them.
 */
export function cellKey(cell: Cell): string {
  const prints = cellDraws(cell).map(({ draw }) => drawFingerprint(draw))
  return Array.from(new Set(prints)).sort().join('|')
}

/** Solid ink, i.e. something that hides whatever is behind it. */
function paintsSolid(draw: Draw): boolean {
  if (draw.form === 'stroke') return true
  if (draw.form === 'dot') return draw.filled
  // `half` counts as solid: it covers half its own box, and half of a hidden element is
  // still a hidden element.
  return draw.shading !== 'outline'
}

type Box = { x0: number; y0: number; x1: number; y1: number }

function boxOfDraw(draw: Draw): Box {
  if (draw.form === 'stroke') {
    return {
      x0: draw.cx - draw.w / 2,
      y0: draw.cy - draw.h / 2,
      x1: draw.cx + draw.w / 2,
      y1: draw.cy + draw.h / 2,
    }
  }
  // The circumscribed circle's box for a rotated polygon. Conservative in the safe
  // direction: it over-estimates coverage, so borderline cells are rejected rather than
  // shipped.
  return { x0: draw.cx - draw.r, y0: draw.cy - draw.r, x1: draw.cx + draw.r, y1: draw.cy + draw.r }
}

function contains(outer: Box, inner: Box): boolean {
  return (
    outer.x0 <= inner.x0 && outer.y0 <= inner.y0 && outer.x1 >= inner.x1 && outer.y1 >= inner.y1
  )
}

/**
 * Whether a cell's PICTURE determines its data.
 *
 * A filled frame paints over whatever sits inside it, so `{frame: filled square, inner:
 * circle}` and `{frame: filled square, inner: star}` are one picture and two keys - and
 * verification would cheerfully offer both as options, marking one wrong.
 *
 * Rather than teach `cellKey` to reason about coverage, forbid the cells where coverage is
 * possible. Nothing is lost: a frame with contents is always an outline, because that is the
 * only way the contents are visible to a human either.
 *
 * Containment, not intersection - a filled inner shape inside an outline frame is
 * legitimate and common, and intersection would reject it.
 */
export function noHiddenLayers(cell: Cell): boolean {
  const draws = cellDraws(cell).map(({ draw }) => draw)
  return draws.every((over, i) => {
    if (!paintsSolid(over)) return true
    const overBox = boxOfDraw(over)
    return draws.every((under, j) => i === j || !contains(overBox, boxOfDraw(under)))
  })
}

/**
 * Distinctness floors, in the units each dimension is measured in.
 *
 * `cellKey` inequality is necessary but NOT sufficient for a fair option panel: two cells
 * one size step apart key differently and look identical, so a panel of six can be
 * structurally valid and visually a trick. These are the differences a human can actually
 * see at render size.
 */
const ROTATION_FLOOR_DEG = 15

/**
 * Two size steps, in cell units.
 *
 * Measured on the RESOLVED radius rather than the step index, which matters because
 * `radiusOf` clamps at off-centre anchors. Comparing indices there would report two steps of
 * difference for two shapes that clamped to the same radius and render identically - and
 * that is the unsafe direction, the one that puts two indistinguishable options on the panel.
 */
const RADIUS_FLOOR = 5.5

function shapesNoticeablyDiffer(a: ShapeBody, b: ShapeBody, anchorA: Anchor, anchorB: Anchor): boolean {
  if (a.kind !== b.kind || a.shading !== b.shading) return true

  const [ax, ay] = ANCHOR_POINTS[anchorA]
  const [bx, by] = ANCHOR_POINTS[anchorB]
  if (Math.abs(radiusOf(a.sizeStep, ax, ay) - radiusOf(b.sizeStep, bx, by)) >= RADIUS_FLOOR) {
    return true
  }

  // Circular distance under the shape's own symmetry: a square at 5 and at 95 degrees are
  // ten degrees apart, not ninety.
  const period = SYMMETRY[a.kind]
  const raw = Math.abs(a.rotationDeg - b.rotationDeg) % period
  return Math.min(raw, period - raw) >= ROTATION_FLOOR_DEG
}

/**
 * Whether two cells differ in a way a taker can see.
 *
 * Compared slot by slot rather than draw by draw, which is exact: both cells come from the
 * same rule with the same slots populated, so there is no pairing to guess at. Errs toward
 * "not distinct" wherever it is unsure, because that direction costs a retry while the other
 * ships an unfair item.
 */
export function perceptuallyDistinct(a: Cell, b: Cell): boolean {
  for (const slot of SLOT_ORDER) {
    const ea = a[slot]
    const eb = b[slot]
    if (!ea !== !eb) return true
    if (!ea || !eb) continue

    if (ea.class === 'field' && eb.class === 'field') {
      if (ea.size !== eb.size) return true
      // A single dot flipping is a visible change - dots are large and unambiguously on or
      // off - so set inequality is the right threshold here.
      const setA = new Set(ea.filled)
      const setB = new Set(eb.filled)
      if (setA.size !== setB.size) return true
      if (Array.from(setA).some(index => !setB.has(index))) return true
      continue
    }

    if (ea.class === 'tally' && eb.class === 'tally') {
      if (ea.count !== eb.count || ea.anchor !== eb.anchor) return true
      continue
    }

    if (ea.class === 'frame' || ea.class === 'inner' || ea.class === 'mark') {
      if (eb.class !== ea.class) return true
      // Anchors are 26 units apart, far beyond any confusion at these sizes.
      const anchorA: Anchor = ea.class === 'frame' ? 'center' : ea.anchor
      const anchorB: Anchor =
        eb.class === 'frame' ? 'center' : (eb as InnerElement | MarkElement).anchor
      if (anchorA !== anchorB) return true
      if (shapesNoticeablyDiffer(ea, eb as ShapeBody, anchorA, anchorB)) return true
    }
  }
  return false
}
