import { barStripSvg, CELL, dotGridSvg, INK, shapeSvg } from '@/lib/iq/items/primitives'
import type { Cell, Item } from '@/lib/iq/items/types'

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

const GAP = 12

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

/** One cell at its own origin, boxed so the grid reads as a matrix rather than floating art. */
function framedCell(cell: Cell, x: number, y: number, uid: string, boxed: boolean): string {
  const frame = boxed
    ? `<rect x="0.75" y="0.75" width="${CELL - 1.5}" height="${CELL - 1.5}" fill="none" stroke="${INK}" stroke-width="1" opacity="0.28"/>`
    : ''
  return `<g transform="translate(${x} ${y})">${frame}${cellSvg(cell, uid)}</g>`
}

/**
 * The 3x3 matrix with the bottom-right cell replaced by a question mark.
 *
 * `role="img"` plus a title, because a matrix with no text alternative is invisible to a
 * screen reader - and while a visual reasoning test cannot be made fully non-visual, it can
 * at least announce what it is and how far along the taker is, rather than reading as an
 * empty region.
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
      parts.push(
        `<g transform="translate(${x} ${y})"><rect x="0.75" y="0.75" width="${CELL - 1.5}" height="${CELL - 1.5}" fill="none" stroke="${INK}" stroke-width="1.5" stroke-dasharray="5 4"/><text x="${CELL / 2}" y="${CELL / 2 + 14}" text-anchor="middle" font-size="42" font-weight="600" fill="${INK}">?</text></g>`
      )
      continue
    }
    parts.push(framedCell(item.cells[index] as Cell, x, y, `m${index}`, true))
  }

  return `<svg viewBox="0 0 ${width} ${width}" width="100%" role="img" aria-label="${label}" xmlns="http://www.w3.org/2000/svg">${parts.join('')}</svg>`
}

/** A single answer option, sized to sit in a tap target. */
export function renderOption(cell: Cell, uid: string): string {
  return `<svg viewBox="0 0 ${CELL} ${CELL}" width="100%" role="presentation" xmlns="http://www.w3.org/2000/svg">${cellSvg(cell, uid)}</svg>`
}
