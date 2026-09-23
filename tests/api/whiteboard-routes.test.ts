import { MongoMemoryServer } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import { NextRequest } from 'next/server'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { getAuthCookieName, makeAuthToken } from '@/lib/auth'
import type { BoardLine } from '@/lib/whiteboard/types'
import { WhiteboardItemModel } from '@/models/WhiteboardItem'
import { WhiteboardLinkModel } from '@/models/WhiteboardLink'

/**
 * The owner routes under `/api/admin/whiteboard`, called as Next would call them.
 *
 * The gate is ON here (no `REQUIRE_ADMIN=false`, unlike the blog suites): every handler is
 * asserted to refuse an anonymous caller, and every authorised call carries a real signed
 * cookie. `data.ts` has its own suite for the rules; this one is about the HTTP contract -
 * status codes, body caps, the streamed shapes and the no-store header on everything.
 */

type Handler = (
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) => Promise<Response>

let memory: MongoMemoryServer
const routes: Record<string, Record<string, Handler>> = {}
let cookie = ''

beforeAll(async () => {
  memory = await MongoMemoryServer.create()
  process.env.MONGODB_URI = memory.getUri()
  process.env.AUTH_SECRET = 'whiteboard-test-secret'
  delete process.env.REQUIRE_ADMIN
  await mongoose.connect(memory.getUri())
  await WhiteboardItemModel.syncIndexes()
  await WhiteboardLinkModel.syncIndexes()

  cookie = `${getAuthCookieName()}=${makeAuthToken(Date.now() + 3_600_000)}`
  routes.board = (await import('@/app/api/admin/whiteboard/route')) as never
  routes.items =
    (await import('@/app/api/admin/whiteboard/items/route')) as never
  routes.item =
    (await import('@/app/api/admin/whiteboard/items/[id]/route')) as never
  routes.links =
    (await import('@/app/api/admin/whiteboard/links/route')) as never
  routes.link =
    (await import('@/app/api/admin/whiteboard/links/[id]/route')) as never
  routes.context =
    (await import('@/app/api/admin/whiteboard/context/route')) as never
  routes.backup =
    (await import('@/app/api/admin/whiteboard/backup/route')) as never
  routes.restore =
    (await import('@/app/api/admin/whiteboard/restore/route')) as never
}, 120_000)

afterAll(async () => {
  await mongoose.disconnect()
  await memory.stop()
})

afterEach(async () => {
  await WhiteboardItemModel.deleteMany({})
  await WhiteboardLinkModel.deleteMany({})
})

const newId = () => new mongoose.Types.ObjectId().toHexString()

async function call(
  route: string,
  method: string,
  {
    body,
    raw,
    id = '',
    auth = true,
  }: { body?: unknown; raw?: string; id?: string; auth?: boolean } = {}
) {
  const handler = routes[route][method]
  const request = new NextRequest(`http://localhost/api/admin/whiteboard`, {
    method,
    headers: {
      ...(auth ? { cookie } : {}),
      ...(body !== undefined || raw !== undefined
        ? { 'content-type': 'application/json' }
        : {}),
    },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  })
  return handler(request, { params: Promise.resolve({ id }) })
}

async function createCard(overrides: Record<string, unknown> = {}) {
  const res = await call('items', 'POST', {
    body: { _id: newId(), form: 'text', title: 'Card', ...overrides },
  })
  expect(res.status).toBe(200)
  return (await res.json()).item as { _id: string; includeInAi: boolean }
}

const ENDPOINTS: [string, string, string][] = [
  ['GET /api/admin/whiteboard', 'board', 'GET'],
  ['POST /items', 'items', 'POST'],
  ['PATCH /items', 'items', 'PATCH'],
  ['PATCH /items/[id]', 'item', 'PATCH'],
  ['DELETE /items/[id]', 'item', 'DELETE'],
  ['POST /links', 'links', 'POST'],
  ['PATCH /links/[id]', 'link', 'PATCH'],
  ['DELETE /links/[id]', 'link', 'DELETE'],
  ['POST /context', 'context', 'POST'],
  ['GET /backup', 'backup', 'GET'],
  ['POST /restore', 'restore', 'POST'],
]

