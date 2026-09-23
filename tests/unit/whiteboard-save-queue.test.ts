import { describe, expect, it, vi } from 'vitest'

import {
  SaveQueue,
  type GroupResult,
  type SaveOp,
  type SendResult,
} from '@/components/whiteboard/save-queue'

/**
 * The save queue, driven by a fake clock and a fake network.
 *
 * Every rule here is one the design doc promises the owner: nothing lost silently, a retried
 * create is harmless, a child never races its frame, a deleted card never comes back.
 */

const A = 'a'.repeat(24)
const B = 'b'.repeat(24)
const F = 'f'.repeat(24)
const L = 'c'.repeat(24)

function harness(respond?: (op: SaveOp) => SendResult | Promise<SendResult>) {
  let clock = 0
  const timers: { at: number; fn: () => void; id: number }[] = []
  let timerId = 0
  const sent: SaveOp[] = []
  const pending: { op: SaveOp; resolve: (r: SendResult) => void }[] = []
  const saved: SaveOp[] = []
  const rejected: { op: SaveOp; id: string; error: string }[] = []
  const groups: { id: string; result: GroupResult }[] = []

  const queue = new SaveQueue(
    {
      send: op => {
        sent.push(op)
        if (respond) return Promise.resolve(respond(op))
        return new Promise(resolve => pending.push({ op, resolve }))
      },
      now: () => clock,
      setTimer: (fn, ms) => {
        const id = ++timerId
        timers.push({ at: clock + ms, fn, id })
        return id
      },
      clearTimer: handle => {
        const i = timers.findIndex(t => t.id === handle)
        if (i >= 0) timers.splice(i, 1)
      },
    },
    {
      onSaved: op => saved.push(op),
      onRejected: (op, id, error) => rejected.push({ op, id, error }),
      onGroupSettled: (id, result) => groups.push({ id, result }),
    }
  )

  const flush = () => new Promise(r => setTimeout(r, 0))
  const advance = async (ms: number) => {
    clock += ms
    for (const timer of [...timers].sort((a, b) => a.at - b.at))
      if (timer.at <= clock) {
        timers.splice(timers.indexOf(timer), 1)
        timer.fn()
      }
    await flush()
  }
  const resolveNext = async (result: SendResult = { ok: true }) => {
    const next = pending.shift()
    if (!next) throw new Error('nothing in flight')
    next.resolve(result)
    await flush()
    return next.op
  }

  return {
    queue,
    sent,
    pending,
    saved,
    rejected,
    groups,
    advance,
    resolveNext,
    flush,
  }
}

