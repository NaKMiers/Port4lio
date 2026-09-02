import { boxOf, GAP, holeAt, svgDocument } from '@/lib/iq/items/frame'
import { barStripSvg, CELL, dotGridSvg, shapeSvg } from '@/lib/iq/items/primitives'
import type { Cell, Item } from '@/lib/iq/items/v1/types'

/**
 * Item to SVG.
 *
 * ```
 *   MATRIX (3x3, last cell is a "?")        OPTION (single cell)
 *   ┌────┬────┬────┐
 *   │    │    │    │                        ┌────┐
 *   ├────┼────┼────┤                        │    │
 *   │    │    │    │                        └────┘
 *   ├────┼────┼────┤
 *   │    │    │ ?  │
 *   └────┴────┴────┘
 * ```
 *
 * Server-rendered as inline SVG. Two consequences worth stating: the item never exists as
 * a file anyone can enumerate, and it costs nothing in the client bundle. Both matter for a
 * test whose value depends on the answers not being trivially collectable.
 *
 * Colours are literal hex from `primitives.ts`, never `pp-*` variables. Several rules
 * encode meaning in fill state, so a theme-reactive fill would change an item's answer
 * rather than its appearance.
 */

function cellSvg(cell: Cell, uid: string): string {
  switch (cell.type) {
    case 'shape':
      return shapeSvg(cell.spec, uid)
    case 'dotgrid':
      return dotGridSvg(cell.size, cell.filled)
    case 'bars':
      return barStripSvg(cell.count)
    default:
      return ''
  }
}

/**
 * The 3x3 matrix with the bottom-right cell replaced by a question mark.
 *
 * The box, hole and document markup come from `items/frame.ts`, shared with v2 - they are
 * presentation decisions with no reason to fork just because the puzzle vocabulary did.
 * Every byte is unchanged from the inline versions this replaced, which is not a claim to
 * take on trust: `tests/unit/iq-generator-v1-frozen.test.ts` hashes the rendered output for
 * twenty seeds, so a single moved space fails the build.
 */
export function renderMatrix(item: Item, label: string): string {
  const width = CELL * 3 + GAP * 2
  const parts: string[] = []

  for (let index = 0; index < 9; index += 1) {
    const row = Math.floor(index / 3)
    const col = index % 3
    const x = col * (CELL + GAP)
    const y = row * (CELL + GAP)

    if (index === 8) {
      parts.push(holeAt(x, y))
      continue
    }
    parts.push(boxOf(cellSvg(item.cells[index] as Cell, `m${index}`), x, y, true))
  }

  return svgDocument(width, width, parts.join(''), label)
}

/** A single answer option, sized to sit in a tap target. */
export function renderOption(cell: Cell, uid: string): string {
  return svgDocument(CELL, CELL, cellSvg(cell, uid))
}
