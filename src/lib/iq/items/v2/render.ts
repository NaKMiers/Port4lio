import { boxOf, GAP, holeAt, svgDocument } from '@/lib/iq/items/frame'
import { CELL } from '@/lib/iq/items/primitives'
import { cellSvg, type Cell } from '@/lib/iq/items/v2/cell'
import type { LayoutSpec } from '@/lib/iq/items/v2/layout'
import type { Item } from '@/lib/iq/items/v2/generate'

/**
 * Item to SVG, layout-blind.
 *
 * v1's renderer hardcoded nine positions and called itself `renderMatrix`, which was accurate
 * only because there was one layout. Here the layout is data and the loop is one loop, so a
 * sequence and a matrix take the same code path - which is the property that stops the two
 * drifting apart as families are added.
 *
 * The box, hole and document markup come from `items/frame.ts`, shared with v1.
 */

function stemBox(layout: LayoutSpec): { width: number; height: number } {
  return {
    width: layout.cols * CELL + (layout.cols - 1) * GAP,
    height: layout.rows * CELL + (layout.rows - 1) * GAP,
  }
}

/**
 * The question body.
 *
 * Called a stem rather than a matrix because a 1x3 sequence is not a matrix, and naming it
 * after the most common case is how v1 ended up with a renderer that could only draw one
 * shape.
 */
export function renderStem(item: Item, label: string): string {
  const { layout } = item.profile
  const { width, height } = stemBox(layout)
  const parts: string[] = []

  for (let index = 0; index < layout.cols * layout.rows; index += 1) {
    const x = (index % layout.cols) * (CELL + GAP)
    const y = Math.floor(index / layout.cols) * (CELL + GAP)

    if (index === layout.holeIndex) {
      parts.push(holeAt(x, y))
      continue
    }
    parts.push(
      boxOf(cellSvg(item.cells[index] as Cell, `c${index}`), x, y, true)
    )
  }

  return svgDocument(width, height, parts.join(''), label)
}

/** A single answer option, sized to sit in a tap target. */
export function renderOption(cell: Cell, uid: string): string {
  return svgDocument(CELL, CELL, cellSvg(cell, uid))
}

/**
 * The stem's intrinsic width-to-height ratio.
 *
 * Sent to the client because it cannot be inferred there. A 3x3 matrix is square; a 1x3
 * sequence is roughly 4.5:1. The client wrapped the stem in a fixed `aspect-square` box,
 * which was correct for v1's single layout and letterboxes a sequence into a thin strip with
 * large dead bands above and below it.
 */
export function aspectOf(item: Item): number {
  const { width, height } = stemBox(item.profile.layout)
  return Number((width / height).toFixed(4))
}
