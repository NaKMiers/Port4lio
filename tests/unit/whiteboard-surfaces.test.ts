import { describe, expect, it } from 'vitest'

import { BATCH_BYTES, planBatches } from '@/components/whiteboard/Backup'
import { simplifyStroke, strokePath } from '@/components/whiteboard/ink'
import { LIMITS, type InkPoint } from '@/lib/whiteboard/limits'

describe('restore batches (D21)', () => {
  const frame = (n: number) => ({ _id: `f${n}`, form: 'frame', title: 'F' })
  const card = (n: number, size = 10) => ({
    _id: `c${n}`,
    form: 'text',
    body: 'x'.repeat(size),
  })

  it('sends frames first, then items, then links', () => {
    const [only] = planBatches({
      items: [card(1), frame(1), card(2)],
      links: [{ _id: 'l1' }],
    })
    expect(only.items.map(i => (i as { _id: string })._id)).toEqual([
      'f1',
      'c1',
      'c2',
    ])
    expect(only.links).toHaveLength(1)
  })

  it('keeps every batch under ~2 MB', () => {
    const items = Array.from({ length: 30 }, (_, i) => card(i, 200_000))
    const batches = planBatches({ items, links: [] })
    expect(batches.length).toBeGreaterThan(2)
    for (const batch of batches)
      expect(
        new TextEncoder().encode(JSON.stringify(batch)).length
      ).toBeLessThanOrEqual(BATCH_BYTES + 1024)
    expect(batches.flatMap(b => b.items)).toHaveLength(30)
  })
})

describe('ink strokes (D27, D28)', () => {
  it('simplifies a straight line to its ends', () => {
    const line: InkPoint[] = Array.from({ length: 200 }, (_, i) => [i, i, 0.5])
    expect(simplifyStroke(line)).toEqual([
      [0, 0, 0.5],
      [199, 199, 0.5],
    ])
  })

  it('never exceeds the server point cap', () => {
    const scribble: InkPoint[] = Array.from({ length: 9000 }, (_, i) => [
      i * 3,
      (i % 2) * 40,
      0.5,
    ])
    expect(simplifyStroke(scribble).length).toBeLessThanOrEqual(
      LIMITS.inkPoints
    )
  })

  it('draws a closed SVG path', () => {
    expect(
      strokePath([
        [0, 0, 0.5],
        [10, 10, 0.5],
        [20, 0, 0.5],
      ])
    ).toMatch(/^M .* Z$/)
  })
})
