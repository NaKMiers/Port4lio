import { CELL, INK } from '@/lib/iq/items/primitives'

/**
 * The boxes an item is laid out in, independent of what goes inside them.
 *
 * ```
 *   ┌────┬────┬────┐
 *   │    │    │    │   ← boxOf(children, x, y)
 *   ├────┼────┼────┤
 *   │    │    │ ?  │   ← holeAt(x, y)
 *   └────┴────┴────┘
 * ```
 *
 * Shared across generator versions, and generic in the cell type on purpose: these helpers
 * take an already-rendered SVG children string, never a `Cell`. `Cell` is per-version - v1's
 * is a four-arm union, v2's is a slotted record - so a helper that knew about cells could
 * not be shared, and the alternative is two copies of the frame markup drifting apart. What
 * a box looks like is a presentation decision that should not fork just because the puzzle
 * vocabulary did.
 */

/** Space between boxes. Part of the rendered bytes, so v1's golden hashes pin it. */
export const GAP = 12

/**
 * One cell at its own origin, boxed so the grid reads as a matrix rather than floating art.
 *
 * The `boxed` flag exists because answer options are rendered without a frame - they already
 * sit in a bordered tap target supplied by the client, and a second border inside it reads
 * as part of the puzzle.
 */
export function boxOf(
  children: string,
  x: number,
  y: number,
  boxed: boolean
): string {
  const frame = boxed
    ? `<rect x="0.75" y="0.75" width="${CELL - 1.5}" height="${CELL - 1.5}" fill="none" stroke="${INK}" stroke-width="1" opacity="0.28"/>`
    : ''
  return `<g transform="translate(${x} ${y})">${frame}${children}</g>`
}

/**
 * The missing cell.
 *
 * Dashed rather than solid, and carrying a literal `?`, so it reads as "this is the one you
 * answer" rather than as an empty cell that might itself be the pattern. Several rules can
 * legitimately produce a blank cell, which is exactly why the hole cannot look blank.
 */
export function holeAt(x: number, y: number): string {
  return `<g transform="translate(${x} ${y})"><rect x="0.75" y="0.75" width="${CELL - 1.5}" height="${CELL - 1.5}" fill="none" stroke="${INK}" stroke-width="1.5" stroke-dasharray="5 4"/><text x="${CELL / 2}" y="${CELL / 2 + 14}" text-anchor="middle" font-size="42" font-weight="600" fill="${INK}">?</text></g>`
}

/**
 * The SVG document wrapper.
 *
 * `role="img"` plus a label, because a matrix with no text alternative is invisible to a
 * screen reader - and while a visual reasoning test cannot be made fully non-visual, it can
 * at least announce what it is and how far along the taker is, rather than reading as an
 * empty region.
 */
export function svgDocument(
  width: number,
  height: number,
  body: string,
  label?: string
): string {
  const a11y = label
    ? ` role="img" aria-label="${label}"`
    : ' role="presentation"'
  return `<svg viewBox="0 0 ${width} ${height}" width="100%"${a11y} xmlns="http://www.w3.org/2000/svg">${body}</svg>`
}
