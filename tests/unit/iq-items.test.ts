import { describe, expect, it } from 'vitest'

import { ITEM_COUNT } from '@/lib/iq/items/config'
import { answerIndexFor, generateItem, generateTest, optionsFor } from '@/lib/iq/items/v1/generate'
import { renderMatrix, renderOption } from '@/lib/iq/items/v1/render'
import { CELL } from '@/lib/iq/items/primitives'
import { MAX_BARS } from '@/lib/iq/items/v1/rules'
import { cellKey } from '@/lib/iq/items/v1/types'
import { verifyItem } from '@/lib/iq/items/v1/verify'

/**
 * The generator's safety net.
 *
 * A hand-authored test gets read by a human before it ships. A generated one does not: a
 * broken item goes straight to a taker, who loses a point for being right and never finds
 * out why. These tests are the only thing standing in that gap, so they sweep many seeds
 * rather than sampling one.
 */

const SEEDS = Array.from({ length: 120 }, (_, i) => i * 1013 + 7)

describe('generateTest', () => {
  it('produces 26 items on a rising ladder for every seed', () => {
    for (const seed of SEEDS) {
      const test = generateTest(seed)
      expect(test).toHaveLength(ITEM_COUNT)
      expect(test.map(item => item.rung)).toEqual(
        Array.from({ length: ITEM_COUNT }, (_, i) => i + 1)
      )
    }
  })

  it('every item passes verification', () => {
    for (const seed of SEEDS) {
      for (const item of generateTest(seed)) {
        const result = verifyItem(item)
        expect(result.ok, `seed ${seed} rung ${item.rung} (${item.rule}): ${!result.ok && result.reason}`).toBe(true)
      }
    }
  })

  it('never offers two options that render identically', () => {
    // The failure this catches is invisible in code and obvious on screen: two choices
    // that look the same, one marked wrong. `cellKey` is structural, and `verify` also
    // normalises rotational symmetry so a square at 0 and at 90 count as one.
    for (const seed of SEEDS.slice(0, 40)) {
      const test = generateTest(seed)
      test.forEach((item, index) => {
        const options = optionsFor(item, seed, index)
        const keys = new Set(options.map(cellKey))
        expect(keys.size, `seed ${seed} item ${index} has duplicate options`).toBe(6)
      })
    }
  })

  /**
   * Bars have to stay countable, and inside their cell.
   *
   * Both halves of this were broken at once and neither threw. `count-series` ran a single
   * sequence across all nine cells, so the answer could need 18 bars; `barStripSvg` used a
   * fixed 8px bar and 6px gap, which fits seven in a 100-unit cell and then paints straight
   * past the edge - over the neighbouring cell and over the `?` placeholder. The rendered
   * item was unreadable, every option looked the same, and the test suite was green.
   */
  /**
   * Every rule family actually reaches a taker.
   *
   * This is the test that was missing. `count-series` built distractors from its own step
   * size, so when the step was 1 the pool collapsed to four distinct counts, verification
   * rejected the item, and the generator quietly retried with a different rule. The family
   * still "existed" - it just never shipped in its readable variant, and the only version
   * anyone ever saw was the wide-stepped one that ran off the end of the cell. Nothing
   * failed, because a rule that never generates breaks no assertion about the rules that do.
   */
  it('generates every rule family across the seed sweep', () => {
    const families = new Set<string>()
    for (const seed of SEEDS) {
      for (const item of generateTest(seed)) families.add(item.rule)
    }

    expect(Array.from(families).sort()).toEqual([
      'count-series',
      'rotation',
      'set-logic',
      'shading-cycle',
      'shape-progression',
      'size-scale',
    ])
  })

  it('never asks anyone to count more than MAX_BARS bars', () => {
    for (const seed of SEEDS) {
      for (const item of generateTest(seed)) {
        for (const cell of [...item.cells, item.answer, ...item.distractors]) {
          if (cell.type !== 'bars') continue
          expect(cell.count, `seed ${seed} rung ${item.rung}`).toBeGreaterThanOrEqual(1)
          expect(cell.count, `seed ${seed} rung ${item.rung}`).toBeLessThanOrEqual(MAX_BARS + 2)
        }
      }
    }
  })

  it('keeps every rendered bar inside its own cell', () => {
    // Read back out of the SVG rather than recomputing the geometry: the assertion has to
    // fail if the renderer's arithmetic is wrong, which a duplicate of that arithmetic
    // cannot do.
    for (const seed of SEEDS.slice(0, 40)) {
      for (const item of generateTest(seed)) {
        for (const cell of [...item.cells, item.answer, ...item.distractors]) {
          if (cell.type !== 'bars') continue
          const svg = renderOption(cell, 'bars-test')
          const rects = Array.from(svg.matchAll(/<rect x="([-\d.]+)"[^>]*width="([\d.]+)"/g))
          expect(rects.length).toBe(cell.count)
          for (const [, x, width] of rects) {
            expect(Number(x), `${cell.count} bars start off-cell`).toBeGreaterThanOrEqual(0)
            expect(Number(x) + Number(width), `${cell.count} bars run off-cell`).toBeLessThanOrEqual(CELL)
          }
        }
      }
    }
  })

  it('is deterministic - the same seed reproduces the same test exactly', () => {
    // The result page stores only a seed. If this drifts, someone reopening their result
    // sees a different test than the one they sat.
    for (const seed of SEEDS.slice(0, 20)) {
      const a = generateTest(seed)
      const b = generateTest(seed)
      expect(a.map(i => [i.rule, cellKey(i.answer), i.cells.map(cellKey)])).toEqual(
        b.map(i => [i.rule, cellKey(i.answer), i.cells.map(cellKey)])
      )
    }
  })

  it('different seeds produce different tests', () => {
    // The anti-leak property. If seeds collapsed to one test, a shared answer key would
    // work for everyone and the whole pool design would be decorative.
    const signatures = SEEDS.slice(0, 30).map(seed =>
      generateTest(seed)
        .map(item => cellKey(item.answer))
        .join('|')
    )
    expect(new Set(signatures).size).toBeGreaterThan(25)
  })

  it('the answer index is inside range and points at the real answer', () => {
    for (const seed of SEEDS.slice(0, 30)) {
      const test = generateTest(seed)
      test.forEach((item, index) => {
        const options = optionsFor(item, seed, index)
        const answerIndex = answerIndexFor(item, seed, index)
        expect(answerIndex).toBeGreaterThanOrEqual(0)
        expect(answerIndex).toBeLessThan(6)
        expect(cellKey(options[answerIndex]!)).toBe(cellKey(item.answer))
      })
    }
  })
})

