import { describe, expect, it } from 'vitest'

import type { ClientItem, ClientLink } from '@/lib/whiteboard/types'
import {
  buildExportPreview,
  clientToContextItem,
  selectExportInput,
} from '@/lib/whiteboard/visible'

/**
 * `visible.ts` on its own. Whether it agrees with `loadAgentVisible` is the parity suite's
 * job (tests/api/whiteboard-export-parity.test.ts); this pins the conversions and the edges
 * that are cheap to state without a database.
 */

let n = 0
const hex = () => (++n).toString(16).padStart(24, '0')

function item(overrides: Partial<ClientItem> = {}): ClientItem {
  return {
    _id: hex(),
    form: 'text',
    meaning: null,
    status: null,
    title: `Card ${n}`,
    body: '',
    todos: [],
    shape: null,
    ink: null,
    parentId: null,
    x: 0,
    y: 0,
    width: 200,
    height: 100,
    z: 1,
    tags: [],
    when: null,
    targetBy: null,
    includeInAi: true,
    createdAt: '2025-03-14T17:30:00.000Z',
    updatedAt: '2025-03-14T17:30:00.000Z',
    ...overrides,
  }
}

const linkOf = (from: string, to: string, label = 'x'): ClientLink => ({
  _id: hex(),
  from,
  to,
  label,
  fromHandle: null,
  toHandle: null,
})

describe('clientToContextItem', () => {
  it('turns calendar days into UTC midnight and stamps into instants', () => {
    const out = clientToContextItem(
      item({ when: '2025-03-15', targetBy: '2026-06-30' })
    )
    expect(out.when?.toISOString()).toBe('2025-03-15T00:00:00.000Z')
    expect(out.targetBy?.toISOString()).toBe('2026-06-30T00:00:00.000Z')
    expect(out.createdAt.toISOString()).toBe('2025-03-14T17:30:00.000Z')
  })

  it('keeps an ink bbox and never the points (D27)', () => {
    const bbox = { minX: 0, minY: 0, maxX: 4, maxY: 3 }
    const out = clientToContextItem(
      item({ form: 'ink', ink: { points: [[4, 3, 0.5]], bbox } })
    )
    expect(out.inkBBox).toEqual(bbox)
    expect(JSON.stringify(out)).not.toContain('points')
  })
})

describe('selectExportInput', () => {
  it('a hidden board exports nothing and counts everything on it', () => {
    const items = [item(), item(), item({ includeInAi: false })]
    const out = selectExportInput(
      { items, links: [], visible: false },
      { kind: 'all' }
    )
    expect(out).toMatchObject({ scopeHidden: true, excludedCount: 3 })
    expect(out.input.items).toEqual([])
  })

  it('a parent that is not on the board hides the child rather than unframing it', () => {
    const orphan = item({ parentId: hex() })
    const out = selectExportInput(
      { items: [orphan], links: [], visible: true },
      { kind: 'all' }
    )
    expect(out.input.items).toEqual([])
    expect(out.excludedCount).toBe(1)
  })

  it('a link into a hidden card is dropped, and the card is not a neighbour', () => {
    const shown = item({ title: 'Shown' })
    const other = item({ title: 'Other' })
    const off = item({ title: 'Off', includeInAi: false })
    const out = selectExportInput(
      {
        items: [shown, other, off],
        links: [linkOf(shown._id, other._id), linkOf(shown._id, off._id)],
        visible: true,
      },
      { kind: 'selection', ids: [shown._id] }
    )
    expect(out.input.neighbours.map(i => i.title)).toEqual(['Other'])
    expect(out.input.links).toHaveLength(1)
  })

  it('a selection matches ids case-insensitively and ignores malformed ones', () => {
    const a = item()
    const out = selectExportInput(
      { items: [a], links: [], visible: true },
      { kind: 'selection', ids: [a._id.toUpperCase(), 'nope'] }
    )
    expect(out.input.items.map(i => i.id)).toEqual([a._id])
  })
})

describe('buildExportPreview', () => {
  it('follows an edit the moment the board data changes', () => {
    const card = item({ title: 'Before' })
    const board = { items: [card], links: [], visible: true }
    expect(buildExportPreview(board, { kind: 'all' }).markdown).toContain(
      'Before'
    )
    const edited = { ...board, items: [{ ...card, title: 'After' }] }
    const after = buildExportPreview(edited, { kind: 'all' }).markdown
    expect(after).toContain('After')
    expect(after).not.toContain('Before')
  })
})
