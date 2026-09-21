import { pick, shuffle } from '@/lib/iq/items/random'
import {
  ALL_SHAPE_KINDS,
  type Shading,
  type ShapeKind,
} from '@/lib/iq/items/primitives'
import {
  cellKey,
  MAX_TALLY,
  noHiddenLayers,
  perceptuallyDistinct,
  SIZE_STEPS,
  type Anchor,
  type Cell,
  type CornerAnchor,
} from '@/lib/iq/items/v2/cell'
import {
  canFill,
  type RuleCapabilities,
  type RungProfile,
} from '@/lib/iq/items/v2/ladder'
import {
  coordsOf,
  emptyGrid,
  holeCoords,
  positionCount,
  type CellGrid,
  type LayoutId,
} from '@/lib/iq/items/v2/layout'
import {
  applyTrack,
  CYCLIC,
  enumerate,
  ORDINAL,
  PERIMETER_ANCHORS,
  SIDE_LADDER_KINDS,
  trackIsWitnessed,
  type DimId,
  type Target,
  type Track,
} from '@/lib/iq/items/v2/tracks'

/**
 * The v2 rule vocabulary.
 *
 * ## Distractors are still the whole game
 *
 * v1's header said it and v1 did not deliver it: a wrong option must be wrong for a
 * STATABLE reason - the right rule applied with the wrong step, or the right step applied to
 * the wrong dimension. Random shapes make an item solvable by elimination without ever
 * finding the rule, which measures nothing.
 *
 * Here the reason is a value on the option (`ErrorModel`) rather than a convention in a
 * comment, so verification can assert that every panel offers both failure modes and that no
 * single model appears more than twice. Five off-by-ones is a panel that measures arithmetic
 * precision.
 *
 * ## Why families are configuration
 *
 * v1 had six bespoke `build` functions and three of them had catastrophically small output
 * spaces - 3 distinct items, 5 distinct items, one always-identical answer. The shapes of
 * those bugs were all the same: hardcoded parameters, and distractor pools computed from the
 * same arithmetic as the answer so that most parameter values silently failed verification
 * and were replaced by a retry with a different rule.
 *
 * Most of the vocabulary is one mechanism - advance a dimension along an axis - so it is
 * written once, in `tracks.ts`, with its legal parameters enumerated up front. A family is
 * then a primary dimension, a pool of secondaries, and a capability declaration. v1's
 * `shape-progression` was `shading-cycle` with `kind` as the primary all along, which is
 * exactly why it had three items in it.
 */

export type ErrorModel =
  /** The primary advanced one step too few or too many. */
  | 'off-by-one-step'
  /** The value from the last given cell: the "forgot to advance" instinct. */
  | 'not-advanced'
  /** Primary right, a secondary left at its previous value. */
  | 'secondary-frozen'
  /** The primary's step applied to a secondary's dimension. */
  | 'dimension-swap'
  /** The row rule read as the column rule. Grids only. */
  | 'axis-transpose'
  /** A constant decoy changed - did they notice it never varied? */
  | 'decoy-promoted'
  /**
   * A copy of one of the given cells: the "it looks like these" instinct.
   *
   * Load-bearing rather than filler. A low-cardinality primary - shading has three values -
   * can only produce two distinct off-by-one options, so a one-dimension item built from
   * primary shifts alone cannot fill a panel of six. That is precisely how v1's pools
   * collapsed, and echoing the grid's own cells is the fix: the options look native to the
   * item because they ARE native to it, and the error is statable as "you did not apply the
   * rule at all".
   */
  | 'operand-echo'

/** Wrong-step models. Every panel needs at least one. */
const STEP_ERRORS: ReadonlySet<ErrorModel> = new Set<ErrorModel>([
  'off-by-one-step',
  'not-advanced',
  'operand-echo',
])

/** Wrong-dimension models. Every panel needs at least one of these too. */
const DIMENSION_ERRORS: ReadonlySet<ErrorModel> = new Set<ErrorModel>([
  'secondary-frozen',
  'dimension-swap',
  'axis-transpose',
  'decoy-promoted',
])

export type Distractor = { cell: Cell; error: ErrorModel }

