/**
 * The shape vocabulary. Every IQ item is built from these and nothing else.
 *
 * ```
 *   circle   square   triangle   star(4|5|6)   hexagon   diamond
 *     ○        □          △          ✦             ⬡         ◇
 *
 *   dot-grid (3x3 / 5x5)      bar-strip
 *     ○ ○ ○                     ▄ ▄ ▄
 *     ○ ● ○
 *     ○ ○ ○
 * ```
 *
 * ## Why this is code and not an image bank
 *
 * The reference test (testiq.vn) presents 26 questions that look like artwork but are, on
 * inspection, six geometric primitives under a handful of transformations. Generating them
 * has three properties a folder of PNGs cannot match:
 *
 * 1. **~2KB of inline SVG instead of ~200KB of raster.** Crisp at any zoom, no asset
 *    pipeline, nothing to upload.
 * 2. **No leaked answer key.** A fixed bank of 26 images is a fixed set of 26 answers, and
 *    once shared the test is worthless - which is why the reference site has to ask
 *    visitors not to share answers. Sampling from reviewed pools per rung removes the
 *    problem instead of pleading about it.
 * 3. **Deterministic.** A seed reproduces an item exactly, so a result page can re-render
 *    the test somebody actually sat, months later, with no stored images.
 *
 * The rule vocabulary follows Sandia / Wang-Su: element transformation plus row-wise
 * logic. That boundary is real and is respected in `rules.ts` - families outside it
 * (tessellation, free-form line overlay) are hand-authored, not faked with a rule.
 *
 * ## Colour is a correctness concern, not styling
 *
 * Literal hex only, never the `pp-*` CSS variables the rest of the site uses. Two reasons:
 * those variables only resolve inside `.portfolio-public-root`, and Satori (used for the
 * certificate card) resolves no custom properties at all. More importantly, several rules
 * encode meaning in fill state - a theme-reactive fill would change an item's *answer*,
 * which is a bug, not a skin.
 */

/** The reference palette: one stroke on white. Matches the source material. */
export const INK = '#2e8fae'

export const STROKE_WIDTH = 2

/** Every primitive draws inside a 100x100 box; the renderer tiles those into a matrix. */
export const CELL = 100

export type Shading = 'outline' | 'filled' | 'half'

export type ShapeKind =
  | 'circle'
  | 'square'
  | 'triangle'
  | 'diamond'
  | 'hexagon'
  | 'star4'
  | 'star5'
  | 'star6'

export const SHAPE_KINDS: readonly ShapeKind[] = [
  'circle',
  'square',
  'triangle',
  'diamond',
  'hexagon',
  'star4',
  'star5',
  'star6',
]

/** Star point counts, kept beside the kinds so a rule can step 4 -> 5 -> 6 as a series. */
export const STAR_POINTS: Record<'star4' | 'star5' | 'star6', number> = {
  star4: 4,
  star5: 5,
  star6: 6,
}

function polygonPoints(sides: number, radius: number, rotationDeg: number): string {
  const c = CELL / 2
  const offset = (rotationDeg * Math.PI) / 180 - Math.PI / 2
  return Array.from({ length: sides }, (_, i) => {
    const angle = offset + (i * 2 * Math.PI) / sides
    return `${(c + radius * Math.cos(angle)).toFixed(2)},${(c + radius * Math.sin(angle)).toFixed(2)}`
  }).join(' ')
}

/**
 * A star as a 2n-gon alternating between two radii.
 *
 * `inner = outer * 0.42` is what makes a 4-point star read as the sharp cross-star in the
 * reference rather than a fat pinwheel. It is tuned by eye against the source images; the
 * exact value is not meaningful beyond "spiky enough to be unmistakable".
 */
function starPoints(points: number, outer: number, rotationDeg: number): string {
  const c = CELL / 2
  const inner = outer * 0.42
  const offset = (rotationDeg * Math.PI) / 180 - Math.PI / 2
  return Array.from({ length: points * 2 }, (_, i) => {
    const radius = i % 2 === 0 ? outer : inner
    const angle = offset + (i * Math.PI) / points
    return `${(c + radius * Math.cos(angle)).toFixed(2)},${(c + radius * Math.sin(angle)).toFixed(2)}`
  }).join(' ')
}

function fillFor(shading: Shading): string {
  return shading === 'filled' ? INK : 'none'
}

/**
 * A half-shaded shape, done with a clip rather than two overlapping paths.
 *
 * The reference uses half-shading as a *rule dimension* (outline -> half -> filled is a
 * three-step cycle), so it has to be visually unambiguous at small sizes. A clipped
 * rectangle over the exact same geometry guarantees the silhouette is identical across all
 * three shadings, which is what makes the cycle readable as one shape changing state
 * rather than three different shapes.
 */
function halfOverlay(id: string, body: string): string {
  return `<clipPath id="${id}"><rect x="0" y="0" width="${CELL / 2}" height="${CELL}"/></clipPath>${body.replace('__FILL__', INK).replace('__CLIP__', ` clip-path="url(#${id})"`)}`
}

export type ShapeSpec = {
  kind: ShapeKind
  shading: Shading
  /** Degrees. Only meaningful for shapes without rotational symmetry at that step. */
  rotation?: number
  /** 0.35 - 1.0 of the cell. Used by the size-scale rule. */
  scale?: number
}

/**
 * One primitive as SVG children, positioned inside a 100x100 cell.
 *
 * `uid` namespaces any clip path, because a single item renders up to 14 cells into one
 * SVG document and duplicate ids would silently cross-clip.
 */
