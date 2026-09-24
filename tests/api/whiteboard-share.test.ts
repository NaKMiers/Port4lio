import { MongoMemoryServer } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import { NextRequest } from 'next/server'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { getAuthCookieName, makeAuthToken } from '@/lib/auth'
import { SHARED_BOARD_MAX_ITEMS } from '@/lib/whiteboard/limits'
import type { BoardLine } from '@/lib/whiteboard/types'
import { RateLimitModel } from '@/models/RateLimit'
import { WhiteboardBoardModel } from '@/models/WhiteboardBoard'
import { WhiteboardItemModel } from '@/models/WhiteboardItem'
import { WhiteboardLinkModel } from '@/models/WhiteboardLink'
import { WhiteboardVocabModel } from '@/models/WhiteboardVocab'

/**
 * Share links (`/api/whiteboard/shared/<slug|id>/*`), called as Next would call them.
 *
 * ```
 *   owner PATCH /boards/<id> { share, slug } ──▶ the switch
 *   share 'off'  ──▶ every shared route 404s, by id and by slug
 *   share 'view' ──▶ GET streams the board; every write 403s and writes nothing
 *   share 'edit' ──▶ the owner's canvas writes, minus the AI switch
 * ```
 *
 * The handlers behind both doors are the same functions (canvas-routes.ts), so this suite is
 * about the door: who gets in, what they may do, and that turning the link off or down
 * stops the very next request.
 */

type Handler = (
  request: NextRequest,
  ctx: { params: Promise<Record<string, string>> }
) => Promise<Response>

let memory: MongoMemoryServer
const routes: Record<string, Record<string, Handler>> = {}
let cookie = ''
let BOARD = ''
let OTHER_BOARD = ''

beforeAll(async () => {
  memory = await MongoMemoryServer.create()
  process.env.MONGODB_URI = memory.getUri()
  process.env.AUTH_SECRET = 'whiteboard-share-secret'
  delete process.env.REQUIRE_ADMIN
  await mongoose.connect(memory.getUri())
  await WhiteboardItemModel.syncIndexes()
  await WhiteboardLinkModel.syncIndexes()
  // The slug's uniqueness is the index, not a read (patchBoard), so it must exist here.
  await WhiteboardBoardModel.syncIndexes()

  cookie = `${getAuthCookieName()}=${makeAuthToken(Date.now() + 3_600_000)}`
  routes.stream =
    (await import('@/app/api/whiteboard/shared/[board]/route')) as never
  routes.items =
    (await import('@/app/api/whiteboard/shared/[board]/items/route')) as never
  routes.item =
    (await import('@/app/api/whiteboard/shared/[board]/items/[id]/route')) as never
  routes.links =
    (await import('@/app/api/whiteboard/shared/[board]/links/route')) as never
  routes.link =
    (await import('@/app/api/whiteboard/shared/[board]/links/[id]/route')) as never
  routes.vocab =
    (await import('@/app/api/whiteboard/shared/[board]/vocab/route')) as never
  routes.boardId =
    (await import('@/app/api/admin/whiteboard/boards/[id]/route')) as never
}, 120_000)

afterAll(async () => {
  await mongoose.disconnect()
  await memory.stop()
})

// Fresh boards per test: the share switch is the thing under test, and a test that left a
// board on 'edit' must not hand the next one a door it never opened.
afterEach(async () => {
  await WhiteboardItemModel.deleteMany({})
  await WhiteboardLinkModel.deleteMany({})
  await WhiteboardBoardModel.deleteMany({})
  await RateLimitModel.deleteMany({})
})

async function makeBoards() {
  BOARD = String((await WhiteboardBoardModel.create({ title: 'Plan' }))._id)
  OTHER_BOARD = String(
    (await WhiteboardBoardModel.create({ title: 'Private' }))._id
  )
}

const newId = () => new mongoose.Types.ObjectId().toHexString()

async function share(body: Record<string, unknown>, board = BOARD) {
  const request = new NextRequest(
    `http://localhost/api/admin/whiteboard/boards/${board}`,
    {
      method: 'PATCH',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }
  )
  return routes.boardId.PATCH(request, {
    params: Promise.resolve({ id: board }),
  })
}