export type Built = {
  cells: CellGrid
  answer: Cell
  distractors: Distractor[]
  /**
   * How many dimensions this item actually varies, DECLARED rather than inferred.
   *
   * It used to be read off `tracks.length`, which only works while every family is
   * track-driven. `set-logic` is not: its varying dimension is a logical operator applied
   * across a lattice, which no amount of stepping-a-property can express. Counting its tracks
   * would report zero and verification would reject every one of its items.
   *
   * Set-logic declares 2. That is not a fudge to fit the ladder - inferring an operator means
   * holding both operands in mind and testing a hypothesis against them, which is genuinely
   * two things at once, and it is why the literature treats this family as the hardest.
   */
  dimensions: number
  /** The active tracks, carried so verification can measure what the rule actually varied. */
  tracks: Track[]
  /** Slots present but driven by nothing. Verification proves they really are constant. */
  decoySlots: Target[]
  /**
   * Whether the given rows must pin exactly one logical operator.
   *
   * Set by `set-logic` only. Left to `verify.ts` rather than checked inside the family,
   * because verification is meant to be the single thing standing between a broken item and a
   * taker - a family that validated its own precondition could get that wrong silently.
   */
  requiresUniqueOperator?: boolean
}

export type RuleSpec = {
  name: string
  capabilities: RuleCapabilities
  /** Returns null when this seed's parameter draw cannot make a legal item. */
  build: (random: () => number, profile: RungProfile) => Built | null
}

const SHADINGS: readonly Shading[] = ['outline', 'half', 'filled']

/**
 * The element classes present at a composition depth, for a family that needs `required`.
 *
 * Depth is the count of coexisting classes - difficulty axis (1). Reference items look far
 * more complicated than their rules are precisely because of this: most of what is in the
 * cell is not moving.
 *
 * The `required` slot comes FIRST, and that is a correctness fix rather than a cosmetic one.
 * A fixed ladder of `inner, frame, mark, tally` put the tally at depth 3, which meant a
 * counting family could only exist where four classes coexisted - three rungs in the whole
 * ladder, two of them adjacent. Since a family may not repeat inside four rungs, its quota of
 * three was arithmetically impossible and `planFamilies` correctly reported the ladder
 * unsatisfiable. Requiring four elements in order to count anything was the actual mistake.
 */
const SLOT_PRIORITY: readonly Target[] = ['inner', 'frame', 'mark', 'tally']

function slotsFor(composition: 0 | 1 | 2 | 3, required: Target): Target[] {
  const rest = SLOT_PRIORITY.filter(slot => slot !== required)
  return [required, ...rest].slice(0, composition + 1)
}

/**
 * The element class a dimension has to live on.
 *
 * `count` only means something on a tally; `anchor` only on an element that has one. The rest
 * are properties of a drawn shape, so any shape-bearing slot will do and `inner` is the
 * natural default.
 */
function slotForDim(dim: DimId): Target {
  if (dim === 'count') return 'tally'
  return 'inner'
}

function randomBody(random: () => number, sizeStep: number) {
  return {
    kind: pick(random, ALL_SHAPE_KINDS) as ShapeKind,
    shading: pick(random, SHADINGS) as Shading,
    // Multiples of 15, matching the rotation dimension's grid, so a rotation track starting
    // from here lands on the same lattice it steps along.
    rotationDeg: Math.floor(random() * 24) * 15,
    sizeStep,
  }
}

/**
 * A starting cell with the right classes present, none of them yet driven.
 *
 * Sizes are assigned by role rather than randomly: a frame has to be big enough to contain
 * what sits inside it, and a mark has to be small enough to read as a marker rather than as
 * a second inner shape. Getting this wrong does not throw - it produces a cell whose frame is
 * hidden inside its own contents, which `noHiddenLayers` then rejects, and the whole family
 * quietly stops generating.
 */
function baseCell(random: () => number, slots: Target[]): Cell {
  const cell: Cell = {}
  for (const slot of slots)
    switch (slot) {
      case 'frame':
        cell.frame = {
          class: 'frame',
          ...randomBody(random, 12),
          shading: 'outline',
        }
        break
      case 'inner':
        cell.inner = {
          class: 'inner',
          anchor: 'center',
          ...randomBody(random, slots.includes('frame') ? 5 : 9),
        }
        break
      case 'mark':
        cell.mark = {
          class: 'mark',
          anchor: pick(random, [
            'ne',
            'se',
            'sw',
            'nw',
          ] as const) as CornerAnchor,
          ...randomBody(random, 1),
        }
        break
      default:
        cell.tally = {
          class: 'tally',
          count: 1 + Math.floor(random() * 3),
          anchor: 's',
        }
    }

  return cell
}

/**
 * Put the base on the ladder its tracks will walk.
 *
 * Track values are offsets from the base, so the base has to be somewhere the offset means
 * something. Two cases need it:
 *
 * - A `sides` track steps 3, 4, 5, 6, 7 sides. If the base shape is a circle or a star, it is
 *   not on that ladder at all and the offset has nowhere to start from.
 * - An `anchor` track walks the eight perimeter positions. A base sitting at `center` is not
 *   on the ring, so the first step would jump rather than move.
 *
 * Also nudges the base away from the ends of the clamped ladders. Not for correctness - the
 * witnessing check catches a flattened track either way - but a base drawn at the extreme
 * flattens often enough to waste most of a family's attempts.
 */
