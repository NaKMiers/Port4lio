import { describe, expect, it } from 'vitest'

import {
  isNoOp,
  planRestore,
  remapSnapshot,
  type BoardSnapshot,
} from '@/components/whiteboard/history'
import type { ClientItem, ClientLink } from '@/lib/whiteboard/types'

/**
 * Undo/redo (D30). The plan is the whole of it: the stack in `useBoard` only decides which
 * snapshot to hand over, and every question that can be got wrong - what to re-create, what
 * to patch, which id a resurrected card comes back under, which links the server will take
 * care of by itself - is answered here.
 */

const item = (id: string, extra: Partial<ClientItem> = {}): ClientItem =>
  ({
    _id: id,
    form: 'text',
    meaning: null,
    status: null,
    title: '',
    body: '',
    todos: [],
    shape: null,
    ink: null,
    parentId: null,
    x: 0,
    y: 0,
    width: 240,
    height: 120,
    z: 1,
    tags: [],
    when: null,
    targetBy: null,
    includeInAi: true,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...extra,
  }) as ClientItem

const link = (
  id: string,
  from: string,
  to: string,
  label = ''
): ClientLink => ({
  _id: id,
  from,
  to,
  label,
  fromHandle: null,
  toHandle: null,
})

const board = (
  items: ClientItem[],
  links: ClientLink[] = []
): BoardSnapshot => ({
  items: Object.fromEntries(items.map(i => [i._id, i])),
  links: Object.fromEntries(links.map(l => [l._id, l])),
})

/** Ids the session has spent. A live id is never remapped; a deleted one always is. */
const deps = (dead: string[] = []) => {
  let n = 0
  return {
    isDead: (id: string) => dead.includes(id),
    newId: () => `new${++n}`,
  }
}

describe('planRestore', () => {
  it('patches only the fields that changed', () => {
    const before = board([item('A', { title: 'one', x: 10 })])
    const after = board([item('A', { title: 'two', x: 10 })])
    const plan = planRestore(after, before, deps())
    expect(plan.patchItems).toEqual([{ id: 'A', patch: { title: 'one' } }])
    expect(plan.createItems).toEqual([])
    expect(plan.deleteItems).toEqual([])
    expect(plan.next.items.A.title).toBe('one')
  })

  it('sees no change when only an untouched array is a different object', () => {
    const before = board([item('A', { tags: ['x'], todos: [] })])
    const after = board([item('A', { tags: ['x'], todos: [] })])
    expect(isNoOp(planRestore(after, before, deps()))).toBe(true)
  })

  it('undoes a create by deleting the card', () => {
    const plan = planRestore(
      board([item('A'), item('B')]),
      board([item('A')]),
      deps()
    )
    expect(plan.deleteItems).toEqual(['B'])
    expect(Object.keys(plan.next.items)).toEqual(['A'])
  })

  // R3-6: the id is spent, so the card comes back as a copy - with its fields, including
  // the privacy flag, and with the links it took with it.
  it('brings a deleted card back under a new id, hidden if it was hidden', () => {
    const before = board(
      [item('A'), item('B', { includeInAi: false, title: 'private' })],
      [link('L', 'A', 'B', 'because')]
    )
    const now = board([item('A')])
    const plan = planRestore(now, before, deps(['B', 'L']))

    expect(plan.createItems).toHaveLength(1)
    expect(plan.createItems[0]).toMatchObject({
      _id: 'new1',
      title: 'private',
      includeInAi: false,
    })
    expect(plan.createLinks).toEqual([
      expect.objectContaining({ _id: 'new2', from: 'A', to: 'new1' }),
    ])
    expect(plan.remap).toEqual(
      new Map([
        ['B', 'new1'],
        ['L', 'new2'],
      ])
    )
  })

  it('puts a frame back and its children into it', () => {
    const before = board([
      item('F', { form: 'frame', x: 100, y: 100 }),
      item('C', { parentId: 'F', x: 20, y: 20 }),
    ])
    // The frame was deleted: the child stayed, at absolute coordinates.
    const now = board([item('C', { parentId: null, x: 120, y: 120 })])
    const plan = planRestore(now, before, deps(['F']))

    expect(plan.createItems[0]._id).toBe('new1')
    expect(plan.patchItems).toEqual([
      { id: 'C', patch: { parentId: 'new1', x: 20, y: 20 } },
    ])
  })

  it('un-parents the children of a frame it deletes, as the delete action does', () => {
    const now = board([
      item('F', { form: 'frame', x: 100, y: 100 }),
      item('C', { parentId: 'F', x: 20, y: 20, includeInAi: false }),
    ])
    const target = board([item('C', { parentId: null, x: 120, y: 120 })])
    const plan = planRestore(now, target, deps())
    expect(plan.deleteItems).toEqual(['F'])
    expect(plan.unparent).toEqual([
      {
        frameId: 'F',
        children: [{ id: 'C', x: 120, y: 120, hidden: false }],
      },
    ])
  })

  it('leaves the links of a deleted card to the server', () => {
    const now = board(
      [item('A'), item('B')],
      [link('L', 'A', 'B'), link('M', 'A', 'A')]
    )
    const target = board([item('A')], [link('M', 'A', 'A')])
    const plan = planRestore(now, target, deps())
    expect(plan.deleteItems).toEqual(['B'])
    // L goes with B; only a link that outlives both its ends is deleted by name.
    expect(plan.deleteLinks).toEqual([])
  })

  it('deletes a link the snapshot does not have, and relabels one it does', () => {
    const now = board(
      [item('A'), item('B')],
      [link('L', 'A', 'B', 'now'), link('M', 'B', 'A')]
    )
    const target = board(
      [item('A'), item('B')],
      [link('L', 'A', 'B', 'before')]
    )
    const plan = planRestore(now, target, deps())
    expect(plan.patchLinks).toEqual([{ id: 'L', label: 'before' }])
    expect(plan.deleteLinks).toEqual(['M'])
  })

  // An id the queue has not spent was never deleted - a card the owner discarded after a
  // 4xx, say. It comes back as itself, and its POST is the same idempotent upsert as ever.
  it('keeps the id when the id is still live', () => {
    const target = board([item('A'), item('B')], [link('L', 'A', 'B')])
    const plan = planRestore(board([item('A')]), target, deps())
    expect(plan.createItems.map(i => i._id)).toEqual(['B'])
    expect(plan.createLinks.map(l => l._id)).toEqual(['L'])
    expect(plan.remap.size).toBe(0)
  })

  it('drops a link whose other end is not in the snapshot at all', () => {
    const target = board([item('A')], [link('L', 'A', 'gone')])
    const plan = planRestore(board([item('A')]), target, deps())
    expect(plan.createLinks).toEqual([])
    expect(plan.next.links).toEqual({})
  })
})

describe('remapSnapshot', () => {
  it('rewrites ids, parents and link ends, and keeps the object when nothing matches', () => {
    const snapshot = board(
      [item('F', { form: 'frame' }), item('C', { parentId: 'F' })],
      [link('L', 'C', 'F')]
    )
    const out = remapSnapshot(snapshot, new Map([['F', 'F2']]))
    expect(Object.keys(out.items).sort()).toEqual(['C', 'F2'])
    expect(out.items.C.parentId).toBe('F2')
    expect(out.links.L.to).toBe('F2')
    expect(remapSnapshot(snapshot, new Map())).toBe(snapshot)
  })
})
