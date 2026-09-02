import { describe, expect, it } from 'vitest'

import {
  cellDraws,
  cellKey,
  cellSvg,
  noHiddenLayers,
  perceptuallyDistinct,
  SIZE_STEPS,
  type Cell,
  type ShapeBody,
} from '@/lib/iq/items/v2/cell'

/**
 * The identity layer, which is where an unfair item comes from.
 *
 * Verification rejects an item when two of its six options collide, so the two directions
 * this code can be wrong are not symmetric:
 *
 * ```
 *   renders same, keys differently ──▶ verify passes ──▶ two right answers ship
 *   renders differently, keys same ──▶ verify rejects ──▶ a wasted retry
 * ```
 *
 * Only the first costs a taker a point for being right. So the tests below are mostly of the
 * form "these two DIFFERENT encodings must key the SAME", and where the direction is unclear
 * the assertion is that the key collapses.
 */

const body = (over: Partial<ShapeBody> = {}): ShapeBody => ({
  kind: 'square',
  shading: 'outline',
  rotationDeg: 0,
  sizeStep: 8,
  ...over,
})

describe('cellKey collapses encodings that render alike', () => {
  it('ignores which slot a shape was declared in', () => {
    // A square in the frame slot and the same square centred in the inner slot are one
    // picture. A key that told them apart would let a rule offer both as options.
    const asFrame: Cell = { frame: { class: 'frame', ...body() } }
    const asInner: Cell = { inner: { class: 'inner', anchor: 'center', ...body() } }
    expect(cellKey(asFrame)).toBe(cellKey(asInner))
  })

  it('reduces rotation by each shape symmetry', () => {
    const at = (kind: ShapeBody['kind'], deg: number): Cell => ({
      inner: { class: 'inner', anchor: 'center', ...body({ kind, rotationDeg: deg }) },
    })

    // A square repeats every 90 degrees, a triangle every 120, a hexagon every 60.
    expect(cellKey(at('square', 0))).toBe(cellKey(at('square', 90)))
    expect(cellKey(at('square', 0))).toBe(cellKey(at('square', 360)))
    expect(cellKey(at('triangle', 10))).toBe(cellKey(at('triangle', 130)))
    expect(cellKey(at('hexagon', 0))).toBe(cellKey(at('hexagon', 60)))

    // ...and does NOT collapse a rotation that genuinely changes the picture.
    expect(cellKey(at('square', 0))).not.toBe(cellKey(at('square', 45)))
  })

  it('ignores a circle rotation entirely', () => {
    // A circle is invariant under every rotation, so its angle must not reach the key at all
    // - otherwise a rule could offer the "same circle turned 30 degrees" as a wrong answer.
    const at = (deg: number): Cell => ({
      inner: { class: 'inner', anchor: 'center', ...body({ kind: 'circle', rotationDeg: deg }) },
    })
    expect(cellKey(at(0))).toBe(cellKey(at(37)))
    expect(cellKey(at(0))).toBe(cellKey(at(211)))
  })

  it('survives the heptagon non-integer symmetry period', () => {
    // 360/7 is 51.428..., so reducing an integer angle by it lands on values that differ in
    // the fifteenth decimal place. Bucketing is what stops that becoming two keys.
    const at = (deg: number): Cell => ({
      inner: { class: 'inner', anchor: 'center', ...body({ kind: 'heptagon', rotationDeg: deg }) },
    })
    expect(cellKey(at(0))).toBe(cellKey(at(Math.round(360 / 7))))
    expect(cellKey(at(0))).toBe(cellKey(at(360)))
  })

  it('treats a lattice fill order as insignificant', () => {
    const a: Cell = { field: { class: 'field', size: 3, filled: [0, 4, 8] } }
    const b: Cell = { field: { class: 'field', size: 3, filled: [8, 0, 4] } }
    expect(cellKey(a)).toBe(cellKey(b))
  })

  it('separates cells that really do differ', () => {
    const base: Cell = { inner: { class: 'inner', anchor: 'center', ...body() } }
    const moved: Cell = { inner: { class: 'inner', anchor: 'ne', ...body() } }
    const filled: Cell = {
      inner: { class: 'inner', anchor: 'center', ...body({ shading: 'filled' }) },
    }
    const bigger: Cell = { inner: { class: 'inner', anchor: 'center', ...body({ sizeStep: 12 }) } }

    const keys = new Set([cellKey(base), cellKey(moved), cellKey(filled), cellKey(bigger)])
    expect(keys.size).toBe(4)
  })

  it('gives the empty cell a stable key', () => {
    expect(cellKey({})).toBe(cellKey({}))
  })
})