function normaliseBase(
  cell: Cell,
  tracks: Track[],
  random: () => number
): Cell {
  let next = cell
  for (const track of tracks) {
    if (track.dim === 'sides') {
      const element = next[track.target]
      if (element && element.class !== 'tally') {
        // Middle of the ladder, so a step in either direction has room.
        const kind = SIDE_LADDER_KINDS[
          1 + Math.floor(random() * 3)
        ] as ShapeKind
        next = { ...next, [track.target]: { ...element, kind } } as Cell
      }
    }

    if (track.dim === 'anchor') {
      const element = next[track.target]
      if (element && element.class === 'inner')
        next = {
          ...next,
          inner: {
            ...element,
            anchor: pick(random, PERIMETER_ANCHORS) as Anchor,
          },
        }
    }

    if (track.dim === 'size') {
      const element = next[track.target]
      if (element && element.class !== 'tally') {
        /**
         * Start low enough that the track's whole travel stays legal.
         *
         * Two constraints at once. The table has ends, so a base near the top clamps and the
         * track stops varying - which `trackIsWitnessed` then rejects. And a corner mark is
         * small and close in, so a growing centred shape eventually CONTAINS it: the mark
         * disappears under the ink, `noHiddenLayers` rejects the cell, and the family fails
         * every attempt at that composition rather than obviously misbehaving.
         *
         * A shape whose radius passes about 37 units swallows a corner mark, which is size
         * step 9. Leaving three steps of headroom below that is what makes the band 2..5 here
         * instead of 4..8.
         */
        const band = next.mark
          ? 2 + Math.floor(random() * 4)
          : 4 + Math.floor(random() * 5)
        next = {
          ...next,
          [track.target]: { ...element, sizeStep: band },
        } as Cell
      }
    }
  }
  return next
}

/**
 * Fold every active track over the base to produce one cell.
 *
 * Order is track order, and it matters only when two tracks drive the same field of the same
 * slot - which the selection below forbids, so the fold is order-independent in practice.
 */
function cellAt(base: Cell, tracks: Track[], row: number, col: number): Cell {
  return tracks.reduce((cell, track) => applyTrack(cell, track, row, col), base)
}

/**
 * Build a track-driven item.
 *
 * The shared body of nearly every family. A family supplies its primary dimension and the
 * secondaries it will accept; the rung supplies how many dimensions to run, how deep the
 * cell is, which layout, how oblique the steps may be, and how many constant decoys to leave
 * lying around.
 */
function buildTracked(
  random: () => number,
  profile: RungProfile,
  primaryDim: DimId,
  secondaryPool: readonly DimId[]
): Built | null {
  const { layout, dimensions, composition, stepStyle, decoys } = profile
  const slots = slotsFor(composition, slotForDim(primaryDim))

  // How many distinct slots the tracks may touch, so the requested number of decoys is left
  // untouched. Tracks beyond that share a slot, which is what real matrices do anyway - a
  // shape that changes shading AND rotation is one element carrying two dimensions.
  const drivableCount = Math.max(1, slots.length - decoys)
  const drivable = slots.slice(0, drivableCount)

  // `count` only exists on a tally, `anchor` only on inner or mark.
  const targetFor = (dim: DimId): Target | null => {
    if (dim === 'count') return slots.includes('tally') ? 'tally' : null
    if (dim === 'anchor') {
      if (drivable.includes('inner')) return 'inner'
      return drivable.includes('mark') ? 'mark' : null
    }
    const shapeSlots = drivable.filter(slot => slot !== 'tally')
    return (shapeSlots[0] as Target | undefined) ?? null
  }

  const primaryTarget = targetFor(primaryDim)
  if (!primaryTarget) return null

  const primaryOptions = enumerate(primaryDim, primaryTarget, layout, stepStyle)
  if (!primaryOptions.length) return null
  const primary = pick(random, primaryOptions) as Track

  const tracks: Track[] = [primary]
  const usedDims = new Set<DimId>([primaryDim])

  for (const dim of shuffle(random, secondaryPool)) {
    if (tracks.length >= dimensions) break
    if (usedDims.has(dim)) continue
    const target = targetFor(dim)
    if (!target) continue
    const options = enumerate(dim, target, layout, stepStyle)
    if (!options.length) continue
    tracks.push(pick(random, options) as Track)
    usedDims.add(dim)
  }
  if (tracks.length < dimensions) return null

  /**
   * A layout that confirms the rule fewer than twice needs an ordinal track.
   *
   * Three cells showing `outline, half, filled` are consistent with a cycle continuing to
   * `outline` AND with a palindrome turning back to `half`. Both are defensible, so two of
   * the six options are right and one of them is marked wrong - and no identity check can see
   * it, because the options are genuinely distinct pictures. A co-active ordinal dimension
   * makes the palindrome reading self-contradictory, which is what restores a single answer.
   */
  if (layout.confirmations < 2 && !tracks.some(track => ORDINAL.has(track.dim)))
    return null

  const base = normaliseBase(baseCell(random, slots), tracks, random)
  const cells = emptyGrid(layout)
  for (let index = 0; index < positionCount(layout); index += 1) {
    if (index === layout.holeIndex) continue
    const { row, col } = coordsOf(layout, index)
    cells[index] = cellAt(base, tracks, row, col)
  }

  /**
   * Witnessing, checked on the CELLS rather than on the track arithmetic.
   *
   * A track value is an offset from the base and the ordinal dimensions clamp at their ends,
   * so whether a track varies depends on where its base sits - offsets 0, 1, 2 on a base
   * already at the top of the size table all clamp together, and three identical cells is an
   * item with nothing to notice. Failing here just re-rolls the base on the next attempt,
   * which is cheaper and more complete than trying to enumerate the safe bases up front.
   */
  for (const track of tracks)
    if (!trackIsWitnessed(track, layout, cells)) return null

  const hole = holeCoords(layout)
  const answer = cellAt(base, tracks, hole.row, hole.col)
  if (!noHiddenLayers(answer)) return null
  if (cells.some(cell => cell && !noHiddenLayers(cell))) return null

  const distractors = buildDistractors(
    base,
    tracks,
    layout.id,
    hole,
    answer,
    slots,
    drivable,
    cells
  )
  if (!distractors) return null

  const driven = new Set(tracks.map(track => track.target))
  return {
    cells,
    answer,
    distractors,
    dimensions: tracks.length,
    tracks,
    decoySlots: slots.filter(slot => !driven.has(slot)),
  }
}

