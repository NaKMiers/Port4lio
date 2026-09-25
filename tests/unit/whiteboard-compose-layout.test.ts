import { describe, expect, it } from 'vitest'

import {
  CARD_WIDTHS,
  estimateCardHeight,
  layoutComposition,
  pickHandles,
  wrappedLines,
  type LayoutCard,
  type LayoutInput,
  type LayoutSection,
  type Rect,
} from '@/lib/whiteboard/compose-layout'

/**
 * The geometry behind `whiteboard_compose` (compose-layout.ts).
 *
 * ```
 *   estimate   more body / todos / tags ──▶ taller; body clamps at 6 lines like CardNode
 *   frames     no two top-level rects overlap, in any layout
 *   cards      inside their frame's padding box, and never on top of each other
 *   layouts    timeline chains frames r ──▶ l · mindmap spokes from a centre, both sides
 *   origin     the composition's top-left is exactly `origin`
 * ```
 */

const card = (ref: string, fields: Partial<LayoutCard> = {}): LayoutCard => ({
  ref,
  form: 'text',
  title: `Card ${ref}`,
  body: '',
  todos: [],
  tags: [],
  hasMeta: false,
  ...fields,
})

const section = (
  ref: string,
  count: number,
  fields: Partial<LayoutSection> = {}
): LayoutSection => ({
  ref,
  title: `Section ${ref}`,
  cards: Array.from({ length: count }, (_, index) =>
    card(`${ref}.${index}`, {
      body: 'A line of body.\n'.repeat(index % 4),
    })
  ),
  ...fields,
})

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.width &&
  b.x < a.x + a.width &&
  a.y < b.y + b.height &&
  b.y < a.y + a.height

function expectNoOverlap(rects: Rect[]) {
  for (let i = 0; i < rects.length; i += 1)
    for (let j = i + 1; j < rects.length; j += 1)
      expect(
        overlaps(rects[i], rects[j]),
        `${JSON.stringify(rects[i])} overlaps ${JSON.stringify(rects[j])}`
      ).toBe(false)
}

const input = (fields: Partial<LayoutInput>): LayoutInput => ({
  layout: 'columns',
  heading: null,
  sections: [section('a', 3), section('b', 5), section('c', 1)],
  origin: { x: 0, y: 0 },
  ...fields,
})

describe('estimateCardHeight', () => {
  it('grows with body, to-dos and tags', () => {
    const width = CARD_WIDTHS.normal
    const bare = estimateCardHeight(card('x', { hasMeta: true }), width)
    expect(
      estimateCardHeight(card('x', { body: 'one\ntwo\nthree' }), width)
    ).toBeGreaterThan(bare)
    expect(
      estimateCardHeight(
        card('x', { form: 'todo', todos: ['a', 'b', 'c', 'd', 'e'] }),
        width
      )
    ).toBeGreaterThan(
      estimateCardHeight(card('x', { form: 'todo', todos: ['a'] }), width)
    )
    expect(
      estimateCardHeight(card('x', { tags: ['alpha', 'beta'] }), width)
    ).toBeGreaterThan(bare)
  })

  it('stops growing past the 6-line body clamp CardNode renders', () => {
    const width = CARD_WIDTHS.normal
    const six = estimateCardHeight(
      card('x', { body: 'line\n'.repeat(7).trim() }),
      width
    )
    const sixty = estimateCardHeight(
      card('x', { body: 'line\n'.repeat(60).trim() }),
      width
    )
    expect(sixty).toBe(six)
  })

  it('a wider card wraps a long body onto fewer lines', () => {
    // Short enough to stay under the 6-line clamp at either width.
    const long = card('x', { body: 'word '.repeat(30) })
    expect(estimateCardHeight(long, CARD_WIDTHS.wide)).toBeLessThan(
      estimateCardHeight(long, CARD_WIDTHS.normal)
    )
  })

  it('a long to-do row wraps, so it budgets more than a short one', () => {
    // Pinned against CardNode's real type sizes (the reviewer's case): three 200-character
    // rows on a 240-wide card wrap to ~8 lines each and render at roughly 540px.
    const long = card('x', {
      form: 'todo',
      todos: ['x'.repeat(200), 'y'.repeat(200), 'z'.repeat(200)],
    })
    const short = card('x', { form: 'todo', todos: ['a', 'b', 'c'] })
    expect(estimateCardHeight(long, CARD_WIDTHS.normal)).toBeGreaterThanOrEqual(
      540
    )
    expect(estimateCardHeight(long, CARD_WIDTHS.normal)).toBeGreaterThan(
      estimateCardHeight(short, CARD_WIDTHS.normal) * 3
    )
  })

  it('a newline-only body still counts, as CardNode renders it', () => {
    expect(
      estimateCardHeight(
        card('x', { body: '\n\n', hasMeta: true }),
        CARD_WIDTHS.normal
      )
    ).toBeGreaterThan(
      estimateCardHeight(card('x', { hasMeta: true }), CARD_WIDTHS.normal)
    )
  })

  it('counts an empty line as a line, as pre-line whitespace renders it', () => {
    expect(wrappedLines('a\n\nb', 30)).toBe(3)
  })
})

