import { MongoMemoryServer } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import { NextRequest } from 'next/server'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { getAuthCookieName, makeAuthToken } from '@/lib/auth'
import {
  makeUnlockToken,
  unlockCookieName,
} from '@/lib/whiteboard/share-password'
import { RateLimitModel } from '@/models/RateLimit'
import { WhiteboardBoardModel } from '@/models/WhiteboardBoard'
import { WhiteboardItemModel } from '@/models/WhiteboardItem'
import { WhiteboardLinkModel } from '@/models/WhiteboardLink'

/**
 * A password on a share link (WhiteboardBoard.ts, share-password.ts), called as Next would.
 *
 * ```
 *   owner PATCH { password, unlockTtl } ──▶ hash + a new access version
 *   visitor, no cookie ──▶ every shared route 401 { locked: true }, nothing written
 *   POST /unlock right ──▶ cookie ──▶ the routes answer as they would with no password
 *   password changed / removed ──▶ that cookie is nothing again, time left or not
 *   cookie older than the board's CURRENT ttl ──▶ nothing again
 * ```
 */

type Handler = (
  request: NextRequest,
  ctx: { params: Promise<Record<string, string>> }
) => Promise<Response>

let memory: MongoMemoryServer
const routes: Record<string, Record<string, Handler>> = {}
let owner = ''
let BOARD = ''
let OTHER = ''

beforeAll(async () => {
  memory = await MongoMemoryServer.create()
  process.env.MONGODB_URI = memory.getUri()
  process.env.AUTH_SECRET = 'whiteboard-share-password-secret'
  delete process.env.REQUIRE_ADMIN
  await mongoose.connect(memory.getUri())
  await WhiteboardItemModel.syncIndexes()
  await WhiteboardLinkModel.syncIndexes()
  await WhiteboardBoardModel.syncIndexes()

  owner = `${getAuthCookieName()}=${makeAuthToken(Date.now() + 3_600_000)}`
  routes.stream =
    (await import('@/app/api/whiteboard/shared/[board]/route')) as never
  routes.items =
    (await import('@/app/api/whiteboard/shared/[board]/items/route')) as never
  routes.vocab =
    (await import('@/app/api/whiteboard/shared/[board]/vocab/route')) as never
  routes.unlock =
    (await import('@/app/api/whiteboard/shared/[board]/unlock/route')) as never
  routes.boardId =
    (await import('@/app/api/admin/whiteboard/boards/[id]/route')) as never
  routes.password =
    (await import('@/app/api/admin/whiteboard/boards/[id]/password/route')) as never
}, 120_000)

afterAll(async () => {
  await mongoose.disconnect()
  await memory.stop()
})

afterEach(async () => {
  await WhiteboardItemModel.deleteMany({})
  await WhiteboardBoardModel.deleteMany({})
  await RateLimitModel.deleteMany({})
})

async function makeBoards() {
  BOARD = String(
    (await WhiteboardBoardModel.create({ title: 'Plan', share: 'edit' }))._id
  )
  OTHER = String(
    (await WhiteboardBoardModel.create({ title: 'Other', share: 'view' }))._id
  )
}

