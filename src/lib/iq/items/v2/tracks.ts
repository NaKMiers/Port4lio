import { ALL_SHAPE_KINDS, POLYGON_SIDES, type Shading, type ShapeKind } from '@/lib/iq/items/primitives'
import type { RungProfile } from '@/lib/iq/items/v2/ladder'
import type { LayoutSpec } from '@/lib/iq/items/v2/layout'
import {
  ANCHORS,
  CORNERS,
  MAX_TALLY,
  PERIMETER,
  SIZE_STEPS,
  type Anchor,
  type Cell,
  type CornerAnchor,
  type ShapeBody,
  type Slot,
} from '@/lib/iq/items/v2/cell'

/**
 * One varying dimension, as data.
 *
 * ## Why an abstraction instead of ten hand-written rules
 *
 * v1 had six rules, each a bespoke `build` function with its own hardcoded parameter
 * choices, and every one of them was broken in the same way: the parameters that actually
 * shipped were not the intended space but the subset whose distractor arithmetic happened
 * not to collide. Measured, that meant `shape-progression` had 3 distinct items in its entire
 * universe, `count-series` had 5, and 13 of `rotation`'s 20 parameter pairs were dead.
 *
 * The failure was structural, so the fix has to be. A track is a dimension, a target, an
 * axis, a step and a phase. `enumerate` computes the legal combinations ONCE at module load,
 * filtered by validity predicates that are stated rather than implied, and rules sample from
 * that table uniformly. Two consequences:
 *
 * 1. Variety becomes a statically assertable number - `enumerate(...).length` - rather than
 *    something you discover by sweeping seeds and counting.
 * 2. Most families collapse into configuration. "Shading cycles across columns" and "the
 *    shape steps down rows" are the same code with a different `dim`, which is why v1's
 *    `shape-progression` was really `shading-cycle` wearing a hat.
 *
 * `valueAt` is the single source of truth for what a track predicts. `build` uses it to make
 * the cells, the distractor generator uses it to make near-misses, and `verify` uses it to
 * check the answer - so none of the three can drift from the others.
 */

export type DimId = 'shading' | 'kind' | 'sides' | 'rotation' | 'size' | 'anchor' | 'count'

/** Which slot a track drives. */
export type Target = Extract<Slot, 'frame' | 'inner' | 'mark' | 'tally'>

export type Track = {
  dim: DimId
  target: Target
  /**
   * Which grid direction the dimension advances along.
   *
   * A sequence is one row, so its travel direction is `col`. That is what lets a
   * column-driven track work unchanged in a matrix and in a sequence.
   */
  axis: 'col' | 'row'
  /** Signed. Negative and non-unit steps are what `stepStyle: 'oblique'` unlocks. */
  step: number
  /** Starting offset. Non-zero means the obvious first guess is wrong. */
  phase: number
}

/** The ordered value sets each dimension steps through. */
const SHADINGS: readonly Shading[] = ['outline', 'half', 'filled']

/**
 * Shapes ordered by side count, so stepping is an ORDINAL progression.
 *
 * The distinction matters more than it looks. v1's shape rule stepped an unordered mixture
 * of polygons and stars, which has no "next" element - so on a three-cell sequence there is
 * nothing for a solver to extend and the item has no determined answer. 3, 4, 5, 6, 7 sides
 * does have a next element, which is why this is the only shape dimension allowed in a
 * sequence.
 */
const SIDE_LADDER: readonly ShapeKind[] = ['triangle', 'square', 'pentagon', 'hexagon', 'heptagon']

/** Cyclic shape set, for matrix layouts where two axes pin the reading. */
const KIND_RING: readonly ShapeKind[] = ALL_SHAPE_KINDS

const DIM_SIZES: Record<DimId, number> = {
  shading: SHADINGS.length,
  kind: KIND_RING.length,
  sides: SIDE_LADDER.length,
  rotation: 12,
  size: SIZE_STEPS.length,
  anchor: PERIMETER.length,
  count: MAX_TALLY,
}

/** Dimensions whose values wrap. A cyclic dimension alone cannot determine a sequence. */
export const CYCLIC: ReadonlySet<DimId> = new Set<DimId>(['shading', 'kind', 'anchor'])

/** Dimensions with a signed direction a solver can extend. */
export const ORDINAL: ReadonlySet<DimId> = new Set<DimId>(['sides', 'rotation', 'size', 'count'])

/**
 * The raw value a track takes at a grid position.
 *
 * Unwrapped on purpose - callers reduce into the dimension's value set. Keeping the integer
 * un-normalised is what lets `verify` check "did this track actually take two distinct
 * values across the given cells", which is the generic form of v1's degenerate
 * `square at 90 degrees` items where all nine cells rendered identically.
 */
export function valueAt(track: Track, row: number, col: number): number {
  const index = track.axis === 'col' ? col : row
  return track.phase + track.step * index
}

function wrap(value: number, size: number): number {
  return ((value % size) + size) % size
}

/** Clamp for the ordinal dimensions, whose ends are real ends rather than a wrap point. */
function clamp(value: number, size: number): number {
  return Math.max(0, Math.min(size - 1, value))
}