/**
 * Five near-misses, each wrong for a reason that can be named.
 *
 * ## Why candidates are generated as a long ladder and then filtered
 *
 * v1 built a short fixed list per rule and took the first five DISTINCT entries. For many
 * legal parameter values the list collapsed below five, the item failed verification, and the
 * generator retried with a different rule - so the parameters that shipped were the ones
 * whose distractor arithmetic happened not to collide. That is the single root cause behind
 * three of v1's four variety failures.
 *
 * The fix is to offer many more candidates than needed, in priority order, and filter on
 * `perceptuallyDistinct` rather than on structural inequality - because two options one size
 * step apart are structurally different and visually identical, which is its own kind of
 * unfair.
 */
function buildDistractors(
  base: Cell,
  tracks: Track[],
  layoutId: LayoutId,
  hole: { row: number; col: number },
  answer: Cell,
  slots: Target[],
  drivable: Target[],
  grid: CellGrid
): Distractor[] | null {
  const primary = tracks[0] as Track
  const candidates: Distractor[] = []

  const withPrimaryShift = (shift: number): Cell => {
    const shifted: Track = { ...primary, phase: primary.phase + shift }
    return cellAt(base, [shifted, ...tracks.slice(1)], hole.row, hole.col)
  }

  // Wrong step: the classic near-miss, and the previous cell's value.
  candidates.push({ cell: withPrimaryShift(1), error: 'off-by-one-step' })
  candidates.push({ cell: withPrimaryShift(-1), error: 'off-by-one-step' })
  candidates.push({
    cell: cellAt(
      base,
      tracks,
      primary.axis === 'row' ? Math.max(0, hole.row - 1) : hole.row,
      primary.axis === 'col' ? Math.max(0, hole.col - 1) : hole.col
    ),
    error: 'not-advanced',
  })

  // Wrong dimension: a secondary left behind, or the axes read the wrong way round.
  tracks.slice(1).forEach((track, index) => {
    const frozen = [...tracks]
    frozen[index + 1] = { ...track, step: 0 }
    candidates.push({
      cell: cellAt(base, frozen, hole.row, hole.col),
      error: 'secondary-frozen',
    })
  })

  if (layoutId !== '1x3-sequence') {
    candidates.push({
      cell: cellAt(base, tracks, hole.col, hole.row),
      error: 'axis-transpose',
    })
    candidates.push({
      cell: cellAt(
        base,
        tracks.map(
          track =>
            ({ ...track, axis: track.axis === 'col' ? 'row' : 'col' }) as Track
        ),
        hole.row,
        hole.col
      ),
      error: 'axis-transpose',
    })
  }

  /**
   * The primary's step applied to a dimension it does not drive.
   *
   * `kind` leads because it is the only one guaranteed visible. A rotation swap is invisible
   * on a circle - symmetry period 1, so every angle is the same picture - and a shading swap
   * is a no-op if the primary already drives shading. When a one-dimension item has just five
   * candidate sources, one silently-empty source is the difference between a full panel and a
   * discarded item.
   */
  const swapDims: DimId[] = ['kind', 'size', 'rotation', 'shading']
  for (const dim of swapDims) {
    if (tracks.some(track => track.dim === dim)) continue
    const target = drivable.find(slot => slot !== 'tally')
    if (!target) continue
    const swapped: Track = {
      dim,
      target,
      axis: primary.axis,
      step: primary.step,
      phase: primary.phase,
    }
    candidates.push({
      cell: cellAt(base, [...tracks, swapped], hole.row, hole.col),
      error: 'dimension-swap',
    })
  }

  // A constant decoy changed. Only meaningful where a decoy exists.
  /**
   * A constant decoy, nudged by exactly one - `step: 0, phase: 1`.
   *
   * The step being zero is the point. An earlier version used `step: 1, phase: 1`, so the
   * offset at the hole was `1 + 1 * holeCol`, which on a 3x3 is 3 - and shading has three
   * values, so the "promoted" decoy landed back on its own colour and the distractor was
   * byte-identical to the answer. Both decoy candidates were silently discarded, and a
   * one-dimension shading item then could not fill its panel at all.
   *
   * Only the hole is ever evaluated for a distractor, so a zero step is not a track that
   * fails to vary - it is a constant offset, which is exactly what "changed by one" means.
   */
  const driven = new Set(tracks.map(track => track.target))
  for (const slot of slots.filter(s => !driven.has(s))) {
    const promoted: Track = {
      dim: slot === 'tally' ? 'count' : 'shading',
      target: slot,
      axis: 'col',
      step: 0,
      phase: 1,
    }
    candidates.push({
      cell: cellAt(base, [...tracks, promoted], hole.row, hole.col),
      error: 'decoy-promoted',
    })
  }

  // Wider off-by-N, still a statable error rather than noise.
  for (const shift of [2, -2, 3, -3])
    candidates.push({ cell: withPrimaryShift(shift), error: 'off-by-one-step' })

  /**
   * The grid's own cells, echoed back.
   *
   * Last in priority because the near-misses above are the better distractors when they
   * exist - but essential, because they are the only source that does not shrink with the
   * primary dimension's cardinality. A three-value shading cycle yields two off-by-one
   * options and no more; without this the panel cannot be filled and the item is thrown away,
   * which is exactly the collapse that reduced three of v1's families to a handful of
   * distinct puzzles each.
   *
   * Nearest cells first: the ones adjacent to the hole are the most tempting wrong answers.
   */
  const echoes = grid
    .map((cell, index) => ({ cell, index }))
    .filter(
      (entry): entry is { cell: Cell; index: number } => entry.cell != null
    )
    .sort((a, b) => b.index - a.index)
  for (const { cell } of echoes)
    candidates.push({ cell, error: 'operand-echo' })

  const chosen: Distractor[] = []
  const modelCount = new Map<ErrorModel, number>()

  for (const candidate of candidates) {
    if (chosen.length === 5) break
    if (!noHiddenLayers(candidate.cell)) continue
    if (!perceptuallyDistinct(candidate.cell, answer)) continue
    if (chosen.some(other => !perceptuallyDistinct(candidate.cell, other.cell)))
      continue
    // No model more than twice: five near-identical off-by-ones would measure arithmetic
    // precision rather than whether the rule was found.
    if ((modelCount.get(candidate.error) ?? 0) >= 2) continue
    modelCount.set(candidate.error, (modelCount.get(candidate.error) ?? 0) + 1)
    chosen.push(candidate)
  }

  if (chosen.length < 5) return null

  // Both failure modes must be on the panel - the repo's stated principle, as a check.
  const models = chosen.map(distractor => distractor.error)
  if (!models.some(model => STEP_ERRORS.has(model))) return null
  if (!models.some(model => DIMENSION_ERRORS.has(model))) return null

  return chosen
}