describe('ordering and dependencies', () => {
  it('sends an item create, then its edits, in order', async () => {
    const h = harness()
    h.queue.createItem(A, { _id: A, form: 'text' })
    await h.flush()
    h.queue.patchItem(A, { title: 'one' })
    await h.advance(600)
    expect(h.sent.map(op => op.type)).toEqual(['createItem'])
    await h.resolveNext()
    expect(h.sent.map(op => op.type)).toEqual(['createItem', 'patchItem'])
  })

  it('coalesces an edit into a create that has not been sent yet', async () => {
    const h = harness()
    h.queue.markPersisted([F])
    h.queue.setOnline(false)
    h.queue.createItem(A, { _id: A, form: 'text', parentId: F })
    h.queue.patchItem(A, { title: 'typed fast' })
    h.queue.setOnline(true)
    await h.advance(600)
    expect(h.sent).toEqual([
      {
        type: 'createItem',
        id: A,
        body: { _id: A, form: 'text', parentId: F, title: 'typed fast' },
      },
    ])
  })

  it('debounces patches ~600 ms and merges them', async () => {
    const h = harness()
    h.queue.markPersisted([A])
    h.queue.patchItem(A, { title: 'a' })
    await h.advance(300)
    h.queue.patchItem(A, { title: 'ab', body: 'x' })
    await h.advance(300)
    expect(h.sent).toHaveLength(0)
    await h.advance(300)
    expect(h.sent).toEqual([
      { type: 'patchItem', id: A, patch: { title: 'ab', body: 'x' } },
    ])
  })

  it('holds a link until both ends are created', async () => {
    const h = harness()
    h.queue.createItem(A, { _id: A, form: 'text' })
    h.queue.createItem(B, { _id: B, form: 'text' })
    h.queue.createLink({
      _id: L,
      from: A,
      to: B,
      label: '',
      fromHandle: null,
      toHandle: null,
    })
    await h.flush()
    expect(h.sent.map(op => op.type)).toEqual(['createItem', 'createItem'])
    await h.resolveNext()
    expect(h.sent.map(op => op.type)).not.toContain('createLink')
    await h.resolveNext()
    expect(h.sent.at(-1)?.type).toBe('createLink')
  })

  it('a child created in an unsaved frame waits for the frame (R3-3)', async () => {
    const h = harness()
    h.queue.createItem(F, { _id: F, form: 'frame' })
    h.queue.createItem(A, { _id: A, form: 'text', parentId: F })
    await h.flush()
    expect(h.sent.map(op => (op as { id: string }).id)).toEqual([F])
    await h.resolveNext()
    expect(h.sent.map(op => (op as { id: string }).id)).toEqual([F, A])
  })

  it('a PATCH that sets parentId waits for that frame too, bulk included', async () => {
    const h = harness()
    h.queue.markPersisted([A, B])
    h.queue.createItem(F, { _id: F, form: 'frame' })
    h.queue.patchItem(A, { parentId: F, x: 1, y: 1 }, { delay: 0 })
    h.queue.bulkMove([{ id: B, x: 2, y: 2, parentId: F }])
    await h.flush()
    expect(h.sent.map(op => op.type)).toEqual(['createItem'])
    await h.resolveNext()
    expect(h.sent.map(op => op.type).sort()).toEqual([
      'bulkMove',
      'createItem',
      'patchItem',
    ])
  })

  it('a bulk move holds every entry: a later single move lands after it', async () => {
    const h = harness()
    h.queue.markPersisted([A, B])
    h.queue.bulkMove([
      { id: A, x: 1, y: 1, parentId: null },
      { id: B, x: 2, y: 2, parentId: null },
    ])
    await h.flush()
    h.queue.patchItem(A, { x: 9, y: 9 }, { delay: 0 })
    await h.flush()
    expect(h.sent.map(op => op.type)).toEqual(['bulkMove'])
    await h.resolveNext()
    expect(h.sent.map(op => op.type)).toEqual(['bulkMove', 'patchItem'])
  })
})

describe('retries', () => {
  it('retries a network error and a 5xx with backoff', async () => {
    const h = harness()
    h.queue.markPersisted([A])
    h.queue.patchItem(A, { title: 'x' }, { delay: 0 })
    await h.flush()
    await h.resolveNext({ ok: false, status: 0, error: 'offline' })
    expect(h.queue.status().failing).toBe(1)
    await h.advance(999)
    expect(h.sent).toHaveLength(1)
    await h.advance(1)
    expect(h.sent).toHaveLength(2)
    await h.resolveNext({ ok: false, status: 503, error: 'down' })
    await h.advance(1_999)
    expect(h.sent).toHaveLength(2)
    await h.advance(1)
    expect(h.sent).toHaveLength(3)
    await h.resolveNext()
    expect(h.queue.status()).toMatchObject({ pending: 0, failing: 0 })
  })

  it('retryAll sends everything waiting on backoff now', async () => {
    const h = harness()
    h.queue.markPersisted([A])
    h.queue.patchItem(A, { title: 'x' }, { delay: 0 })
    await h.flush()
    await h.resolveNext({ ok: false, status: 0, error: 'offline' })
    h.queue.retryAll()
    await h.flush()
    expect(h.sent).toHaveLength(2)
  })

  it('offline: holds everything, then resumes on online', async () => {
    const h = harness()
    h.queue.markPersisted([A])
    h.queue.setOnline(false)
    h.queue.patchItem(A, { title: 'x' }, { delay: 0 })
    await h.advance(5_000)
    expect(h.sent).toHaveLength(0)
    h.queue.setOnline(true)
    await h.flush()
    expect(h.sent).toHaveLength(1)
  })
})