describe('noHiddenLayers', () => {
  it('rejects a filled frame with anything inside it', () => {
    // The composite-era version of the duplicate-option bug: a filled frame paints over its
    // contents, so this cell is the same PICTURE for every possible inner shape while
    // keying differently for each - six options, one picture, five marked wrong.
    const hidden: Cell = {
      frame: { class: 'frame', ...body({ shading: 'filled', sizeStep: 12 }) },
      inner: { class: 'inner', anchor: 'center', ...body({ kind: 'circle', sizeStep: 2 }) },
    }
    expect(noHiddenLayers(hidden)).toBe(false)
  })

  it('accepts a filled inner shape inside an outline frame', () => {
    // Legitimate and common in the reference material. Containment rather than intersection
    // is what keeps this case allowed.
    const fine: Cell = {
      frame: { class: 'frame', ...body({ shading: 'outline', sizeStep: 12 }) },
      inner: { class: 'inner', anchor: 'center', ...body({ kind: 'circle', shading: 'filled', sizeStep: 2 }) },
    }
    expect(noHiddenLayers(fine)).toBe(true)
  })

  it('rejects a filled shape swallowing lattice dots', () => {
    const swallowed: Cell = {
      field: { class: 'field', size: 3, filled: [0, 1, 2, 3, 4, 5, 6, 7, 8] },
      inner: { class: 'inner', anchor: 'center', ...body({ shading: 'filled', sizeStep: 13 }) },
    }
    expect(noHiddenLayers(swallowed)).toBe(false)
  })

  it('accepts a plain single-element cell', () => {
    expect(noHiddenLayers({ inner: { class: 'inner', anchor: 'center', ...body() } })).toBe(true)
    expect(noHiddenLayers({})).toBe(true)
  })
})

describe('perceptuallyDistinct', () => {
  const inner = (over: Partial<ShapeBody> = {}, anchor: 'center' | 'ne' = 'center'): Cell => ({
    inner: { class: 'inner', anchor, ...body(over) },
  })

  it('calls one size step indistinguishable and two distinct', () => {
    // The floor exists because structural inequality is not enough: `cellKey` separates
    // adjacent size steps, and a panel built on that alone offers six options where two look
    // identical. Steps are 0.06 apart, so one step is 3 cell units - invisible at render size.
    expect(perceptuallyDistinct(inner({ sizeStep: 6 }), inner({ sizeStep: 7 }))).toBe(false)
    expect(perceptuallyDistinct(inner({ sizeStep: 6 }), inner({ sizeStep: 8 }))).toBe(true)
  })

  it('measures rotation the short way around the symmetry', () => {
    // A square at 5 and at 95 degrees is ten degrees apart, not ninety. Getting this wrong
    // would let a rule offer a near-identical rotation as a wrong answer.
    expect(perceptuallyDistinct(inner({ rotationDeg: 5 }), inner({ rotationDeg: 95 }))).toBe(false)
    expect(perceptuallyDistinct(inner({ rotationDeg: 0 }), inner({ rotationDeg: 10 }))).toBe(false)
    expect(perceptuallyDistinct(inner({ rotationDeg: 0 }), inner({ rotationDeg: 45 }))).toBe(true)
  })

  it('treats categorical changes as always visible', () => {
    expect(perceptuallyDistinct(inner(), inner({ kind: 'circle' }))).toBe(true)
    expect(perceptuallyDistinct(inner(), inner({ shading: 'filled' }))).toBe(true)
    expect(perceptuallyDistinct(inner(), inner({}, 'ne'))).toBe(true)
  })

  it('notices a slot appearing or disappearing', () => {
    const withMark: Cell = {
      ...inner(),
      mark: { class: 'mark', anchor: 'ne', ...body({ kind: 'circle', sizeStep: 1 }) },
    }
    expect(perceptuallyDistinct(inner(), withMark)).toBe(true)
  })

  it('sees a single lattice dot flip', () => {
    const a: Cell = { field: { class: 'field', size: 3, filled: [0, 1, 2] } }
    const b: Cell = { field: { class: 'field', size: 3, filled: [0, 1, 3] } }
    expect(perceptuallyDistinct(a, b)).toBe(true)
    expect(perceptuallyDistinct(a, a)).toBe(false)
  })

  it('sees a tally count change', () => {
    const a: Cell = { tally: { class: 'tally', count: 3, anchor: 'center' } }
    const b: Cell = { tally: { class: 'tally', count: 4, anchor: 'center' } }
    expect(perceptuallyDistinct(a, b)).toBe(true)
  })

  it('agrees with the key when a corner anchor clamps two sizes together', () => {
    /**
     * The interaction that is easy to get wrong.
     *
     * `radiusOf` clamps at off-centre anchors so a shape cannot spill into the next cell, so
     * the top few size steps all resolve to the same radius there. Comparing step INDICES
     * would report those as two steps apart - distinct - while they render identically, which
     * is the unsafe direction: two indistinguishable options on one panel.
     *
     * The two predicates must agree, so this asserts both.
     */
    const big = inner({ sizeStep: SIZE_STEPS.length - 1 }, 'ne')
    const alsoBig = inner({ sizeStep: SIZE_STEPS.length - 3 }, 'ne')

    expect(cellKey(big)).toBe(cellKey(alsoBig))
    expect(perceptuallyDistinct(big, alsoBig)).toBe(false)

    // ...and the clamp must not flatten the whole scale: small steps still differ there.
    const small = inner({ sizeStep: 0 }, 'ne')
    expect(perceptuallyDistinct(small, big)).toBe(true)
  })

  it('never calls a cell distinct from itself', () => {
    // The property that makes it safe to use in place of `cellKey` when de-duplicating: a
    // reflexively-distinct predicate would let the answer through as its own distractor.
    const cells: Cell[] = [
      {},
      inner(),
      { field: { class: 'field', size: 3, filled: [1, 5] } },
      { tally: { class: 'tally', count: 5, anchor: 's' } },
      { frame: { class: 'frame', ...body() }, inner: { class: 'inner', anchor: 'nw', ...body({ kind: 'star5', sizeStep: 2 }) } },
    ]
    for (const cell of cells) expect(perceptuallyDistinct(cell, cell)).toBe(false)
  })
})

