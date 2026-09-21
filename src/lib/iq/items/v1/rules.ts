import {
  SHAPE_KINDS,
  type Shading,
  type ShapeKind,
} from '@/lib/iq/items/primitives'
import {
  cellKey,
  pick,
  rng,
  shuffle,
  type Cell,
  type RuleSpec,
} from '@/lib/iq/items/v1/types'

/**
 * The rule vocabulary.
 *
 * ```
 *   ELEMENT TRANSFORMATION          ROW-WISE LOGIC
 *   ├─ shading-cycle                ├─ set-logic (AND / OR / XOR on dot grids)
 *   ├─ rotation                     └─ count-series
 *   ├─ size-scale
 *   └─ shape-progression
 * ```
 *
 * This is deliberately the Sandia / Wang-Su space and nothing wider. Those two families
 * are what the literature validates and what the reference test actually uses. Families
 * outside it (tessellation, free-form line overlay) are NOT faked here with a rule that
 * almost works - a matrix whose answer is not uniquely determined is worse than one fewer
 * item type, because the taker is punished for being right.
 *
 * ## Distractors are the whole game
 *
 * A wrong option must be wrong for a *statable* reason: the right rule applied with the
 * wrong step, or the right step applied to the wrong dimension. Random shapes make an item
 * solvable by elimination without ever finding the rule, which measures nothing.
 *
 * Every rule below therefore produces its own near-misses. `verify.ts` then proves the
 * answer is unique among them, which is the assertion that stops a bad item shipping -
 * and it matters more here than in a fixed bank, because a generated item is never seen by
 * a human before a taker sees it.
 */

const SHADINGS: readonly Shading[] = ['outline', 'half', 'filled']

function shapeCell(
  kind: ShapeKind,
  shading: Shading,
  rotation = 0,
  scale = 0.78
): Cell {
  return { type: 'shape', spec: { kind, shading, rotation, scale } }
}

/** Distinct near-misses only. Fills from `candidates` in order, skipping collisions. */
function takeDistinct(answer: Cell, candidates: Cell[], count: number): Cell[] {
  const seen = new Set([cellKey(answer)])
  const out: Cell[] = []
  for (const candidate of candidates) {
    const key = cellKey(candidate)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(candidate)
    if (out.length === count) break
  }
  return out
}

/**
 * Shading cycles across columns, shape changes down rows.
 *
 * The archetypal two-dimension matrix: one property varies horizontally, another
 * vertically, and the missing cell is determined by both.
 */
const shadingCycle: RuleSpec = {
  name: 'shading-cycle',
  minRung: 1,
  build: random => {
    // Three DISTINCT kinds. Picking independently let the same shape land on two rows,
    // which quietly collapses the vertical dimension: the item stays uniquely solvable but
    // becomes easier than its rung claims, so a raw score stops meaning the same thing
    // across takers. Difficulty has to come from the ladder, not from luck.
    const kinds = shuffle(random, SHAPE_KINDS).slice(0, 3)
    const offset = Math.floor(random() * 3)
    const cells: Cell[] = []
    for (let row = 0; row < 3; row += 1)
      for (let col = 0; col < 3; col += 1) {
        if (row === 2 && col === 2) continue
        cells.push(
          shapeCell(
            kinds[row] as ShapeKind,
            SHADINGS[(col + offset) % 3] as Shading
          )
        )
      }

    const answerKind = kinds[2] as ShapeKind
    const answerShading = SHADINGS[(2 + offset) % 3] as Shading
    const answer = shapeCell(answerKind, answerShading)

    const distractors = takeDistinct(
      answer,
      [
        // Right shape, wrong point in the shading cycle.
        shapeCell(answerKind, SHADINGS[(0 + offset) % 3] as Shading),
        shapeCell(answerKind, SHADINGS[(1 + offset) % 3] as Shading),
        // Right shading, wrong row's shape.
        shapeCell(kinds[0] as ShapeKind, answerShading),
        shapeCell(kinds[1] as ShapeKind, answerShading),
        // Both dimensions wrong, but drawn from the same material.
        shapeCell(kinds[0] as ShapeKind, SHADINGS[(0 + offset) % 3] as Shading),
        shapeCell(kinds[1] as ShapeKind, SHADINGS[(1 + offset) % 3] as Shading),
        ...SHAPE_KINDS.map(kind => shapeCell(kind, answerShading)),
      ],
      5
    )
    return { cells, answer, distractors }
  },
}