/**
 * Apply a track's value at one grid position to a cell.
 *
 * Returns a new cell; rules build by folding tracks over a base. The target slot must
 * already exist - a track drives an element, it does not create one, so composition depth is
 * decided once by the rule rather than emerging from whichever tracks happen to be active.
 */
export function applyTrack(cell: Cell, track: Track, row: number, col: number): Cell {
  const raw = valueAt(track, row, col)
  const next: Cell = { ...cell }

  if (track.dim === 'count') {
    const tally = next.tally
    if (!tally) return next
    next.tally = { ...tally, count: clamp(tally.count - 1 + raw, MAX_TALLY) + 1 }
    return next
  }

  if (track.dim === 'anchor') {
    const element = next[track.target]
    if (!element || (element.class !== 'inner' && element.class !== 'mark')) return next
    if (element.class === 'mark') {
      const from = Math.max(0, CORNERS.indexOf(element.anchor as CornerAnchor))
      next.mark = { ...element, anchor: CORNERS[wrap(from + raw, CORNERS.length)] as CornerAnchor }
    } else {
      const from = Math.max(0, PERIMETER.indexOf(element.anchor))
      next.inner = { ...element, anchor: PERIMETER[wrap(from + raw, PERIMETER.length)] as Anchor }
    }
    return next
  }

  // The three shape-bearing slots, handled one at a time rather than through an indexed
  // write. A single `next[target] = ...` cannot be expressed soundly - the slot type is a
  // union and the value would have to be cast, which is exactly the sort of cast that lets a
  // `tally` end up in the `inner` slot and renders as nothing.
  const current = next[track.target]
  if (!current || current.class === 'tally') return next
  const patch = shapePatch(track.dim, raw, current)
  switch (track.target) {
    case 'frame':
      if (next.frame) next.frame = { ...next.frame, ...patch }
      return next
    case 'inner':
      if (next.inner) next.inner = { ...next.inner, ...patch }
      return next
    case 'mark':
      if (next.mark) next.mark = { ...next.mark, ...patch }
      return next
    default:
      // `tally` has no shape body; only the `count` and `anchor` dims above touch it.
      return next
  }
}

/**
 * The one field of a shape body a dimension changes, and its new value.
 *
 * ## The track value is an OFFSET from the base, never an absolute index
 *
 * This is the single most important line of reasoning in the file, because getting it wrong
 * reproduces v1's defining bug exactly - and the first version of v2 did.
 *
 * With absolute indexing, the answer's value is `KIND_RING[phase + step * holeCol]`, which
 * for a `plain` rung (phase 0, step 1) on a 3x3 grid is `KIND_RING[2]` - the same shape for
 * every seed, forever. Measured over 60 seeds it produced answers that were 60% triangle,
 * 69% one shading, and 51% one size, which is v1's "the answer is always a triangle" with
 * different arithmetic behind it.
 *
 * Offsetting from the randomly-drawn base makes the answer depend on the seed as well as the
 * position, which is what variety actually requires. The step and phase still determine the
 * RELATIONSHIP between cells - which is the thing a solver has to find - so nothing about the
 * puzzle gets easier.
 */
function shapePatch(dim: DimId, raw: number, from: ShapeBody): Partial<ShapeBody> {
  switch (dim) {
    case 'shading': {
      const at = Math.max(0, SHADINGS.indexOf(from.shading))
      return { shading: SHADINGS[wrap(at + raw, SHADINGS.length)] as Shading }
    }
    case 'kind': {
      const at = Math.max(0, KIND_RING.indexOf(from.kind))
      return { kind: KIND_RING[wrap(at + raw, KIND_RING.length)] as ShapeKind }
    }
    case 'sides': {
      // The base is normalised into the side ladder by `buildTracked` before this runs, so
      // `indexOf` is a real position rather than a fallback to zero.
      const at = Math.max(0, SIDE_LADDER.indexOf(from.kind))
      return { kind: SIDE_LADDER[clamp(at + raw, SIDE_LADDER.length)] as ShapeKind }
    }
    case 'rotation':
      // Multiples of 15 degrees. Below that, two steps are inside the perceptual floor and
      // the item asks the taker to see a difference that is not there.
      return { rotationDeg: from.rotationDeg + raw * 15 }
    default:
      return { sizeStep: clamp(from.sizeStep + raw, SIZE_STEPS.length) }
  }
}

/** Shapes a `sides` track can step through, exported so the base can be normalised into it. */
export const SIDE_LADDER_KINDS: readonly ShapeKind[] = SIDE_LADDER

/** The perimeter ring an `anchor` track walks, exported for the same reason. */
export const PERIMETER_ANCHORS: readonly Anchor[] = PERIMETER