const ALL_LAYOUTS: readonly LayoutId[] = [
  '3x3-matrix',
  '1x3-sequence',
  '2x2-matrix',
]
const MATRICES: readonly LayoutId[] = ['3x3-matrix', '2x2-matrix']

// ---------------------------------------------------------------------------------------
// Set logic - the one family that is not track-driven
// ---------------------------------------------------------------------------------------

const LATTICE = 3
const LATTICE_SLOTS = LATTICE * LATTICE
type Operator = 'and' | 'or' | 'xor'
const OPERATORS: readonly Operator[] = ['and', 'or', 'xor']

function applyOperator(
  op: Operator,
  a: readonly number[],
  b: readonly number[]
): number[] {
  const setA = new Set(a)
  const setB = new Set(b)
  const out: number[] = []
  for (let i = 0; i < LATTICE_SLOTS; i += 1) {
    const inA = setA.has(i)
    const inB = setB.has(i)
    const on =
      op === 'and' ? inA && inB : op === 'or' ? inA || inB : inA !== inB
    if (on) out.push(i)
  }
  return out
}

function fieldCell(filled: readonly number[], extras: Cell): Cell {
  return {
    ...extras,
    field: { class: 'field', size: LATTICE, filled: [...filled] },
  }
}

/**
 * Row-wise set logic on dot lattices: column C is A op B, slot by slot.
 *
 * The hardest family in the vocabulary and the one that most separates takers, because the
 * OPERATOR itself has to be inferred from two complete rows before it can be applied to the
 * third. Everything else here steps a property; this asks the taker to form a hypothesis and
 * test it.
 *
 * ## Why it is hand-written rather than a track
 *
 * A track advances one property of one element along an axis. An operator is not a property of
 * anything - it is a relationship between two cells - so no amount of stepping expresses it.
 * This is the family that justifies `Built.dimensions` being declared rather than counted from
 * tracks, and it is the reason the abstraction stops where it does: forcing set logic into the
 * track model would have meant weakening the model until it no longer guaranteed anything.
 *
 * Ported from v1, which had this family right. It was the only one of the six whose output
 * space was healthy - 225 distinct grids from 225 items - and dropping it would have left the
 * published rule list naming something the test no longer contained.
 */