/** A shape rotates by a fixed step across the row; the step is what must be inferred. */
const rotation: RuleSpec = {
  name: 'rotation',
  minRung: 3,
  build: random => {
    const kind = pick(random, [
      'square',
      'triangle',
      'diamond',
      'star4',
      'star5',
    ] as const)
    const step = pick(random, [30, 45, 60, 90])
    const shading = pick(random, SHADINGS)
    const cells: Cell[] = []
    for (let row = 0; row < 3; row += 1)
      for (let col = 0; col < 3; col += 1) {
        if (row === 2 && col === 2) continue
        cells.push(shapeCell(kind, shading, (row * 3 + col) * step))
      }

    const answerAngle = 8 * step
    const answer = shapeCell(kind, shading, answerAngle)

    const distractors = takeDistinct(
      answer,
      [
        // Off by one step in each direction: the classic near-miss.
        shapeCell(kind, shading, answerAngle - step),
        shapeCell(kind, shading, answerAngle + step),
        shapeCell(kind, shading, answerAngle - 2 * step),
        // Correct angle, wrong shading - tests that they tracked the right dimension.
        shapeCell(
          kind,
          shading === 'filled' ? 'outline' : 'filled',
          answerAngle
        ),
        // Rotation applied to the wrong shape.
        shapeCell(
          kind === 'square' ? 'diamond' : 'square',
          shading,
          answerAngle
        ),
        shapeCell(kind, shading, answerAngle + 2 * step),
      ],
      5
    )
    return { cells, answer, distractors }
  },
}

/**
 * The most bars any cell may hold.
 *
 * Counting is meant to be the easy half of this item - the reasoning is in spotting that
 * two independent steps are running at once. Past about seven bars that inverts: the
 * work becomes tallying near-identical strokes, which measures patience, not reasoning.
 * Exported so the generator's tests can hold the line.
 */
export const MAX_BARS = 7

/**
 * Parameter triples for `count = start + col*step + row*rowStep`.
 *
 * Every one satisfies `start + 2*step + 2*rowStep <= MAX_BARS`, which is the count in the
 * bottom-right cell and therefore the largest in the grid. A whitelist rather than three
 * independent draws plus a rejection loop: the constraint is on the combination, and five
 * legal triples are easier to check by eye than a guard is to trust.
 *
 * `step === rowStep` is allowed. It makes the grid read as "sum of the two indices", which
 * is a fair alternative reading and lands on exactly the same missing cell - so it is a
 * genuinely easier item, not an ambiguous one.
 */
const COUNT_PARAMS: readonly {
  start: number
  step: number
  rowStep: number
}[] = [
  { start: 1, step: 1, rowStep: 1 },
  { start: 1, step: 1, rowStep: 2 },
  { start: 1, step: 2, rowStep: 1 },
  { start: 2, step: 1, rowStep: 1 },
  { start: 3, step: 1, rowStep: 1 },
]

/**
 * Bars count up across the columns and again down the rows. Arithmetic, not spatial.
 *
 * Two steps rather than one running sequence. The single sequence it replaced ran
 * `start + i*step` over all nine cells in reading order, which reached 18 bars on a 100-unit
 * cell - unreadable to render and unreasonable to count, with distractors one bar apart that
 * nobody could tell from the answer. Row and column steps keep the largest cell at
 * `MAX_BARS` while asking for MORE reasoning, not less: the solver has to separate two
 * dimensions instead of extending one line.
 */