export function shapeSvg(spec: ShapeSpec, uid: string): string {
  const { kind, shading, rotation = 0, scale = 0.78 } = spec
  const radius = (CELL / 2) * scale
  const stroke = `stroke="${INK}" stroke-width="${STROKE_WIDTH}" stroke-linejoin="round"`
  const c = CELL / 2

  const geometry = ((): { outline: string; clipped: string } => {
    switch (kind) {
      case 'circle':
        return {
          outline: `<circle cx="${c}" cy="${c}" r="${radius}" fill="${fillFor(shading)}" ${stroke}/>`,
          clipped: `<circle cx="${c}" cy="${c}" r="${radius}" fill="__FILL__"__CLIP__/><circle cx="${c}" cy="${c}" r="${radius}" fill="none" ${stroke}/>`,
        }
      case 'square': {
        const s = radius * 1.7
        const x = c - s / 2
        return {
          outline: `<rect x="${x.toFixed(2)}" y="${x.toFixed(2)}" width="${s.toFixed(2)}" height="${s.toFixed(2)}" fill="${fillFor(shading)}" ${stroke} transform="rotate(${rotation} ${c} ${c})"/>`,
          clipped: `<rect x="${x.toFixed(2)}" y="${x.toFixed(2)}" width="${s.toFixed(2)}" height="${s.toFixed(2)}" fill="__FILL__"__CLIP__ transform="rotate(${rotation} ${c} ${c})"/><rect x="${x.toFixed(2)}" y="${x.toFixed(2)}" width="${s.toFixed(2)}" height="${s.toFixed(2)}" fill="none" ${stroke} transform="rotate(${rotation} ${c} ${c})"/>`,
        }
      }
      case 'triangle':
        return {
          outline: `<polygon points="${polygonPoints(3, radius, rotation)}" fill="${fillFor(shading)}" ${stroke}/>`,
          clipped: `<polygon points="${polygonPoints(3, radius, rotation)}" fill="__FILL__"__CLIP__/><polygon points="${polygonPoints(3, radius, rotation)}" fill="none" ${stroke}/>`,
        }
      case 'diamond':
        return {
          outline: `<polygon points="${polygonPoints(4, radius, rotation)}" fill="${fillFor(shading)}" ${stroke}/>`,
          clipped: `<polygon points="${polygonPoints(4, radius, rotation)}" fill="__FILL__"__CLIP__/><polygon points="${polygonPoints(4, radius, rotation)}" fill="none" ${stroke}/>`,
        }
      case 'hexagon':
        return {
          outline: `<polygon points="${polygonPoints(6, radius, rotation)}" fill="${fillFor(shading)}" ${stroke}/>`,
          clipped: `<polygon points="${polygonPoints(6, radius, rotation)}" fill="__FILL__"__CLIP__/><polygon points="${polygonPoints(6, radius, rotation)}" fill="none" ${stroke}/>`,
        }
      default: {
        const points = STAR_POINTS[kind as 'star4' | 'star5' | 'star6']
        return {
          outline: `<polygon points="${starPoints(points, radius, rotation)}" fill="${fillFor(shading)}" ${stroke}/>`,
          clipped: `<polygon points="${starPoints(points, radius, rotation)}" fill="__FILL__"__CLIP__/><polygon points="${starPoints(points, radius, rotation)}" fill="none" ${stroke}/>`,
        }
      }
    }
  })()

  if (shading !== 'half') return geometry.outline
  return halfOverlay(`h-${uid}`, geometry.clipped)
}

/**
 * An n-by-n grid of small circles, some filled.
 *
 * Its own primitive rather than a composition of `circle`, because the reference uses grids
 * as a *counting* and *position* medium: the rule operates on which cells are filled, not
 * on the circles themselves. Keeping it separate means a count rule can address
 * "filled cells" directly instead of inferring it from a bag of shapes.
 */
export function dotGridSvg(size: number, filled: readonly number[]): string {
  const gap = CELL / (size + 1)
  const r = Math.min(gap * 0.3, 7)
  const set = new Set(filled)
  const dots: string[] = []
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      const index = row * size + col
      const cx = gap * (col + 1)
      const cy = gap * (row + 1)
      dots.push(
        `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${r.toFixed(2)}" fill="${set.has(index) ? INK : 'none'}" stroke="${INK}" stroke-width="1.5"/>`
      )
    }
  }
  return dots.join('')
}

/**
 * The footprint every bar strip occupies, whatever its count.
 *
 * Fixed rather than proportional, and that is the point: if the strip grew with the count,
 * a wider block would BE the answer and nobody would have to count anything. Holding the
 * width constant and letting the bars thin out means the count is the only signal.
 */
const BAR_SPAN = CELL * 0.72

/**
 * A row of vertical bars, count-bearing. The reference uses these for tally-style series.
 *
 * The geometry is derived from the count rather than fixed. An earlier version used a
 * constant 8px bar and 6px gap, which fits up to 7 bars in a 100-unit cell and then silently
 * overflows: at 17 bars the strip was 232 units wide, so it started at x = -66 and painted
 * straight across its neighbours and over the `?` placeholder. The rendered matrix was
 * unreadable, and nothing failed - SVG has no clipping by default.
 *
 * Bars are clamped to a sane thickness so two bars do not render as slabs, and the whole
 * strip is centred on whatever it actually measures.
 */
export function barStripSvg(count: number): string {
  const slot = BAR_SPAN / count
  const width = Math.max(3, Math.min(10, slot * 0.6))
  const drawn = (count - 1) * slot + width
  const startX = (CELL - drawn) / 2
  const height = CELL * 0.5
  const y = (CELL - height) / 2
  return Array.from({ length: count }, (_, i) => {
    const x = startX + i * slot
    return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${width.toFixed(2)}" height="${height.toFixed(2)}" fill="${INK}"/>`
  }).join('')
}