describe('cellSvg', () => {
  it('namespaces a clip path per draw, not per cell', () => {
    // One composite can hold several half-shaded shapes, each emitting a clipPath. Duplicate
    // ids inside one SVG document silently cross-clip, which reads as a rendering glitch and
    // is actually a wrong answer on screen.
    const twoHalves: Cell = {
      frame: { class: 'frame', ...body({ shading: 'half', sizeStep: 12 }) },
      inner: { class: 'inner', anchor: 'center', ...body({ kind: 'circle', shading: 'half', sizeStep: 4 }) },
    }
    const svg = cellSvg(twoHalves, 'q1o2')
    const ids = svg.match(/id="h-[^"]+"/g) ?? []
    expect(ids.length).toBe(2)
    expect(new Set(ids).size).toBe(2)
  })

  it('emits literal hex, never a CSS variable', () => {
    // Several rules encode meaning in fill state, so a theme-reactive fill would change an
    // item's ANSWER rather than its appearance. Satori resolves no custom properties either.
    const svg = cellSvg(
      {
        frame: { class: 'frame', ...body() },
        field: { class: 'field', size: 3, filled: [0, 4] },
        tally: { class: 'tally', count: 3, anchor: 's' },
      },
      'x'
    )
    expect(svg).not.toMatch(/var\(--/)
    expect(svg).toMatch(/#[0-9a-f]{6}/i)
  })

  it('keeps every drawn coordinate inside the cell box', () => {
    // v1 shipped a bar strip that painted across its neighbours and over the `?` placeholder
    // at high counts, and nothing failed - SVG does not clip by default. Worth asserting for
    // the composites too, at the extremes of every table.
    const extremes: Cell[] = [
      { tally: { class: 'tally', count: 1, anchor: 'center' } },
      { tally: { class: 'tally', count: 7, anchor: 'center' } },
      { inner: { class: 'inner', anchor: 'nw', ...body({ sizeStep: SIZE_STEPS.length - 1 }) } },
      { inner: { class: 'inner', anchor: 'se', ...body({ sizeStep: SIZE_STEPS.length - 1 }) } },
    ]
    for (const cell of extremes) {
      for (const { draw } of cellDraws(cell)) {
        const box =
          draw.form === 'stroke'
            ? { x0: draw.cx - draw.w / 2, x1: draw.cx + draw.w / 2, y0: draw.cy - draw.h / 2, y1: draw.cy + draw.h / 2 }
            : { x0: draw.cx - draw.r, x1: draw.cx + draw.r, y0: draw.cy - draw.r, y1: draw.cy + draw.r }
        // A generous margin: a shape at a corner anchor legitimately overhangs a little, but
        // it must never reach the next cell, which starts 12 units past the edge.
        expect(box.x0, JSON.stringify(draw)).toBeGreaterThan(-12)
        expect(box.y0, JSON.stringify(draw)).toBeGreaterThan(-12)
        expect(box.x1, JSON.stringify(draw)).toBeLessThan(112)
        expect(box.y1, JSON.stringify(draw)).toBeLessThan(112)
      }
    }
  })
})