const countSeries: RuleSpec = {
  name: 'count-series',
  minRung: 2,
  build: random => {
    const { start, step, rowStep } = pick(random, COUNT_PARAMS)
    const countAt = (row: number, col: number) =>
      start + col * step + row * rowStep

    const cells: Cell[] = []
    for (let i = 0; i < 8; i += 1)
      cells.push({ type: 'bars', count: countAt(Math.floor(i / 3), i % 3) })

    const answerCount = countAt(2, 2)
    const answer: Cell = { type: 'bars', count: answerCount }

    /**
     * Distractors by OFFSET, not by rule parameter, and that is a correctness fix.
     *
     * The previous pool was `answer ± step`, `answer ± 1`, `answer ± 2*step`. When
     * `step === 1` those collapse to four distinct counts, `takeDistinct` returns four, the
     * item fails verification, and the generator retries - forever, for that parameter set.
     * The only survivors were the `step = 2` items, which is precisely why every count
     * question in the wild was the widely-spaced kind that ran up to 17 bars. A rule silently
     * reduced to its worst variant is worse than a rule that throws.
     *
     * Offsets guarantee five distinct neighbours around any answer, closest first so the
     * near-misses are the ones that survive.
     */
    const OFFSETS = [-1, 1, -2, 2, -3, 3, -(step + rowStep), step + rowStep]
    const distractors = takeDistinct(
      answer,
      OFFSETS.map(offset => ({
        type: 'bars' as const,
        // Floor of 1 because zero bars renders as an empty cell, which reads as a different
        // KIND of answer rather than a wrong count. The ceiling keeps a distractor as
        // countable as the answer it competes with.
        count: Math.max(1, Math.min(MAX_BARS + 2, answerCount + offset)),
      })),
      5
    )
    return { cells, answer, distractors }
  },
}

/** A shape shrinks or grows by a constant ratio across the sequence. */
const sizeScale: RuleSpec = {
  name: 'size-scale',
  minRung: 4,
  build: random => {
    const kind = pick(random, SHAPE_KINDS)
    const shading = pick(random, SHADINGS)
    const growing = random() > 0.5
    const cells: Cell[] = []
    const sizeAt = (i: number) =>
      Number((growing ? 0.34 + i * 0.06 : 0.9 - i * 0.06).toFixed(2))
    for (let i = 0; i < 8; i += 1)
      cells.push(shapeCell(kind, shading, 0, sizeAt(i)))
    const answerScale = sizeAt(8)
    const answer = shapeCell(kind, shading, 0, answerScale)

    const distractors = takeDistinct(
      answer,
      [
        shapeCell(kind, shading, 0, sizeAt(7)),
        shapeCell(kind, shading, 0, Number((answerScale + 0.06).toFixed(2))),
        shapeCell(kind, shading, 0, Number((answerScale - 0.12).toFixed(2))),
        // Right size, wrong shading: did they track size or shading?
        shapeCell(
          kind,
          shading === 'filled' ? 'outline' : 'filled',
          0,
          answerScale
        ),
        shapeCell(kind, shading, 0, sizeAt(6)),
        shapeCell(kind, shading, 0, Number((answerScale + 0.12).toFixed(2))),
      ],
      5
    )
    return { cells, answer, distractors }
  },
}

/** The shape family steps through a progression while shading holds constant. */
const shapeProgression: RuleSpec = {
  name: 'shape-progression',
  minRung: 2,
  build: random => {
    const series: ShapeKind[] = ['triangle', 'square', 'hexagon', 'circle']
    const shading = pick(random, SHADINGS)
    const cells: Cell[] = []
    for (let i = 0; i < 8; i += 1)
      cells.push(shapeCell(series[i % series.length] as ShapeKind, shading))

    const answerKind = series[8 % series.length] as ShapeKind
    const answer = shapeCell(answerKind, shading)

    const distractors = takeDistinct(
      answer,
      [
        shapeCell(series[7 % series.length] as ShapeKind, shading),
        shapeCell(series[(8 + 1) % series.length] as ShapeKind, shading),
        shapeCell(answerKind, shading === 'filled' ? 'outline' : 'filled'),
        shapeCell('star5', shading),
        shapeCell('diamond', shading),
        shapeCell(series[(8 + 2) % series.length] as ShapeKind, shading),
      ],
      5
    )
    return { cells, answer, distractors }
  },
}