async function call(
  route: string,
  method: string,
  {
    key = BOARD,
    id = '',
    body,
    ip = '203.0.113.7',
  }: { key?: string; id?: string; body?: unknown; ip?: string } = {}
) {
  const request = new NextRequest(
    `http://localhost/api/whiteboard/shared/${key}`,
    {
      method,
      headers: {
        'x-forwarded-for': ip,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }
  )
  return routes[route][method](request, {
    params: Promise.resolve({ board: key, id }),
  })
}

/** Straight into the database, so a refused write can be told apart from a missing one. */
async function seedCard(board = BOARD, fields: Record<string, unknown> = {}) {
  const doc = await WhiteboardItemModel.create({
    _id: new mongoose.Types.ObjectId(),
    boardId: new mongoose.Types.ObjectId(board),
    form: 'text',
    title: 'Seed',
    x: 0,
    y: 0,
    ...fields,
  })
  return String(doc._id)
}

async function streamLines(res: Response): Promise<BoardLine[]> {
  return (await res.text())
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line) as BoardLine)
}

describe('the owner turns sharing on, names the link, and clears it', () => {
  it('a new board starts off, with no slug', async () => {
    await makeBoards()
    const res = await share({ title: 'Plan' })
    expect((await res.json()).board).toMatchObject({ share: 'off', slug: null })
  })

  it('sets share and slug in one PATCH, lowercased', async () => {
    await makeBoards()
    const res = await share({ share: 'view', slug: 'Q3-Plan' })
    expect(res.status).toBe(200)
    expect((await res.json()).board).toMatchObject({
      share: 'view',
      slug: 'q3-plan',
    })
  })

  it('refuses a slug another board has with 409, and keeps both boards as they were', async () => {
    await makeBoards()
    expect((await share({ slug: 'roadmap' })).status).toBe(200)
    const taken = await share({ slug: 'roadmap' }, OTHER_BOARD)
    expect(taken.status).toBe(409)
    expect((await taken.json()).error).toMatch(/already uses/)
    const other = await WhiteboardBoardModel.findById(OTHER_BOARD).lean()
    expect(other?.slug).toBeUndefined()
  })

  it('clearing a slug removes the field, so any number of boards can have none', async () => {
    await makeBoards()
    await share({ slug: 'first' })
    const cleared = await share({ slug: null })
    expect((await cleared.json()).board.slug).toBeNull()
    const raw = await WhiteboardBoardModel.findById(BOARD).lean()
    expect(raw && 'slug' in raw).toBe(false)
    // Both boards now have no slug; the partial index must not see that as a clash.
    await share({ slug: 'second' }, OTHER_BOARD)
    expect((await share({ slug: '' }, OTHER_BOARD)).status).toBe(200)
  })

  it('refuses a slug shaped like a board id, and an unknown share mode', async () => {
    await makeBoards()
    expect((await share({ slug: OTHER_BOARD })).status).toBe(400)
    expect((await share({ share: 'public' })).status).toBe(400)
  })
})

describe("share 'off': nothing is there", () => {
  it('404s every route by id and by slug, and says nothing about the board', async () => {
    await makeBoards()
    await share({ slug: 'secret-plan' })
    const card = await seedCard()
    for (const key of [BOARD, 'secret-plan']) {
      const res = await call('stream', 'GET', { key })
      expect(res.status).toBe(404)
      expect(await res.text()).not.toMatch(/Plan/)
      expect((await call('vocab', 'GET', { key })).status).toBe(404)
      expect(
        (
          await call('item', 'PATCH', {
            key,
            id: card,
            body: { title: 'Hacked' },
          })
        ).status
      ).toBe(404)
    }
    expect((await WhiteboardItemModel.findById(card).lean())?.title).toBe(
      'Seed'
    )
  })

  it('404s a key that names nothing, and one too long to be a slug', async () => {
    await makeBoards()
    expect((await call('stream', 'GET', { key: newId() })).status).toBe(404)
    expect((await call('stream', 'GET', { key: 'nope' })).status).toBe(404)
    expect((await call('stream', 'GET', { key: 'a'.repeat(200) })).status).toBe(
      404
    )
  })
})