describe('permanent errors (4xx)', () => {
  it('a rejected patch leaves the queue and is reported, not retried', async () => {
    const h = harness()
    h.queue.markPersisted([A])
    h.queue.patchItem(A, { title: 'x' }, { delay: 0 })
    await h.flush()
    await h.resolveNext({
      ok: false,
      status: 400,
      error: 'title is over 200 characters.',
    })
    expect(h.rejected).toEqual([
      expect.objectContaining({
        id: A,
        error: 'title is over 200 characters.',
      }),
    ])
    await h.advance(60_000)
    expect(h.sent).toHaveLength(1)
    expect(h.queue.status().pending).toBe(0)
  })

  it('a rejected create parks; discard drops it AND the link waiting on it', async () => {
    const h = harness()
    h.queue.markPersisted([B])
    h.queue.createItem(A, { _id: A, form: 'text', title: 'bad' })
    h.queue.createLink({
      _id: L,
      from: A,
      to: B,
      label: '',
      fromHandle: null,
      toHandle: null,
    })
    await h.flush()
    await h.resolveNext({ ok: false, status: 400, error: 'nope' })
    expect(h.queue.status().pending).toBe(1) // the link, still waiting
    expect(h.queue.discard(A)).toEqual([L])
    await h.advance(60_000)
    expect(h.sent.map(op => op.type)).toEqual(['createItem'])
    expect(h.queue.status().pending).toBe(0)
  })

  it('editing a rejected create fixes it: the merged body goes out again', async () => {
    const h = harness()
    h.queue.createItem(A, { _id: A, form: 'text', title: 'x'.repeat(300) })
    await h.flush()
    await h.resolveNext({ ok: false, status: 400, error: 'too long' })
    h.queue.patchItem(A, { title: 'short' })
    await h.flush()
    expect(h.sent).toHaveLength(2)
    expect(h.sent[1]).toMatchObject({
      type: 'createItem',
      body: { title: 'short' },
    })
  })

  it('a 404 PATCH is discarded, not retried (R3-6)', async () => {
    const h = harness()
    h.queue.markPersisted([A])
    h.queue.patchItem(A, { title: 'x' }, { delay: 0 })
    await h.flush()
    await h.resolveNext({ ok: false, status: 404, error: 'Item not found.' })
    await h.advance(60_000)
    expect(h.sent).toHaveLength(1)
    expect(h.rejected).toHaveLength(0)
  })

  it('a rejected bulk marks the named entry and re-queues the rest (R3-15)', async () => {
    const h = harness()
    h.queue.markPersisted([A, B, F])
    h.queue.bulkMove([
      { id: A, x: 1, y: 1, parentId: null },
      { id: B, x: 2, y: 2, parentId: null },
      { id: F, x: 3, y: 3, parentId: null },
    ])
    await h.flush()
    await h.resolveNext({ ok: false, status: 400, error: 'bad entry', id: B })
    expect(h.rejected).toEqual([
      expect.objectContaining({ id: B, error: 'bad entry' }),
    ])
    await h.flush()
    expect(h.sent[1]).toEqual({
      type: 'bulkMove',
      entries: [
        { id: A, x: 1, y: 1, parentId: null },
        { id: F, x: 3, y: 3, parentId: null },
      ],
    })
  })
})

describe('delete (R3-6)', () => {
  it('drops pending edits, sends the delete after the create, and never re-sends the create', async () => {
    const h = harness()
    h.queue.createItem(A, { _id: A, form: 'text' })
    await h.flush() // create in flight
    h.queue.patchItem(A, { title: 'x' })
    h.queue.deleteItem(A)
    await h.resolveNext() // create lands
    await h.advance(1_000)
    expect(h.sent.map(op => op.type)).toEqual(['createItem', 'deleteItem'])
    await h.resolveNext()
    h.queue.createItem(A, { _id: A, form: 'text' })
    h.queue.patchItem(A, { title: 'again' })
    await h.advance(60_000)
    expect(h.sent).toHaveLength(2)
  })

  it('an in-flight create that fails after its delete is not retried', async () => {
    const h = harness()
    h.queue.createItem(A, { _id: A, form: 'text' })
    await h.flush()
    h.queue.deleteItem(A)
    await h.resolveNext({ ok: false, status: 0, error: 'lost' })
    await h.flush()
    // The server may have it (the response was lost), so the delete still goes out...
    expect(h.sent.map(op => op.type)).toEqual(['createItem', 'deleteItem'])
    await h.resolveNext({ ok: false, status: 404, error: 'Item not found.' })
    await h.advance(60_000)
    // ...and the create is never sent again.
    expect(h.sent.map(op => op.type)).toEqual(['createItem', 'deleteItem'])
  })

  it('a create that never left is dropped with its delete: no request at all', async () => {
    const h = harness()
    h.queue.setOnline(false)
    h.queue.createItem(A, { _id: A, form: 'text' })
    h.queue.deleteItem(A)
    h.queue.setOnline(true)
    await h.advance(60_000)
    expect(h.sent).toHaveLength(0)
  })

  it('drops queued link creates that touch the deleted item', async () => {
    const h = harness()
    h.queue.markPersisted([A])
    h.queue.createItem(B, { _id: B, form: 'text' })
    h.queue.createLink({
      _id: L,
      from: A,
      to: B,
      label: '',
      fromHandle: null,
      toHandle: null,
    })
    await h.flush() // B's create in flight, link waiting
    h.queue.deleteItem(A)
    await h.resolveNext()
    await h.flush()
    expect(h.sent.map(op => op.type)).toEqual(['createItem', 'deleteItem'])
  })

  it('removes a deleted item from a queued bulk move', async () => {
    const h = harness()
    h.queue.markPersisted([A, B])
    h.queue.setOnline(false)
    h.queue.bulkMove([
      { id: A, x: 1, y: 1, parentId: null },
      { id: B, x: 2, y: 2, parentId: null },
    ])
    h.queue.deleteItem(A)
    h.queue.setOnline(true)
    await h.flush()
    const bulk = h.sent.find(op => op.type === 'bulkMove')
    expect(bulk).toEqual({
      type: 'bulkMove',
      entries: [{ id: B, x: 2, y: 2, parentId: null }],
    })
  })
})