/**
 * Every legal track for a dimension, target and layout - computed once, sampled uniformly.
 *
 * This function is the fix for the whole class of bug described in the header, so its filters
 * are the interesting part:
 *
 * - **The step must move.** `step === 0` is a dimension that does not vary, which is a decoy,
 *   not a track.
 * - **The whole value set must not be overshot.** A rotation stepping 8 units of 15 degrees
 *   per column travels 120 degrees a cell; over three columns that is a full turn and the
 *   third cell can render identically to the first. Capping the total travel is what keeps
 *   the progression readable as a progression.
 * - **Ordinal dimensions must not run off their end.** `sides` and `size` clamp rather than
 *   wrap, so a step that pushes past the last entry produces two identical cells - v1's
 *   `size-scale` did exactly this, which is why its shrinking variant never shipped.
 * - **`plain` is a filter on the same table, not a different table.** This is what stops a
 *   family having an easy variant that exists only by accident.
 */
export function enumerate(
  dim: DimId,
  target: Target,
  layout: LayoutSpec,
  stepStyle: RungProfile['stepStyle']
): Track[] {
  const size = DIM_SIZES[dim]
  const span = layout.id === '1x3-sequence' ? layout.cols - 1 : Math.max(layout.cols, layout.rows) - 1
  const axes: Track['axis'][] = layout.rows > 1 ? ['col', 'row'] : ['col']
  const out: Track[] = []

  for (const axis of axes) {
    const reach = axis === 'col' ? layout.cols - 1 : layout.rows - 1
    for (let step = -4; step <= 4; step += 1) {
      if (step === 0) continue
      if (stepStyle === 'plain' && (step < 0 || Math.abs(step) > 1)) continue

      // Total travel across the axis must stay inside the value set, so the last cell is
      // never a repeat of the first.
      if (Math.abs(step) * reach >= size) continue

      for (let phase = 0; phase < size; phase += 1) {
        if (stepStyle === 'plain' && phase !== 0) continue

        // Ordinal dimensions clamp at their ends: a phase plus travel that leaves the set
        // produces duplicate cells rather than a progression.
        if (ORDINAL.has(dim)) {
          const lo = Math.min(phase, phase + step * reach)
          const hi = Math.max(phase, phase + step * reach)
          if (lo < 0 || hi > size - 1) continue
        }

        out.push({ dim, target, axis, step, phase })
      }
    }
  }

  void span
  return out
}

/**
 * Whether a track visibly varies across the cells a taker can actually see.
 *
 * The generic form of v1's worst degeneracy. `rotation` there could pick a square with a
 * 90-degree step, and because a square repeats every 90 degrees all nine cells rendered
 * identically - a perfectly "valid" item with nothing in it to notice. Two distinct values
 * is the minimum for a dimension to be discoverable at all; a cyclic dimension in a matrix
 * needs three, because two points on a cycle do not reveal its direction.
 */
/**
 * The value a track drives, read back off a built cell.
 *
 * Needed because witnessing has to be judged on the CELLS, not on the track arithmetic.
 * Since a track value is an offset from the base and the ordinal dimensions clamp at their
 * ends, whether a track actually varies depends on where its base happens to sit: offsets
 * 0, 1, 2 applied to a base already at the top of the size table all clamp to the same
 * value, and three identical cells is an item with nothing in it to notice.
 *
 * An abstract check on the offsets cannot see that. Reading the cells can.
 */
export function drivenValue(cell: Cell, track: Track): string {
  if (track.dim === 'count') return String(cell.tally?.count ?? -1)

  const element = cell[track.target]
  if (!element) return 'none'
  if (element.class === 'tally') return String(element.count)

  switch (track.dim) {
    case 'shading':
      return element.shading
    case 'kind':
    case 'sides':
      return element.kind
    case 'rotation':
      return String(element.rotationDeg)
    case 'size':
      return String(element.sizeStep)
    default:
      return element.class === 'frame' ? 'center' : element.anchor
  }
}

/**
 * Whether a track visibly varies across the cells a taker can actually see.
 *
 * The generic form of v1's worst degeneracy. `rotation` there could pick a square with a
 * 90-degree step, and because a square repeats every 90 degrees all nine cells rendered
 * identically - a perfectly "valid" item with nothing in it to notice. Two distinct values
 * is the minimum for a dimension to be discoverable at all; a cyclic dimension in a matrix
 * needs three, because two points on a cycle do not reveal its direction.
 */
export function trackIsWitnessed(
  track: Track,
  layout: LayoutSpec,
  cells: readonly (Cell | null)[]
): boolean {
  const seen = new Set<string>()
  for (const cell of cells) {
    if (cell) seen.add(drivenValue(cell, track))
  }

  /**
   * Three samples for a cyclic dimension, but only where the layout HAS three.
   *
   * Two points on a cycle do not reveal its direction, so three is the honest requirement.
   * Demanding it unconditionally was a bug though: a 2x2 has two positions along each axis,
   * so a cyclic track can never show three values there and every cyclic family was silently
   * unbuildable on that layout - which presented as "no family could fill rung 6" rather than
   * as anything to do with cycles.
   *
   * Where three genuinely cannot be sampled, two is all the evidence that exists. The reading
   * is then pinned by the ordinal-track requirement instead, which `verify.ts` applies to
   * every layout that confirms the rule fewer than twice.
   */
  const longestAxis = Math.max(layout.cols, layout.rows)
  const needed = CYCLIC.has(track.dim) && longestAxis >= 3 ? 3 : 2
  return seen.size >= needed
}