async function patch(body: Record<string, unknown>, board = BOARD) {
  const request = new NextRequest(
    `http://localhost/api/admin/whiteboard/boards/${board}`,
    {
      method: 'PATCH',
      headers: { cookie: owner, 'content-type': 'application/json' },
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
    body,
    cookie,
    ip = '203.0.113.20',
  }: { key?: string; body?: unknown; cookie?: string; ip?: string } = {}
) {
  const request = new NextRequest(
    `http://localhost/api/whiteboard/shared/${key}`,
    {
      method,
      headers: {
        'x-forwarded-for': ip,
        ...(cookie ? { cookie } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }
  )
  return routes[route][method](request, {
    params: Promise.resolve({ board: key }),
  })
}

/** Types the password; the `name=value` of the cookie it sets, or null. */
async function unlock(password: string, key = BOARD, ip?: string) {
  const res = await call('unlock', 'POST', { key, body: { password }, ip })
  const set = res.headers.get('set-cookie')
  return { res, cookie: set ? set.split(';')[0] : null }
}

async function versionOf(board = BOARD) {
  return (await WhiteboardBoardModel.findById(board).lean())
    ?.shareAccessVersion as string
}

describe('the owner sets, changes and removes a password', () => {
  it('starts with none; a set password comes back only as passwordSet, stored as scrypt', async () => {
    await makeBoards()
    const before = await patch({ title: 'Plan' })
    expect((await before.json()).board).toMatchObject({
      passwordSet: false,
      unlockTtl: '1d',
    })

    const res = await patch({ password: 'tulip-42', unlockTtl: '2d' })
    const text = await res.text()
    expect(res.status).toBe(200)
    expect(JSON.parse(text).board).toMatchObject({
      passwordSet: true,
      unlockTtl: '2d',
    })
    expect(text).not.toContain('tulip-42')
    expect(text).not.toContain('scrypt')

    const doc = await WhiteboardBoardModel.findById(BOARD).lean()
    expect(doc?.sharePasswordHash).toMatch(/^scrypt\$/)
    expect(doc?.sharePasswordHash).not.toContain('tulip-42')
    expect(doc?.shareAccessVersion).toMatch(/^[0-9a-f]{24}$/)
  })

  it('refuses a short password, an empty one, and an unknown ttl, and changes nothing', async () => {
    await makeBoards()
    expect((await patch({ password: 'abc' })).status).toBe(400)
    expect((await patch({ password: '' })).status).toBe(400)
    expect((await patch({ unlockTtl: '3h' })).status).toBe(400)
    const doc = await WhiteboardBoardModel.findById(BOARD).lean()
    expect(doc?.sharePasswordHash).toBeUndefined()
  })

  it('every set, change and removal is a new access version', async () => {
    await makeBoards()
    await patch({ password: 'first-one' })
    const v1 = await versionOf()
    await patch({ password: 'second-one' })
    const v2 = await versionOf()
    await patch({ password: null })
    const v3 = await versionOf()
    expect(new Set([v1, v2, v3]).size).toBe(3)
    expect(
      (await WhiteboardBoardModel.findById(BOARD).lean())?.sharePasswordHash
    ).toBeUndefined()
    // The TTL alone is not a password change: sessions keep their version.
    await patch({ password: 'third-one' })
    const v4 = await versionOf()
    await patch({ unlockTtl: '7d' })
    expect(await versionOf()).toBe(v4)
  })
})

async function readPassword(board = BOARD, withCookie = true) {
  const request = new NextRequest(
    `http://localhost/api/admin/whiteboard/boards/${board}/password`,
    { headers: withCookie ? { cookie: owner } : {} }
  )
  return routes.password.GET(request, {
    params: Promise.resolve({ id: board }),
  })
}

describe('the owner reads the password back', () => {
  it('gets it in plain text; the database holds only the hash and an encrypted copy', async () => {
    await makeBoards()
    await patch({ password: 'tulip-42' })
    const res = await readPassword()
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toContain('no-store')
    expect(await res.json()).toEqual({
      passwordSet: true,
      password: 'tulip-42',
    })
    const doc = await WhiteboardBoardModel.findById(BOARD).lean()
    expect(doc?.sharePasswordCipher).toMatch(/^v1\./)
    expect(JSON.stringify(doc)).not.toContain('tulip-42')
  })

  it('is owner only, and never rides along in the board patch answer', async () => {
    await makeBoards()
    const patched = await (await patch({ password: 'tulip-42' })).text()
    expect(patched).not.toContain('tulip-42')
    expect(patched).not.toContain('v1.')
    const anonymous = await readPassword(BOARD, false)
    expect(anonymous.status).toBe(401)
  })

  it('is null after removal, and null (not garbage) for a copy it cannot read', async () => {
    await makeBoards()
    await patch({ password: 'tulip-42' })
    await WhiteboardBoardModel.updateOne(
      { _id: BOARD },
      { $set: { sharePasswordCipher: 'v1.AAAA.BBBB.CCCC' } }
    )
    expect(await (await readPassword()).json()).toEqual({
      passwordSet: true,
      password: null,
    })
    await patch({ password: null })
    expect(await (await readPassword()).json()).toEqual({
      passwordSet: false,
      password: null,
    })
    const doc = await WhiteboardBoardModel.findById(BOARD).lean()
    expect(doc?.sharePasswordCipher).toBeUndefined()
  })
})

describe('a visitor without the password', () => {
  it('gets 401 locked on every route, and a write lands nothing', async () => {
    await makeBoards()
    await patch({ password: 'tulip-42' })
    for (const [route, method] of [
      ['stream', 'GET'],
      ['vocab', 'GET'],
    ]) {
      const res = await call(route, method)
      expect(res.status).toBe(401)
      expect(await res.json()).toMatchObject({ locked: true })
    }
    const write = await call('items', 'POST', {
      body: {
        _id: new mongoose.Types.ObjectId().toHexString(),
        form: 'text',
        title: 'Sneaky',
      },
    })
    expect(write.status).toBe(401)
    expect(await WhiteboardItemModel.countDocuments({})).toBe(0)
  })

  it('a board with no password still opens on the link alone', async () => {
    await makeBoards()
    expect((await call('stream', 'GET')).status).toBe(200)
  })

  it('a turned-off link is still a 404, password or not - the form confirms nothing', async () => {
    await makeBoards()
    await patch({ password: 'tulip-42', share: 'off' })
    expect((await call('stream', 'GET')).status).toBe(404)
    expect((await unlock('tulip-42')).res.status).toBe(404)
  })
})

describe('typing the password', () => {
  it('a wrong one is 401 and sets nothing; the right one opens every route', async () => {
    await makeBoards()
    await patch({ password: 'tulip-42' })

    const wrong = await unlock('tulip-43')
    expect(wrong.res.status).toBe(401)
    expect(wrong.cookie).toBeNull()

    const right = await unlock('tulip-42')
    expect(right.res.status).toBe(200)
    expect(right.cookie).toMatch(new RegExp(`^${unlockCookieName(BOARD)}=`))
    const setCookie = right.res.headers.get('set-cookie') ?? ''
    expect(setCookie).toMatch(/HttpOnly/i)

    expect(
      (await call('stream', 'GET', { cookie: right.cookie! })).status
    ).toBe(200)
    const created = await call('items', 'POST', {
      cookie: right.cookie!,
      body: {
        _id: new mongoose.Types.ObjectId().toHexString(),
        form: 'text',
        title: 'Hello',
      },
    })
    expect(created.status).toBe(200)
  })

  it('works through the slug too, and one board’s cookie never opens another', async () => {
    await makeBoards()
    await patch({ password: 'tulip-42', slug: 'plan-board' })
    await patch({ password: 'other-pass' }, OTHER)
    const { cookie } = await unlock('tulip-42', 'plan-board')
    expect(
      (await call('stream', 'GET', { key: 'plan-board', cookie: cookie! }))
        .status
    ).toBe(200)
    // Renamed to the other board's cookie name, same value: still signed for BOARD.
    const moved = cookie!.replace(
      unlockCookieName(BOARD),
      unlockCookieName(OTHER)
    )
    expect(
      (await call('stream', 'GET', { key: OTHER, cookie: moved })).status
    ).toBe(401)
  })

  it('a tampered cookie is refused', async () => {
    await makeBoards()
    await patch({ password: 'tulip-42' })
    const { cookie } = await unlock('tulip-42')
    const [name, value] = cookie!.split('=')
    const [body, sig] = value.split('.')
    const forged = `${name}=${body}.${sig.slice(0, -2)}xx`
    expect((await call('stream', 'GET', { cookie: forged })).status).toBe(401)
  })

  it('allows ten tries per caller, then 429 with Retry-After, even for the right password', async () => {
    await makeBoards()
    await patch({ password: 'tulip-42' })
    for (let i = 0; i < 10; i++)
      expect(
        (await unlock(`guess-${i}`, BOARD, '198.51.100.30')).res.status
      ).toBe(401)
    const limited = await unlock('tulip-42', BOARD, '198.51.100.30')
    expect(limited.res.status).toBe(429)
    expect(limited.cookie).toBeNull()
    expect(Number(limited.res.headers.get('Retry-After'))).toBeGreaterThan(0)
    // Someone else still has their tries.
    expect((await unlock('tulip-42', BOARD, '198.51.100.31')).res.status).toBe(
      200
    )
  })
})

describe('when an unlock stops working', () => {
  it('changing the password signs the visitor out at once, time left or not', async () => {
    await makeBoards()
    await patch({ password: 'tulip-42', unlockTtl: 'unlimited' })
    const { cookie } = await unlock('tulip-42')
    expect((await call('stream', 'GET', { cookie: cookie! })).status).toBe(200)

    await patch({ password: 'rose-77' })
    expect((await call('stream', 'GET', { cookie: cookie! })).status).toBe(401)
    expect((await unlock('tulip-42')).res.status).toBe(401)
    const fresh = await unlock('rose-77')
    expect(
      (await call('stream', 'GET', { cookie: fresh.cookie! })).status
    ).toBe(200)
  })

  it('removing the password opens the link; setting one again does not revive old cookies', async () => {
    await makeBoards()
    await patch({ password: 'tulip-42' })
    const { cookie } = await unlock('tulip-42')
    await patch({ password: null })
    expect((await call('stream', 'GET')).status).toBe(200)
    await patch({ password: 'tulip-42' })
    expect((await call('stream', 'GET', { cookie: cookie! })).status).toBe(401)
  })

  it('the time is counted against the board’s CURRENT setting', async () => {
    await makeBoards()
    await patch({ password: 'tulip-42', unlockTtl: '10m' })
    const name = unlockCookieName(BOARD)
    const issuedAgo = (ms: number) =>
      `${name}=${makeUnlockToken(BOARD, '', Date.now() - ms)}`
    const version = await versionOf()
    const eleven = `${name}=${makeUnlockToken(BOARD, version, Date.now() - 11 * 60_000)}`
    const nine = `${name}=${makeUnlockToken(BOARD, version, Date.now() - 9 * 60_000)}`

    expect((await call('stream', 'GET', { cookie: nine })).status).toBe(200)
    expect((await call('stream', 'GET', { cookie: eleven })).status).toBe(401)

    // Lengthened: the same cookie is good again. Shortened: cut, even mid-session.
    await patch({ unlockTtl: '1h' })
    expect((await call('stream', 'GET', { cookie: eleven })).status).toBe(200)
    await patch({ unlockTtl: 'unlimited' })
    const yearOld = `${name}=${makeUnlockToken(BOARD, version, Date.now() - 365 * 86_400_000)}`
    expect((await call('stream', 'GET', { cookie: yearOld })).status).toBe(200)

    // A right-looking cookie for the wrong version is nothing, whatever its age.
    expect((await call('stream', 'GET', { cookie: issuedAgo(0) })).status).toBe(
      401
    )
  })
})