describe("share 'view': look, don't touch", () => {
  it('streams the whole board by id and by slug (any case), hidden-from-AI cards included', async () => {
    await makeBoards()
    await share({ share: 'view', slug: 'plan' })
    await seedCard(BOARD, { title: 'Visible' })
    await seedCard(BOARD, { title: 'Hidden from AI', includeInAi: false })
    await seedCard(OTHER_BOARD, { title: 'Other board' })

    for (const key of [BOARD, 'plan', 'PLAN']) {
      const res = await call('stream', 'GET', { key })
      expect(res.status).toBe(200)
      expect(res.headers.get('Cache-Control')).toBe('no-store, private')
      const lines = await streamLines(res)
      const titles = lines
        .filter(line => line.t === 'item')
        .map(line => (line.t === 'item' ? line.item.title : ''))
      expect(titles.sort()).toEqual(['Hidden from AI', 'Visible'])
      expect(lines.at(-1)).toMatchObject({ t: 'end', items: 2 })
    }
  })

  it('refuses every write with 403 and writes nothing', async () => {
    await makeBoards()
    await share({ share: 'view' })
    const a = await seedCard()
    const b = await seedCard()
    const link = await WhiteboardLinkModel.create({
      _id: new mongoose.Types.ObjectId(),
      boardId: new mongoose.Types.ObjectId(BOARD),
      from: new mongoose.Types.ObjectId(a),
      to: new mongoose.Types.ObjectId(b),
      label: 'causes',
    })
    const linkId = String(link._id)

    const writes: [string, string, { id?: string; body?: unknown }][] = [
      ['items', 'POST', { body: { _id: newId(), form: 'text', title: 'X' } }],
      [
        'items',
        'PATCH',
        { body: { updates: [{ id: a, x: 9, y: 9, parentId: null }] } },
      ],
      ['item', 'PATCH', { id: a, body: { title: 'Changed' } }],
      ['item', 'DELETE', { id: a }],
      ['links', 'POST', { body: { _id: newId(), from: b, to: a, label: 'x' } }],
      ['link', 'PATCH', { id: linkId, body: { label: 'renamed' } }],
      ['link', 'DELETE', { id: linkId }],
    ]
    for (const [route, method, opts] of writes) {
      const res = await call(route, method, opts)
      expect(res.status, `${route} ${method}`).toBe(403)
      expect((await res.json()).error).toBe('This board is view only.')
    }

    expect(await WhiteboardItemModel.countDocuments({})).toBe(2)
    expect((await WhiteboardItemModel.findById(a).lean())?.title).toBe('Seed')
    expect((await WhiteboardLinkModel.findById(linkId).lean())?.label).toBe(
      'causes'
    )
  })

  it('serves the meanings list without the cross-board usage counts', async () => {
    await makeBoards()
    await share({ share: 'view' })
    const res = await call('vocab', 'GET')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.vocab.meanings.length).toBeGreaterThan(0)
    expect(body.usage).toBeUndefined()
  })

  it('an anonymous vocab read never writes: an unseeded list reads as the default', async () => {
    await makeBoards()
    await share({ share: 'view' })
    await WhiteboardVocabModel.deleteMany({})
    const res = await call('vocab', 'GET')
    expect(res.status).toBe(200)
    expect(
      (await res.json()).vocab.meanings.map((m: { key: string }) => m.key)
    ).toContain('goal')
    expect(await WhiteboardVocabModel.countDocuments({})).toBe(0)
  })
})

