import { getStroke } from 'perfect-freehand'

import { LIMITS, type InkPoint } from '@/lib/whiteboard/limits'

/**
 * Ink geometry: simplify a captured stroke before it is saved, and turn points into an SVG
 * path.
 *
 * ```
 *   pointer samples (hundreds) ──▶ drop points closer than 1.5px to the last kept one
 *                              ──▶ Ramer-Douglas-Peucker at 0.6px
 *                              ──▶ if still over 2,000 points, thin evenly to the cap
 *                              ──▶ saved; perfect-freehand draws the outline from them
 * ```
 *
 * The point cap (limits.ts) is a server 413, so a long scribble must be thinned here rather
 * than rejected there. Simplification also keeps a stroke's document well under the item
 * route's 256 KB body cap, and keeps the ink node's path cheap to recompute.
 */

export const INK_SIZE = 3.2

function distance(a: InkPoint, b: InkPoint) {
  return Math.hypot(a[0] - b[0], a[1] - b[1])
}

function perpendicular(p: InkPoint, a: InkPoint, b: InkPoint) {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const length = Math.hypot(dx, dy)
  if (length === 0) return distance(p, a)
  return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / length
}

function rdp(points: InkPoint[], epsilon: number): InkPoint[] {
  if (points.length < 3) return points
  let maxDistance = 0
  let index = 0
  const last = points.length - 1
  for (let i = 1; i < last; i++) {
    const d = perpendicular(points[i], points[0], points[last])
    if (d > maxDistance) {
      maxDistance = d
      index = i
    }
  }
  if (maxDistance <= epsilon) return [points[0], points[last]]
  const left = rdp(points.slice(0, index + 1), epsilon)
  const right = rdp(points.slice(index), epsilon)
  return [...left.slice(0, -1), ...right]
}

export function simplifyStroke(
  raw: InkPoint[],
  { minGap = 1.5, epsilon = 0.6, cap = LIMITS.inkPoints } = {}
): InkPoint[] {
  if (raw.length <= 2) return raw
  const spaced: InkPoint[] = [raw[0]]
  for (const point of raw.slice(1, -1))
    if (distance(point, spaced[spaced.length - 1]) >= minGap) spaced.push(point)
  spaced.push(raw[raw.length - 1])

  let out = rdp(spaced, epsilon)
  if (out.length > cap) {
    const step = (out.length - 1) / (cap - 1)
    out = Array.from({ length: cap }, (_, i) => out[Math.round(i * step)])
  }
  return out.map(([x, y, p]) => [
    Math.round(x * 10) / 10,
    Math.round(y * 10) / 10,
    Math.round(p * 100) / 100,
  ])
}

/** perfect-freehand outline as an SVG path `d`. */
export function strokePath(points: InkPoint[], size = INK_SIZE): string {
  const outline = getStroke(points, {
    size,
    thinning: 0.5,
    smoothing: 0.5,
    streamline: 0.5,
    simulatePressure: points.every(p => p[2] === 0.5),
  })
  if (outline.length === 0) return ''
  const d = outline.reduce(
    (acc, [x0, y0], i, arr) => {
      const [x1, y1] = arr[(i + 1) % arr.length]
      acc.push(
        x0.toFixed(1),
        y0.toFixed(1),
        ((x0 + x1) / 2).toFixed(1),
        ((y0 + y1) / 2).toFixed(1)
      )
      return acc
    },
    ['M', ...outline[0].map(v => v.toFixed(1)), 'Q']
  )
  return `${d.join(' ')} Z`
}