describe('layoutComposition', () => {
  for (const layout of ['columns', 'grid', 'timeline', 'mindmap'] as const)
    it(`${layout}: no two top-level items overlap, and every card sits inside its frame`, () => {
      const result = layoutComposition(
        input({
          layout,
          heading: 'Plan',
          sections: [
            section('a', 3),
            section('b', 7, { columns: 3 }),
            section('c', 0),
            section('d', 4, { cardWidth: 'wide' }),
            section('e', 2),
          ],
        })
      )
      expectNoOverlap([
        ...result.frames,
        ...(result.heading ? [result.heading] : []),
      ])

      for (const frame of result.frames) {
        const cards = result.cards.filter(c => c.parentRef === frame.ref)
        expectNoOverlap(cards)
        for (const placed of cards) {
          expect(placed.x).toBeGreaterThanOrEqual(0)
          expect(placed.y).toBeGreaterThan(0)
          expect(placed.x + placed.width).toBeLessThanOrEqual(frame.width)
          expect(placed.y + placed.height).toBeLessThanOrEqual(frame.height)
        }
      }
    })

  it('puts the composition at origin, and the bounds cover every frame', () => {
    const origin = { x: 1800, y: -240 }
    for (const layout of ['columns', 'mindmap'] as const) {
      const result = layoutComposition(input({ layout, origin, heading: 'H' }))
      const rects = [...result.frames, result.heading!]
      expect(Math.min(...rects.map(r => r.x))).toBe(origin.x)
      expect(Math.min(...rects.map(r => r.y))).toBe(origin.y)
      for (const rect of rects) {
        expect(rect.x + rect.width).toBeLessThanOrEqual(
          result.bounds.x + result.bounds.width
        )
        expect(rect.y + rect.height).toBeLessThanOrEqual(
          result.bounds.y + result.bounds.height
        )
      }
    }
  })

  it('columns: frames side by side, top-aligned, in section order', () => {
    const { frames } = layoutComposition(input({ layout: 'columns' }))
    expect(frames.map(f => f.ref)).toEqual(['a', 'b', 'c'])
    expect(new Set(frames.map(f => f.y)).size).toBe(1)
    expect(frames[0].x).toBeLessThan(frames[1].x)
    expect(frames[1].x).toBeLessThan(frames[2].x)
  })

  it('grid: four sections make two rows of two', () => {
    const { frames } = layoutComposition(
      input({
        layout: 'grid',
        sections: ['a', 'b', 'c', 'd'].map(ref => section(ref, 2)),
      })
    )
    expect(frames[0].y).toBe(frames[1].y)
    expect(frames[2].y).toBeGreaterThan(frames[0].y)
    expect(frames[2].x).toBe(frames[0].x)
  })

  it('timeline: each phase points to the next, right side to left side', () => {
    const { autoLinks } = layoutComposition(input({ layout: 'timeline' }))
    expect(autoLinks).toEqual([
      { from: 'a', to: 'b', fromHandle: 'r', toHandle: 'l' },
      { from: 'b', to: 'c', fromHandle: 'r', toHandle: 'l' },
    ])
  })

  it('mindmap: a centre even without a heading, one spoke per section, on both sides', () => {
    const result = layoutComposition(
      input({
        layout: 'mindmap',
        heading: null,
        sections: ['a', 'b', 'c', 'd'].map(ref => section(ref, 2)),
      })
    )
    const centre = result.heading!
    expect(centre.ref).toBe('heading')
    expect(result.autoLinks.map(link => link.to)).toEqual(['a', 'c', 'b', 'd'])
    const right = result.frames.filter(f => f.x > centre.x + centre.width)
    const left = result.frames.filter(f => f.x + f.width < centre.x)
    expect(right.map(f => f.ref)).toEqual(['a', 'c'])
    expect(left.map(f => f.ref)).toEqual(['b', 'd'])
    for (const link of result.autoLinks)
      expect(link.fromHandle).toBe(
        right.some(f => f.ref === link.to) ? 'r' : 'l'
      )
  })

  it('a heading banner sits above the frames', () => {
    const result = layoutComposition(input({ heading: 'Roadmap' }))
    const heading = result.heading!
    for (const frame of result.frames)
      expect(frame.y).toBeGreaterThan(heading.y + heading.height)
  })

  it('a frame is at least as wide as its title needs', () => {
    const { frames } = layoutComposition(
      input({
        sections: [
          section('a', 1, { title: 'A very long section title '.repeat(3) }),
        ],
      })
    )
    expect(frames[0].width).toBeGreaterThan(CARD_WIDTHS.normal + 48)
  })
})

describe('pickHandles', () => {
  const box = (x: number, y: number): Rect => ({
    x,
    y,
    width: 100,
    height: 100,
  })

  it('leaves by the side facing the target', () => {
    expect(pickHandles(box(0, 0), box(400, 0))).toEqual(['r', 'l'])
    expect(pickHandles(box(400, 0), box(0, 0))).toEqual(['l', 'r'])
    expect(pickHandles(box(0, 0), box(0, 400))).toEqual(['b', 't'])
    expect(pickHandles(box(0, 400), box(0, 0))).toEqual(['t', 'b'])
  })
})