describe("share 'edit': anyone with the link edits", () => {
  it('creates, edits, moves and deletes cards and links through the link', async () => {
    await makeBoards()
    await share({ share: 'edit', slug: 'team-board' })
    const a = newId()
    const b = newId()

    for (const id of [a, b]) {
      const created = await call('items', 'POST', {
        key: 'team-board',
        body: { _id: id, form: 'text', title: `Card ${id.slice(-4)}` },
      })
      expect(created.status).toBe(200)
    }
    const saved = await WhiteboardItemModel.findById(a).lean()
    expect(String(saved?.boardId)).toBe(BOARD)

    const patched = await call('item', 'PATCH', {
      key: 'team-board',
      id: a,
      body: { title: 'Renamed' },
    })
    expect((await patched.json()).item.title).toBe('Renamed')

    const moved = await call('items', 'PATCH', {
      body: { updates: [{ id: b, x: 400, y: 120, parentId: null }] },
    })
    expect(moved.status).toBe(200)

    const linkId = newId()
    const link = await call('links', 'POST', {
      body: { _id: linkId, from: a, to: b, label: 'causes' },
    })
    expect(link.status).toBe(200)
    expect(
      (
        await call('link', 'PATCH', {
          id: linkId,
          body: { label: 'blocks' },
        })
      ).status
    ).toBe(200)
    expect((await call('link', 'DELETE', { id: linkId })).status).toBe(200)
    expect((await call('item', 'DELETE', { id: a })).status).toBe(200)
    expect(await WhiteboardItemModel.countDocuments({})).toBe(1)
  })

  it("cannot reach a card on another board through this board's link", async () => {
    await makeBoards()
    await share({ share: 'edit' })
    const private_ = await seedCard(OTHER_BOARD, { title: 'Private' })
    const patch = await call('item', 'PATCH', {
      id: private_,
      body: { title: 'Hacked' },
    })
    expect(patch.status).toBe(404)
    expect((await call('item', 'DELETE', { id: private_ })).status).toBe(404)
    expect((await WhiteboardItemModel.findById(private_).lean())?.title).toBe(
      'Private'
    )
  })

  it('never changes what agents can read: the AI switch is dropped, alone it is a 403', async () => {
    await makeBoards()
    await share({ share: 'edit' })
    const hidden = await seedCard(BOARD, { includeInAi: false })

    const alone = await call('item', 'PATCH', {
      id: hidden,
      body: { includeInAi: true },
    })
    expect(alone.status).toBe(403)

    const mixed = await call('item', 'PATCH', {
      id: hidden,
      body: { title: 'Edited', includeInAi: true },
    })
    expect(mixed.status).toBe(200)
    expect((await mixed.json()).item).toMatchObject({
      title: 'Edited',
      includeInAi: false,
    })
  })

  it('stops the next write the moment the owner turns the link down or off', async () => {
    await makeBoards()
    await share({ share: 'edit' })
    const card = await seedCard()
    const edit = (title: string) =>
      call('item', 'PATCH', { id: card, body: { title } })

    expect((await edit('One')).status).toBe(200)
    await share({ share: 'view' })
    expect((await edit('Two')).status).toBe(403)
    await share({ share: 'off' })
    expect((await edit('Three')).status).toBe(404)
    expect((await WhiteboardItemModel.findById(card).lean())?.title).toBe('One')
  })

  it('an old slug stops working after a rename; the id link keeps working', async () => {
    await makeBoards()
    await share({ share: 'view', slug: 'old-name' })
    await share({ slug: 'new-name' })
    expect((await call('stream', 'GET', { key: 'old-name' })).status).toBe(404)
    expect((await call('stream', 'GET', { key: 'new-name' })).status).toBe(200)
    expect((await call('stream', 'GET', { key: BOARD })).status).toBe(200)
  })

  it('rate-limits writes per caller with 429 and Retry-After', async () => {
    await makeBoards()
    await share({ share: 'edit' })
    const missing = newId()
    let last: Response | null = null
    // Cheap writes (a delete of nothing is a 404), from one address.
    for (let i = 0; i < 301; i++)
      last = await call('item', 'DELETE', { id: missing, ip: '198.51.100.1' })
    expect(last?.status).toBe(429)
    expect(Number(last?.headers.get('Retry-After'))).toBeGreaterThan(0)
    // Another caller has their own budget, and reads draw on a separate bucket.
    expect(
      (await call('item', 'DELETE', { id: missing, ip: '198.51.100.2' })).status
    ).toBe(404)
    expect((await call('stream', 'GET', { ip: '198.51.100.1' })).status).toBe(
      200
    )
  }, 60_000)
  it('stops a share link growing a board past the cap, but a replay still answers 200', async () => {
    await makeBoards()
    await share({ share: 'edit' })
    const boardId = new mongoose.Types.ObjectId(BOARD)
    const docs = Array.from({ length: SHARED_BOARD_MAX_ITEMS }, (_, i) => ({
      _id: new mongoose.Types.ObjectId(),
      boardId,
      form: 'text',
      title: `Filler ${i}`,
      x: 0,
      y: 0,
    }))
    await WhiteboardItemModel.insertMany(docs)

    const full = await call('items', 'POST', {
      body: { _id: newId(), form: 'text', title: 'One too many' },
    })
    expect(full.status).toBe(409)
    expect((await full.json()).error).toMatch(/full/)
    expect(await WhiteboardItemModel.countDocuments({ boardId })).toBe(
      SHARED_BOARD_MAX_ITEMS
    )

    // A retried create of an item that already landed is not a new item.
    const replay = await call('items', 'POST', {
      body: { _id: String(docs[0]._id), form: 'text', title: 'Filler 0' },
    })
    expect(replay.status).toBe(200)
  }, 60_000)

  it('rate-limits reads per caller, before the lookup, so unknown keys count too', async () => {
    await makeBoards()
    await share({ share: 'view' })
    let last: Response | null = null
    for (let i = 0; i < 121; i++)
      last = await call('vocab', 'GET', {
        key: i % 2 ? BOARD : newId(),
        ip: '198.51.100.9',
      })
    expect(last?.status).toBe(429)
    expect(Number(last?.headers.get('Retry-After'))).toBeGreaterThan(0)
    expect((await call('vocab', 'GET', { ip: '198.51.100.10' })).status).toBe(
      200
    )
  }, 60_000)
})