describe('owner gate and no-store on every route', () => {
  it.each(ENDPOINTS)(
    '%s is 401 without the cookie, with no-store',
    async (_name, route, method) => {
      const res = await call(route, method, {
        auth: false,
        id: newId(),
        body: method === 'GET' || method === 'DELETE' ? undefined : {},
      })
      expect(res.status).toBe(401)
      expect(res.headers.get('cache-control')).toBe('no-store, private')
    }
  )

  it.each(ENDPOINTS)(
    '%s answers the owner with no-store',
    async (_name, route, method) => {
      const res = await call(route, method, {
        id: newId(),
        body: method === 'GET' || method === 'DELETE' ? undefined : {},
      })
      expect(res.status).not.toBe(401)
      expect(res.headers.get('cache-control')).toBe('no-store, private')
    }
  )
})

describe('items', () => {
  it('creates, and a replay of the same id is a 200 with one document', async () => {
    const body = { _id: newId(), form: 'text', title: 'Once' }
    expect((await call('items', 'POST', { body })).status).toBe(200)
    expect((await call('items', 'POST', { body })).status).toBe(200)
    expect(await WhiteboardItemModel.countDocuments()).toBe(1)
  })

  it('rejects an invalid item with 400 and the reason', async () => {
    const res = await call('items', 'POST', {
      body: { _id: newId(), form: 'text', title: 'two\nlines' },
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'title must be a single line.' })
  })

  it('rejects ink over the point cap with 413', async () => {
    const points = Array.from({ length: 2_001 }, (_, i) => [i, i])
    const res = await call('items', 'POST', {
      body: { _id: newId(), form: 'ink', ink: { points } },
    })
    expect(res.status).toBe(413)
  })

  it('accepts a body over 16 KB and refuses one over 256 KB', async () => {
    const points = Array.from({ length: 2_000 }, (_, i) => [
      i + 0.123456,
      i + 0.654321,
      0.5,
    ])
    const ok = await call('items', 'POST', {
      body: { _id: newId(), form: 'ink', ink: { points } },
    })
    expect(ok.status).toBe(200)
    const huge = await call('items', 'POST', {
      raw: JSON.stringify({
        _id: newId(),
        form: 'text',
        body: 'x'.repeat(270_000),
      }),
    })
    expect(huge.status).toBe(413)
  })

  it('PATCH returns the whole resulting document, including a rule-8 flag', async () => {
    const frame = await createCard({ form: 'frame', includeInAi: false })
    const child = await createCard({ parentId: frame._id })
    const res = await call('item', 'PATCH', {
      id: child._id,
      body: { parentId: null, x: 900, y: 900 },
    })
    expect(res.status).toBe(200)
    expect((await res.json()).item).toMatchObject({
      _id: child._id,
      parentId: null,
      includeInAi: false,
      title: 'Card',
    })
  })

  it('PATCH to a missing item is 404; a bad keepChildrenPrivate is 400', async () => {
    expect(
      (await call('item', 'PATCH', { id: newId(), body: { title: 'x' } }))
        .status
    ).toBe(404)
    const card = await createCard()
    expect(
      (
        await call('item', 'PATCH', {
          id: card._id,
          body: { title: 'x', keepChildrenPrivate: 'yes' },
        })
      ).status
    ).toBe(400)
  })

  it('bulk PATCH names the bad entry and writes nothing', async () => {
    const a = await createCard()
    const res = await call('items', 'PATCH', {
      body: {
        updates: [
          { id: a._id, x: 50, y: 50, parentId: null },
          { id: newId(), x: 1, y: 1, parentId: null },
        ],
      },
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.index).toBe(1)
    expect(body.id).toMatch(/^[0-9a-f]{24}$/)
    expect((await WhiteboardItemModel.findById(a._id).lean())?.x).toBe(0)
  })

  it('DELETE returns the counts, then 404', async () => {
    const card = await createCard()
    const res = await call('item', 'DELETE', { id: card._id })
    expect(await res.json()).toEqual({ links: 0, children: 0 })
    expect((await call('item', 'DELETE', { id: card._id })).status).toBe(404)
  })
})

describe('links', () => {
  it('creates, replays, relabels and deletes', async () => {
    const a = await createCard()
    const b = await createCard()
    const body = { _id: newId(), from: a._id, to: b._id, label: 'because' }
    expect((await call('links', 'POST', { body })).status).toBe(200)
    expect((await call('links', 'POST', { body })).status).toBe(200)

    const relabel = await call('link', 'PATCH', {
      id: body._id,
      body: { label: 'led to' },
    })
    expect((await relabel.json()).link.label).toBe('led to')

    expect(
      (await call('link', 'PATCH', { id: newId(), body: { label: 'x' } }))
        .status
    ).toBe(404)
    expect((await call('link', 'DELETE', { id: body._id })).status).toBe(200)
  })
})

describe('GET /api/admin/whiteboard (streamed NDJSON)', () => {
  it('streams start, frames, items, links, end', async () => {
    const card = await createCard()
    const frame = await createCard({ form: 'frame', title: 'F' })
    await createCard({ parentId: frame._id })
    await call('links', 'POST', {
      body: { _id: newId(), from: card._id, to: frame._id, label: '' },
    })

    const res = await call('board', 'GET')
    expect(res.headers.get('content-type')).toContain('application/x-ndjson')
    const lines = (await res.text())
      .trim()
      .split('\n')
      .map(l => JSON.parse(l) as BoardLine)
    expect(lines.map(l => l.t)).toEqual([
      'start',
      'item',
      'item',
      'item',
      'link',
      'end',
    ])
    expect(lines[1].t === 'item' && lines[1].item.form).toBe('frame')
  })
})

describe('POST /context', () => {
  it('returns markdown, excludedCount and scopeHidden (D25)', async () => {
    const hidden = await createCard({ form: 'frame', includeInAi: false })
    await createCard({ parentId: hidden._id, title: 'Secret' })
    const shown = await createCard({ title: 'Shown' })
    const off = await createCard({ title: 'Off', includeInAi: false })

    const selection = await call('context', 'POST', {
      body: { scope: { kind: 'selection', ids: [shown._id, off._id] } },
    })
    const sel = await selection.json()
    expect(sel.excludedCount).toBe(1)
    expect(sel.scopeHidden).toBe(false)
    expect(sel.markdown).toContain('Shown')
    expect(sel.markdown).not.toContain('Off')

    const frame = await call('context', 'POST', {
      body: { scope: { kind: 'frame', id: hidden._id } },
    })
    expect(await frame.json()).toMatchObject({
      scopeHidden: true,
      markdown: '',
    })
  })

  it('rejects a bad scope', async () => {
    for (const scope of [
      { kind: 'nope' },
      { kind: 'filter', from: '2025-13-01' },
      { kind: 'selection', ids: ['x'] },
      { kind: 'selection', ids: Array.from({ length: 501 }, newId) },
    ])
      expect((await call('context', 'POST', { body: { scope } })).status).toBe(
        400
      )
  })
})

describe('backup and restore routes', () => {
  it('backs up as a download and restores through batches', async () => {
    const frame = await createCard({ form: 'frame', title: 'F' })
    const child = await createCard({ parentId: frame._id })
    await call('links', 'POST', {
      body: { _id: newId(), from: frame._id, to: child._id, label: 'has' },
    })

    const res = await call('backup', 'GET')
    expect(res.headers.get('content-disposition')).toMatch(
      /^attachment; filename="whiteboard-backup-\d{4}-\d{2}-\d{2}\.json"$/
    )
    const file = JSON.parse(await res.text())
    expect(file).toMatchObject({ version: 1 })
    expect(file.items).toHaveLength(2)

    await WhiteboardItemModel.deleteMany({})
    await WhiteboardLinkModel.deleteMany({})

    const dry = await call('restore', 'POST', {
      body: {
        dryRun: true,
        overwrite: false,
        items: file.items,
        links: file.links,
      },
    })
    expect(await dry.json()).toMatchObject({
      items: 2,
      links: 1,
      existing: 0,
      written: 0,
    })
    expect(await WhiteboardItemModel.countDocuments()).toBe(0)

    const real = await call('restore', 'POST', {
      body: {
        dryRun: false,
        overwrite: false,
        items: file.items,
        links: file.links,
      },
    })
    expect(real.status).toBe(200)
    expect(await WhiteboardItemModel.countDocuments()).toBe(2)
    expect(await WhiteboardLinkModel.countDocuments()).toBe(1)
  })

  it('an invalid batch is 400 naming the entry, with zero writes', async () => {
    const res = await call('restore', 'POST', {
      body: {
        dryRun: false,
        overwrite: false,
        items: [
          { _id: newId(), form: 'text' },
          { _id: 'bad', form: 'text' },
        ],
        links: [],
      },
    })
    expect(res.status).toBe(400)
    expect((await res.json()).index).toBe(1)
    expect(await WhiteboardItemModel.countDocuments()).toBe(0)
  })

  it('caps a batch at 2 MB', async () => {
    const res = await call('restore', 'POST', {
      raw: JSON.stringify({
        dryRun: true,
        overwrite: false,
        items: [{ body: 'x'.repeat(2 * 1024 * 1024) }],
        links: [],
      }),
    })
    expect(res.status).toBe(413)
  })
})