describe('links', () => {
  it('a label edit merges into a queued create; a later one is a debounced PATCH', async () => {
    const h = harness()
    h.queue.markPersisted([A, B])
    h.queue.setOnline(false)
    h.queue.createLink({
      _id: L,
      from: A,
      to: B,
      label: '',
      fromHandle: null,
      toHandle: null,
    })
    h.queue.patchLink(L, 'because')
    h.queue.setOnline(true)
    await h.flush()
    expect(h.sent[0]).toMatchObject({
      type: 'createLink',
      body: { label: 'because' },
    })
    await h.resolveNext()
    h.queue.patchLink(L, 'led to')
    await h.advance(600)
    expect(h.sent[1]).toEqual({ type: 'patchLink', id: L, label: 'led to' })
  })

  it('deleting an unsent link sends nothing', async () => {
    const h = harness()
    h.queue.setOnline(false)
    h.queue.markPersisted([A, B])
    h.queue.createLink({
      _id: L,
      from: A,
      to: B,
      label: '',
      fromHandle: null,
      toHandle: null,
    })
    h.queue.deleteLink(L)
    h.queue.setOnline(true)
    await h.flush()
    expect(h.sent).toHaveLength(0)
  })
})

describe('multi-select fan-out (DR11)', () => {
  it('one PATCH per item; a partial failure marks only the failed item', async () => {
    const h = harness(op =>
      op.type === 'patchItem' && op.id === B
        ? { ok: false, status: 400, error: 'bad' }
        : { ok: true }
    )
    h.queue.markPersisted([A, B, F])
    h.queue.openGroup('g1', ['skipped-child'])
    for (const id of [A, B, F])
      h.queue.patchItem(id, { meaning: 'goal' }, { delay: 0, group: 'g1' })
    h.queue.closeGroup('g1')
    await h.flush()
    await h.flush()
    expect(h.sent.filter(op => op.type === 'patchItem')).toHaveLength(3)
    expect(h.rejected.map(r => r.id)).toEqual([B])
    expect(h.groups).toEqual([
      {
        id: 'g1',
        result: { ok: [A, F], failed: [B], skipped: ['skipped-child'] },
      },
    ])
  })
})

describe('pendingFields', () => {
  it('names the fields with an unconfirmed change, for merging a server doc (R3-1)', () => {
    const h = harness()
    h.queue.markPersisted([A])
    h.queue.setOnline(false)
    h.queue.patchItem(A, { title: 'x', tags: [] })
    expect([...h.queue.pendingFields(A)].sort()).toEqual(['tags', 'title'])
  })
})

it('reports status on every change', async () => {
  const onStatus = vi.fn()
  const queue = new SaveQueue(
    { send: async () => ({ ok: true }) },
    { onStatus }
  )
  queue.markPersisted([A])
  queue.patchItem(A, { title: 'x' }, { delay: 0 })
  await new Promise(r => setTimeout(r, 0))
  expect(onStatus).toHaveBeenLastCalledWith(
    expect.objectContaining({ pending: 0, failing: 0 })
  )
})