const setLogic: RuleSpec = {
  name: 'set-logic',
  capabilities: {
    // Back half only, and 3x3 only: the operator is inferred from two COMPLETE rows, which no
    // other layout provides.
    rungs: { min: 14, max: 26 },
    // Exactly two, never one - see `Built.dimensions` and `minDimensions`.
    minDimensions: 2,
    maxDimensions: 2,
    layouts: ['3x3-matrix'],
    composition: { min: 0, max: 2 },
  },
  build: (random, profile) => {
    const { layout, composition, decoys } = profile
    if (layout.id !== '3x3-matrix') return null

    const op = pick(random, OPERATORS) as Operator

    /**
     * Density around 0.45 per slot.
     *
     * Sparse masks make AND produce an empty lattice, which reads as a different KIND of
     * answer rather than a wrong count; dense ones make OR produce a full one. Both extremes
     * also collapse the distractor pool, which is how v1's other families died.
     */
    const randomMask = (): number[] => {
      const on: number[] = []
      for (let i = 0; i < LATTICE_SLOTS; i += 1) if (random() > 0.55) on.push(i)
      return on
    }

    // Constant extras, present but never varying - the decoy mechanism, same as the track
    // families use. A frame around a lattice reads naturally; a corner mark adds a second.
    const extras: Cell = {}
    const decoySlots: Target[] = []
    if (composition >= 1) {
      extras.frame = {
        class: 'frame',
        ...randomBody(random, 13),
        shading: 'outline',
      }
      decoySlots.push('frame')
    }
    if (composition >= 2) {
      extras.mark = {
        class: 'mark',
        anchor: pick(random, ['ne', 'se', 'sw', 'nw'] as const) as CornerAnchor,
        ...randomBody(random, 1),
      }
      decoySlots.push('mark')
    }
    if (decoySlots.length < decoys) return null

    const rows = [0, 1, 2].map(() => {
      const a = randomMask()
      const b = randomMask()
      return [a, b, applyOperator(op, a, b)]
    })

    const cells = emptyGrid(layout)
    for (let row = 0; row < 3; row += 1)
      for (let col = 0; col < 3; col += 1) {
        const index = row * 3 + col
        if (index === layout.holeIndex) continue
        cells[index] = fieldCell(rows[row]?.[col] as number[], extras)
      }

    const a = rows[2]?.[0] as number[]
    const b = rows[2]?.[1] as number[]
    const answerFilled = rows[2]?.[2] as number[]
    const answer = fieldCell(answerFilled, extras)

    // An empty or completely full answer is a different kind of thing from the other options,
    // so it can be picked without reasoning.
    if (answerFilled.length === 0 || answerFilled.length === LATTICE_SLOTS)
      return null

    const flipOne = (base: readonly number[], salt: number): number[] => {
      const set = new Set(base)
      const target = (salt * 3 + 1) % LATTICE_SLOTS
      if (set.has(target)) set.delete(target)
      else set.add(target)
      return Array.from(set)
    }

    const candidates: Distractor[] = [
      // The other two operators. The best distractors available: each is exactly what a taker
      // gets by inferring the wrong relationship, which is the mistake this item is about.
      ...OPERATORS.filter(other => other !== op).map(other => ({
        cell: fieldCell(applyOperator(other, a, b), extras),
        error: 'dimension-swap' as ErrorModel,
      })),
      // Right operator, one slot wrong.
      {
        cell: fieldCell(flipOne(answerFilled, 1), extras),
        error: 'off-by-one-step',
      },
      {
        cell: fieldCell(flipOne(answerFilled, 2), extras),
        error: 'off-by-one-step',
      },
      // The operands handed back - the "it looks like these" instinct.
      { cell: fieldCell(a, extras), error: 'operand-echo' },
      { cell: fieldCell(b, extras), error: 'operand-echo' },
      {
        cell: fieldCell(flipOne(answerFilled, 4), extras),
        error: 'not-advanced',
      },
    ]

    const chosen: Distractor[] = []
    const seen = new Map<ErrorModel, number>()
    for (const candidate of candidates) {
      if (chosen.length === 5) break
      if (!noHiddenLayers(candidate.cell)) continue
      if (!perceptuallyDistinct(candidate.cell, answer)) continue
      if (
        chosen.some(other => !perceptuallyDistinct(candidate.cell, other.cell))
      )
        continue
      if ((seen.get(candidate.error) ?? 0) >= 2) continue
      seen.set(candidate.error, (seen.get(candidate.error) ?? 0) + 1)
      chosen.push(candidate)
    }
    if (chosen.length < 5) return null

    const models = chosen.map(distractor => distractor.error)
    if (!models.some(model => STEP_ERRORS.has(model))) return null
    if (!models.some(model => DIMENSION_ERRORS.has(model))) return null

    return {
      cells,
      answer,
      distractors: chosen,
      // See `Built.dimensions`: inferring an operator means holding both operands in mind and
      // testing a hypothesis against them.
      dimensions: 2,
      tracks: [],
      decoySlots,
      requiresUniqueOperator: true,
    }
  },
}