describe('set-logic is unambiguous', () => {
  it('the given rows always determine exactly one operator, and the answer obeys it', () => {
    // Found by sweeping seeds, not by reading code: 1 in 89 set-logic items had first two
    // rows consistent with BOTH or and xor. The taker cannot tell which applies, so two of
    // the six options are defensible and one of them is scored wrong. An item that
    // punishes correct reasoning is worse than a hard one.
    const asSet = (cell: { type: string } & Record<string, unknown>) =>
      cell.type === 'dotgrid' ? new Set(cell.filled as number[]) : null
    const ops = {
      and: (a: Set<number>, b: Set<number>, i: number) => a.has(i) && b.has(i),
      or: (a: Set<number>, b: Set<number>, i: number) => a.has(i) || b.has(i),
      xor: (a: Set<number>, b: Set<number>, i: number) => a.has(i) !== b.has(i),
    }

    let checked = 0
    for (let seed = 1; seed <= 400; seed += 1) {
      const item = generateItem(seed, 20)
      if (item.rule !== 'set-logic') continue
      checked += 1

      const g = item.cells.map(cell => asSet(cell as never))
      const rows: [Set<number>, Set<number>, Set<number>][] = [
        [g[0]!, g[1]!, g[2]!],
        [g[3]!, g[4]!, g[5]!],
      ]
      const consistent = (Object.keys(ops) as (keyof typeof ops)[]).filter(op =>
        rows.every(([a, b, c]) =>
          Array.from({ length: 9 }, (_, i) => i).every(i => ops[op](a, b, i) === c.has(i))
        )
      )
      expect(consistent, `seed ${seed}: operator is not uniquely inferable`).toHaveLength(1)

      const op = consistent[0]!
      const answer = asSet(item.answer as never)!
      const ok = Array.from({ length: 9 }, (_, i) => i).every(
        i => ops[op](g[6]!, g[7]!, i) === answer.has(i)
      )
      expect(ok, `seed ${seed}: answer does not equal A ${op} B`).toBe(true)
    }

    expect(checked).toBeGreaterThan(50)
  })
})

describe('render', () => {
  it('emits literal hex, never a CSS variable', () => {
    // `pp-*` variables only resolve inside .portfolio-public-root and Satori resolves none
    // at all - but the real reason is that several rules encode meaning in fill state, so a
    // theme-reactive colour would change an item's ANSWER, not its appearance.
    const [item] = generateTest(42)
    const svg = renderMatrix(item!, 'question 1 of 26')
    expect(svg).not.toContain('var(--')
    expect(svg).not.toContain('currentColor')
    expect(svg).toContain('#2e8fae')
  })

  it('gives the matrix a text alternative', () => {
    const [item] = generateTest(42)
    const svg = renderMatrix(item!, 'question 1 of 26')
    expect(svg).toContain('role="img"')
    expect(svg).toContain('aria-label="question 1 of 26"')
  })

  it('renders every option shape without throwing', () => {
    for (const seed of SEEDS.slice(0, 20)) {
      generateTest(seed).forEach((item, index) => {
        optionsFor(item, seed, index).forEach((option, optionIndex) => {
          const svg = renderOption(option, `o${index}-${optionIndex}`)
          expect(svg.startsWith('<svg')).toBe(true)
        })
      })
    }
  })

  it('namespaces clip paths so half-shaded cells cannot cross-clip', () => {
    // One matrix renders up to nine cells into a single SVG document. Duplicate clip ids
    // would silently clip the wrong shape, which looks like a rendering glitch and is
    // actually a wrong answer on screen.
    const test = generateTest(7)
    const withHalf = test.find(item =>
      item.cells.some(cell => cell.type === 'shape' && cell.spec.shading === 'half')
    )
    if (!withHalf) return
    const svg = renderMatrix(withHalf, 'x')
    const ids = Array.from(svg.matchAll(/id="(h-[^"]+)"/g)).map(match => match[1])
    expect(new Set(ids).size).toBe(ids.length)
  })
})
