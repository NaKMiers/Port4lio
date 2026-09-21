import type { Cell } from '@/lib/iq/items/v2/cell'

/**
 * The shapes an item can be laid out in.
 *
 * ```
 *   3x3-matrix              1x3-sequence            2x2-matrix
 *   ┌───┬───┬───┐           ┌───┬───┬───┬───┐       ┌───┬───┐
 *   │ 0 │ 1 │ 2 │           │ 0 │ 1 │ 2 │ ? │       │ 0 │ 1 │
 *   ├───┼───┼───┤           └───┴───┴───┴───┘       ├───┼───┤
 *   │ 3 │ 4 │ 5 │            3 given, 1 hole        │ 2 │ ? │
 *   ├───┼───┼───┤            ZERO cross-checks      └───┴───┘
 *   │ 6 │ 7 │ ? │                                   3 given, 1 hole
 *   └───┴───┴───┘
 *    8 given, rule
 *    readable twice
 * ```
 *
 * ## Layout IS a difficulty axis
 *
 * This is the part that is easy to miss. A 3x3 matrix shows the rule eight times, so it can
 * be read down the columns and confirmed across the rows; a solver who mis-reads one axis
 * catches it on the other. A three-cell sequence shows it twice and confirms it once. The
 * same rule is materially harder in a sequence, which is why the reference test puts six of
 * its last eight items there - and why difficulty here does not come only from stacking more
 * varying dimensions.
 *
 * The corollary is a constraint, not a bonus: fewer exemplars means fewer rules are uniquely
 * determined. Three cells pin one varying dimension, not two. A rule has to declare which
 * layouts it can fill without becoming ambiguous, because `cellKey` cannot detect this
 * failure - the six options are genuinely distinct pictures, two of them are just both
 * defensible. See `RuleSpec.layouts`.
 *
 * `2x2-matrix` is the weakest of the three: three given cells give a row step and a column
 * step and confirm NEITHER. It is capped hardest for that reason, and the reference's single
 * instance suggests its authors reached the same conclusion.
 */

export type LayoutId = '3x3-matrix' | '1x3-sequence' | '2x2-matrix'

export type LayoutSpec = {
  id: LayoutId
  cols: number
  rows: number
  /**
   * Grid position of the hole, row-major. Explicit, NOT derived as `cols * rows - 1`.
   *
   * It happens to be last for all three layouts today, and deriving it would still be wrong:
   * a symmetry-completion rule wants the hole in the middle of the figure so the mirror
   * partner is visible on both sides. A derived hole would have to be un-derived by the first
   * rule that needs one, and by then the renderer and the verifier both assume it.
   */
  holeIndex: number
  /**
   * How many times the rule can be confirmed after it has been read.
   *
   * Not decoration - `verify.ts` uses it to decide how strict to be about alternative
   * readings. Zero confirmations means a competing rule that fits the givens is a real
   * second answer rather than something a solver would notice and discard.
   */
  confirmations: number
}

export const LAYOUTS: Record<LayoutId, LayoutSpec> = {
  // Four boxes, three given. Named for the three the taker reads, sized for what renders.
  '1x3-sequence': {
    id: '1x3-sequence',
    cols: 4,
    rows: 1,
    holeIndex: 3,
    confirmations: 1,
  },
  '2x2-matrix': {
    id: '2x2-matrix',
    cols: 2,
    rows: 2,
    holeIndex: 3,
    confirmations: 0,
  },
  '3x3-matrix': {
    id: '3x3-matrix',
    cols: 3,
    rows: 3,
    holeIndex: 8,
    confirmations: 2,
  },
}

export const LAYOUT_IDS = Object.keys(LAYOUTS) as LayoutId[]

/** Total grid positions, including the hole. */
export function positionCount(layout: LayoutSpec): number {
  return layout.cols * layout.rows
}

/** How many cells are actually drawn. What `verify.ts` checks, in place of v1's literal 8. */
export function givenCellCount(layout: LayoutSpec): number {
  return positionCount(layout) - 1
}

/** Row and column of a grid position. */
export function coordsOf(
  layout: LayoutSpec,
  index: number
): { row: number; col: number } {
  return { row: Math.floor(index / layout.cols), col: index % layout.cols }
}

/**
 * The hole's coordinates - the cell a rule has to predict.
 *
 * A sequence is one row, so its "column" is the position along the line. Rules read the
 * sequence axis as a column, which is what lets a column-driven track work unchanged in both
 * a matrix and a sequence.
 */
export function holeCoords(layout: LayoutSpec): { row: number; col: number } {
  return coordsOf(layout, layout.holeIndex)
}

/**
 * A grid with `null` at the hole - the shape `Item.cells` takes.
 *
 * Not a dense list of the given cells, which is what v1 used. That worked only because v1's
 * hole is always last: as soon as `holeIndex` can be interior, "array index" and "grid
 * position" diverge, and every positional rule - Latin square, mirror, symmetry-completion -
 * needs an index shift that nothing type-checks. Keeping index equal to position means a rule
 * can address a neighbour as `cells[i - cols]` and have it mean what it says.
 */
export type CellGrid = (Cell | null)[]

/** An empty grid of the right shape, for a rule to fill. */
export function emptyGrid(layout: LayoutSpec): CellGrid {
  return Array.from({ length: positionCount(layout) }, () => null)
}