/** A track-driven family, which is most of them. */
function tracked(
  name: string,
  primary: DimId,
  secondaries: readonly DimId[],
  capabilities: RuleCapabilities
): RuleSpec {
  return {
    name,
    capabilities,
    build: (random, profile) =>
      buildTracked(random, profile, primary, secondaries),
  }
}

/**
 * The vocabulary.
 *
 * Note what is NOT here. v1's `shape-progression` is gone as a family: it was "step a fixed
 * four-shape ring by one", which is `shape-cycle` with a hardcoded ring, and because the ring
 * length divided the grid size its answer was always the same shape. It survives as two
 * genuinely different things - a cyclic `shape-cycle` for matrices, where two axes pin the
 * reading, and an ordinal `side-progression` counting 3, 4, 5, 6, 7 sides, which is the only
 * shape dimension a three-cell sequence can determine.
 *
 * ## Why almost every family starts at rung 1
 *
 * An earlier version staggered the minimums - rotation from rung 3, translation from 5,
 * counting from 6 - by analogy with v1, where `minRung` was the only difficulty control
 * there was. That was vestigial thinking, and it did real damage: it left rung 1 with two
 * eligible families and rung 2 with three, which combined with the no-repeat-within-four-rungs
 * rule made the whole 26-slot assignment nearly unsatisfiable. A quarter of seeds could not
 * be planned at all.
 *
 * Difficulty is the RUNG's job now. A rotation item at one dimension, bare composition and a
 * unit forward step is an easy item, and there is no reason to withhold it from the front of
 * the test - the profile already guarantees it will be easy. `rungs.max` still earns its
 * place, because "this family cannot carry the hardest rungs" is a real statement that v1 had
 * no way to express.
 */