/**
 * Row-wise set logic on dot grids: column C is A op B, cell by cell.
 *
 * The hardest family in the vocabulary and the one that most separates takers, because the
 * operator itself has to be inferred from two complete rows before it can be applied to
 * the third.
 */
const setLogic: RuleSpec = {
  name: 'set-logic',
  minRung: 8,
  build: random => {
    const size = 3
    const total = size * size
    const op = pick(random, ['and', 'or', 'xor'] as const)
    const randomMask = () => {
      const cellsOn: number[] = []
      for (let i = 0; i < total; i += 1) if (random() > 0.55) cellsOn.push(i)
      return cellsOn
    }
    const apply = (a: number[], b: number[]): number[] => {
      const setA = new Set(a)
      const setB = new Set(b)
      const out: number[] = []
      for (let i = 0; i < total; i += 1) {
        const inA = setA.has(i)
        const inB = setB.has(i)
        const on =
          op === 'and' ? inA && inB : op === 'or' ? inA || inB : inA !== inB
        if (on) out.push(i)
      }
      return out
    }

    const rows = [0, 1, 2].map(() => {
      const a = randomMask()
      const b = randomMask()
      return [a, b, apply(a, b)]
    })

    const cells: Cell[] = []
    for (let row = 0; row < 3; row += 1)
      for (let col = 0; col < 3; col += 1) {
        if (row === 2 && col === 2) continue
        cells.push({
          type: 'dotgrid',
          size,
          filled: rows[row]?.[col] as number[],
        })
      }

    const answerFilled = rows[2]?.[2] as number[]
    const answer: Cell = { type: 'dotgrid', size, filled: answerFilled }

    const a = rows[2]?.[0] as number[]
    const b = rows[2]?.[1] as number[]
    const otherOps = (['and', 'or', 'xor'] as const).filter(
      candidate => candidate !== op
    )
    const withOp = (which: 'and' | 'or' | 'xor'): number[] => {
      const setA = new Set(a)
      const setB = new Set(b)
      const out: number[] = []
      for (let i = 0; i < total; i += 1) {
        const inA = setA.has(i)
        const inB = setB.has(i)
        const on =
          which === 'and'
            ? inA && inB
            : which === 'or'
              ? inA || inB
              : inA !== inB
        if (on) out.push(i)
      }
      return out
    }

    const flipOne = (base: number[], salt: number): number[] => {
      const set = new Set(base)
      const target = (salt * 3 + 1) % total
      if (set.has(target)) set.delete(target)
      else set.add(target)
      return Array.from(set)
    }

    const distractors = takeDistinct(
      answer,
      [
        // The other two operators: wrong for a statable reason.
        {
          type: 'dotgrid',
          size,
          filled: withOp(otherOps[0] as 'and' | 'or' | 'xor'),
        },
        {
          type: 'dotgrid',
          size,
          filled: withOp(otherOps[1] as 'and' | 'or' | 'xor'),
        },
        // Right operator, one cell off.
        { type: 'dotgrid', size, filled: flipOne(answerFilled, 1) },
        { type: 'dotgrid', size, filled: flipOne(answerFilled, 2) },
        { type: 'dotgrid', size, filled: flipOne(answerFilled, 3) },
        // Operands echoed back, a common wrong instinct.
        { type: 'dotgrid', size, filled: a },
        { type: 'dotgrid', size, filled: b },
      ],
      5
    )
    return { cells, answer, distractors }
  },
}

export const RULES: readonly RuleSpec[] = [
  shadingCycle,
  countSeries,
  shapeProgression,
  rotation,
  sizeScale,
  setLogic,
]

export function rulesForRung(rung: number): RuleSpec[] {
  const eligible = RULES.filter(rule => rule.minRung <= rung)
  return eligible.length ? eligible : [shadingCycle]
}

export { rng }
