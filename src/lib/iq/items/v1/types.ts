import type { ShapeSpec } from '@/lib/iq/items/primitives'

/**
 * What a cell can contain, and what an item is.
 *
 * ```
 *   ITEM (3x3 matrix, bottom-right missing)
 *   ┌─────┬─────┬─────┐
 *   │  0  │  1  │  2  │     cells[0..7] are given
 *   ├─────┼─────┼─────┤
 *   │  3  │  4  │  5  │     the answer belongs at index 8
 *   ├─────┼─────┼─────┤
 *   │  6  │  7  │  ?  │
 *   └─────┴─────┴─────┘
 *          ▼
 *   6 options: 1 answer + 5 rule-derived near-misses
 * ```
 */

export type Cell =
  | { type: 'shape'; spec: ShapeSpec }
  | { type: 'dotgrid'; size: number; filled: number[] }
  | { type: 'bars'; count: number }
  | { type: 'empty' }

export type Item = {
  /** Eight given cells, row-major. */
  cells: Cell[]
  answer: Cell
  /** Five near-misses. Order is shuffled at render time, not here. */
  distractors: Cell[]
  /** Which rule produced this. Carried for the explanation and for pool review. */
  rule: string
  /** 1-26. Higher means more rule dimensions varying at once. */
  rung: number
}

/**
 * The PRNG moved to `items/random.ts` when the generator was versioned - it is shared by
 * every version and frozen, so it cannot live in a per-version file. Re-exported here so
 * the v1 modules below read exactly as they did before the move.
 */
export { pick, rng, shuffle } from '@/lib/iq/items/random'

/** Structural identity, used by `verify.ts` to prove options are genuinely distinct. */
export function cellKey(cell: Cell): string {
  switch (cell.type) {
    case 'shape':
      return `s:${cell.spec.kind}:${cell.spec.shading}:${cell.spec.rotation ?? 0}:${(cell.spec.scale ?? 0.78).toFixed(2)}`
    case 'dotgrid':
      return `g:${cell.size}:${[...cell.filled].sort((a, b) => a - b).join(',')}`
    case 'bars':
      return `b:${cell.count}`
    default:
      return 'e'
  }
}

export type RuleSpec = {
  name: string
  /** Lowest rung this rule may appear at. Keeps easy rungs to one varying dimension. */
  minRung: number
  build: (random: () => number, rung: number) => { cells: Cell[]; answer: Cell; distractors: Cell[] }
}