export const RULES: readonly RuleSpec[] = [
  tracked('shading-cycle', 'shading', ['size', 'rotation', 'count', 'anchor'], {
    /**
     * Composition 1 at minimum, and the reason is arithmetic.
     *
     * Shading has three values. At bare composition with one varying dimension, the item's
     * entire universe is three pictures - so a panel of six distinct options cannot be built
     * from it, and every attempt fails. That is not a tuning preference, it is a counting
     * argument, and it is exactly the shape of the collapse that reduced three of v1's
     * families to a handful of puzzles each: a family eligible where it cannot actually
     * generate, quietly substituted away.
     *
     * One extra element class gives the distractors somewhere else to differ, which is enough.
     *
     * Matrices only, for a related reason. On a three-cell sequence a cyclic three-value
     * primary contributes almost nothing to determinacy - the co-active ordinal track carries
     * all of it - and the panel runs out of distinct pictures.
     *
     * Composition 2 rather than 1, arrived at by measurement rather than taste. With one
     * varying dimension the panel needs five distinct wrong pictures, and a three-value
     * primary supplies only two; the rest have to come from element classes the rule is NOT
     * driving. One spare class is not reliably enough - whether it works depends on whether
     * the shape happens to be a circle, since a rotated circle is the same picture. Two spare
     * classes always is.
     *
     * Both narrowings are deliberately conservative. An over-claimed capability is precisely
     * how v1's families died: eligible everywhere, generating almost nowhere, silently
     * substituted away. Better a family that covers fewer rungs and always delivers.
     */
    rungs: { min: 1, max: 24 },
    maxDimensions: 3,
    layouts: MATRICES,
    composition: { min: 2, max: 3 },
  }),
  tracked('shape-cycle', 'kind', ['shading', 'size', 'rotation', 'count'], {
    // Matrices only: a cyclic shape ring has no determined continuation from three cells.
    rungs: { min: 1, max: 26 },
    maxDimensions: 3,
    layouts: MATRICES,
    composition: { min: 0, max: 3 },
  }),
  tracked(
    'side-progression',
    'sides',
    ['shading', 'size', 'rotation', 'count', 'anchor'],
    {
      rungs: { min: 1, max: 26 },
      maxDimensions: 3,
      layouts: ALL_LAYOUTS,
      composition: { min: 0, max: 3 },
    }
  ),
  tracked('rotation', 'rotation', ['shading', 'size', 'count', 'anchor'], {
    rungs: { min: 1, max: 26 },
    maxDimensions: 3,
    layouts: ALL_LAYOUTS,
    composition: { min: 0, max: 3 },
  }),
  tracked('size-scale', 'size', ['shading', 'rotation', 'count'], {
    // Capped before the tail: size cannot honestly be the primary of a hardest-rung item,
    // and `rungs.max` is the capability v1 had no way to express.
    /**
     * Composition 1 at minimum, same counting argument as `shading-cycle` in milder form.
     *
     * Adjacent size steps are three cell units apart and the perceptual floor is five and a
     * half, so an off-by-ONE-step distractor is invisible and gets discarded - the panel has
     * to be filled from wider offsets plus dimensions the rule is not driving. At bare
     * composition there is no spare element class to supply them, and one spare class is not
     * reliably enough - whether it works depends on whether the shape happens to be a circle,
     * whose rotation is invisible. Two always is.
     */
    rungs: { min: 1, max: 21 },
    maxDimensions: 2,
    layouts: ALL_LAYOUTS,
    composition: { min: 2, max: 3 },
  }),
  tracked('translation', 'anchor', ['shading', 'size', 'rotation', 'count'], {
    // A frame gives the movement something to be measured against, which reads better than a
    // shape drifting in empty space.
    rungs: { min: 1, max: 26 },
    maxDimensions: 3,
    layouts: ALL_LAYOUTS,
    composition: { min: 1, max: 3 },
  }),
  setLogic,
  tracked(
    'count-progression',
    'count',
    ['shading', 'size', 'rotation', 'anchor'],
    {
      // Composition 1 at minimum, so a shape-bearing slot exists for the secondary dimensions
      // to run on - a tally alone has nothing but its own count.
      rungs: { min: 1, max: 26 },
      maxDimensions: 3,
      layouts: ALL_LAYOUTS,
      composition: { min: 1, max: 3 },
    }
  ),
]

export const RULES_BY_NAME: Record<string, RuleSpec> = Object.fromEntries(
  RULES.map(rule => [rule.name, rule])
)

/**
 * Relative share of the 26 slots, not an exact count - see `planFamilies`.
 *
 * Weighted toward the families the reference test leans on most: shading and positional
 * movement are its two most frequent. `size-scale` is lower because it is capped out of the
 * tail anyway, and a family that can only fill the front of the test should not be competing
 * for slots it cannot use.
 */
export const FAMILY_WEIGHTS: Record<string, number> = {
  'shading-cycle': 4,
  'shape-cycle': 4,
  'side-progression': 4,
  rotation: 4,
  translation: 4,
  'count-progression': 3,
  'size-scale': 3,
  // Low weight, not low value. Set logic is the hardest family here and only three rungs can
  // host it - back half, 3x3, two dimensions - so a higher share would be asking for slots
  // that do not exist.
  'set-logic': 2,
}

export function familyCanFill(family: string, profile: RungProfile): boolean {
  const rule = RULES_BY_NAME[family]
  return rule ? canFill(rule.capabilities, profile) : false
}

/** Re-exported so tests and verification share one notion of identity. */
export { cellKey, perceptuallyDistinct, MAX_TALLY, SIZE_STEPS }
export type { Anchor, Cell, DimId, Track }
export { CYCLIC, ORDINAL }
