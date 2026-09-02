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
 * Deterministic PRNG (mulberry32).
 *
 * `Math.random` is unusable here: a result page must re-render the exact test somebody
 * sat, and the only thing stored is the seed. Small, fast, and good enough for choosing
 * shapes - this is not cryptography, and the share/result tokens that DO need entropy use
 * `crypto.randomBytes` in `lib/tokens.ts`.
 */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)] as T
}

export function shuffle<T>(random: () => number, items: readonly T[]): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j] as T, out[i] as T]
  }
  return out
}

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
