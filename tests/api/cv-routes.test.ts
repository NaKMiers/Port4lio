import { MongoMemoryServer } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import { NextRequest } from 'next/server'
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import { getAuthCookieName, makeAuthToken } from '@/lib/auth'
import { makeEmptyResume } from '@/lib/profile'
import { MAX_CV_JSON_BYTES } from '@/lib/upload-limits'
import { CvModel, LEGACY_CV_ID } from '@/models/Cv'
import type { CvDto } from '@/types/cv'

/**
 * `/api/admin/cvs/**`, the HTTP layer only - the rules are `cv-service.test.ts`'s job.
 *
 * ```
 *   every handler   no owner cookie ──▶ 401, before anything else runs
 *   bodies          malformed ──▶ 400 · over MAX_CV_JSON_BYTES ──▶ 413          (D8)
 *   [id]            not an ObjectId ──▶ 404 · unknown ──▶ 404 (params awaited, Next 16)
 *   PATCH           base required · '*' overwrites · stale ──▶ 409 code stale + updatedAt
 *   answers         CvDto { id, label, resume, publishedAt, updatedAt }
 * ```
 */

vi.hoisted(() => {
  process.env.PROFILE_DOCUMENT_ID = 'cv-routes-profile'
})

vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
  unstable_cache: <T>(fn: T) => fn,
}))

type Context = { params: Promise<{ id: string }> }
type Handler = (request: NextRequest) => Promise<Response>
type IdHandler = (request: NextRequest, context: Context) => Promise<Response>

let memory: MongoMemoryServer
let list: { GET: Handler; POST: Handler }
let item: { PATCH: IdHandler; DELETE: IdHandler }
let publish: { POST: IdHandler }

beforeAll(async () => {
  memory = await MongoMemoryServer.create()
  process.env.MONGODB_URI = memory.getUri()
  process.env.AUTH_SECRET = 'cv-routes-secret'
  delete process.env.REQUIRE_ADMIN
  await mongoose.connect(memory.getUri())
  list = (await import('@/app/api/admin/cvs/route')) as never
  item = (await import('@/app/api/admin/cvs/[id]/route')) as never
  publish = (await import('@/app/api/admin/cvs/[id]/publish/route')) as never
}, 120_000)

afterAll(async () => {
  await mongoose.disconnect()
  await memory.stop()
})

afterEach(async () => {
  delete process.env.REQUIRE_ADMIN
  await CvModel.deleteMany({})
})

const ownerCookie = () =>
  `${getAuthCookieName()}=${makeAuthToken(Date.now() + 3_600_000)}`

function request(
  method: string,
  path: string,
  {
    body,
    cookie = ownerCookie(),
  }: { body?: unknown; cookie?: string | null } = {}
) {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    ...(body === undefined
      ? {}
      : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  })
}

const ctx = (id: string): Context => ({ params: Promise.resolve({ id }) })
const LEGACY = String(LEGACY_CV_ID)
const UNKNOWN = new mongoose.Types.ObjectId().toHexString()

async function listed() {
  const res = await list.GET(request('GET', '/api/admin/cvs'))
  return (await res.json()) as { cvs: CvDto[]; publishedId: string }
}

describe('owner gate', () => {
  it('all five handlers are 401 without the owner cookie, and write nothing', async () => {
    const anon = { cookie: null }
    const responses = await Promise.all([
      list.GET(request('GET', '/api/admin/cvs', anon)),
      list.POST(
        request('POST', '/api/admin/cvs', {
          ...anon,
          body: { label: 'X', fromId: LEGACY },
        })
      ),
      item.PATCH(
        request('PATCH', `/api/admin/cvs/${LEGACY}`, {
          ...anon,
          body: { label: 'X', base: '*' },
        }),
        ctx(LEGACY)
      ),
      item.DELETE(
        request('DELETE', `/api/admin/cvs/${LEGACY}`, anon),
        ctx(LEGACY)
      ),
      publish.POST(
        request('POST', `/api/admin/cvs/${LEGACY}/publish`, anon),
        ctx(LEGACY)
      ),
    ])

    for (const res of responses) {
      expect(res.status).toBe(401)
      expect(await res.json()).toEqual({ error: 'Unauthorized' })
    }
    // Not even the migration ran: the gate is the first line.
    expect(await CvModel.countDocuments()).toBe(0)
  })
})

describe('GET /api/admin/cvs', () => {
  it('returns every CV as a CvDto plus publishedId', async () => {
    const res = await list.GET(request('GET', '/api/admin/cvs'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { cvs: CvDto[]; publishedId: string }

    expect(body.publishedId).toBe(LEGACY)
    expect(body.cvs).toHaveLength(1)
    expect(Object.keys(body.cvs[0]).sort()).toEqual([
      'id',
      'label',
      'publishedAt',
      'resume',
      'updatedAt',
    ])
    expect(typeof body.cvs[0].publishedAt).toBe('string')
    expect(typeof body.cvs[0].updatedAt).toBe('string')
  })
})

describe('POST /api/admin/cvs', () => {
  it('201 with the new CV', async () => {
    const res = await list.POST(
      request('POST', '/api/admin/cvs', {
        body: { label: 'Frontend', fromId: LEGACY },
      })
    )
    expect(res.status).toBe(201)
    const { cv } = (await res.json()) as { cv: CvDto }
    expect(cv.label).toBe('Frontend')
    expect(cv.publishedAt).toBeNull()
  })

  it('409 labelTaken, 404 unknown fromId, 400 malformed JSON, 413 oversize', async () => {
    await listed()
    const post = (body: unknown) =>
      list.POST(request('POST', '/api/admin/cvs', { body }))

    const taken = await post({ label: 'main cv', fromId: LEGACY })
    expect(taken.status).toBe(409)
    expect((await taken.json()).code).toBe('labelTaken')

    expect((await post({ label: 'X', fromId: UNKNOWN })).status).toBe(404)
    expect((await post('{not json')).status).toBe(400)
    expect(
      (await post({ label: 'x'.repeat(MAX_CV_JSON_BYTES), fromId: LEGACY }))
        .status
    ).toBe(413)
  })
})

describe('PATCH /api/admin/cvs/[id]', () => {
  const patch = (id: string, body: unknown) =>
    item.PATCH(request('PATCH', `/api/admin/cvs/${id}`, { body }), ctx(id))

  it('saves with the loaded base, then 409 stale for the old base, then overwrites with *', async () => {
    const { cvs } = await listed()
    const base = cvs[0].updatedAt

    const saved = await patch(LEGACY, {
      resume: { ...makeEmptyResume(), name: 'First' },
      base,
    })
    expect(saved.status).toBe(200)
    const { cv } = (await saved.json()) as { cv: CvDto }
    expect(cv.resume.name).toBe('First')
    expect(cv.updatedAt).not.toBe(base)

    const stale = await patch(LEGACY, {
      resume: { ...makeEmptyResume(), name: 'Old tab' },
      base,
    })
    expect(stale.status).toBe(409)
    const staleBody = await stale.json()
    expect(staleBody.code).toBe('stale')
    expect(staleBody.updatedAt).toBe(cv.updatedAt)
    expect(typeof staleBody.error).toBe('string')

    const overwrite = await patch(LEGACY, {
      resume: { ...makeEmptyResume(), name: 'Owner wins' },
      base: '*',
    })
    expect(overwrite.status).toBe(200)
    expect(((await overwrite.json()) as { cv: CvDto }).cv.resume.name).toBe(
      'Owner wins'
    )
  })

  it('404 for a malformed or unknown id, 400 without a usable base, 400 malformed, 413 oversize', async () => {
    await listed()
    expect((await patch('not-an-id', { label: 'X', base: '*' })).status).toBe(
      404
    )
    expect((await patch(UNKNOWN, { label: 'X', base: '*' })).status).toBe(404)
    expect((await patch(LEGACY, { label: 'X' })).status).toBe(400)
    expect(
      (await patch(LEGACY, { label: 'X', base: 'yesterday' })).status
    ).toBe(400)
    expect((await patch(LEGACY, '{not json')).status).toBe(400)
    expect(
      (
        await patch(LEGACY, {
          resume: { ...makeEmptyResume(), name: 'x'.repeat(MAX_CV_JSON_BYTES) },
          base: '*',
        })
      ).status
    ).toBe(413)
  })
})

describe('DELETE /api/admin/cvs/[id]', () => {
  const del = (id: string) =>
    item.DELETE(request('DELETE', `/api/admin/cvs/${id}`), ctx(id))

  it('409 published for the published CV, { ok } for another, 404 unknown or malformed', async () => {
    await listed()
    const created = await list.POST(
      request('POST', '/api/admin/cvs', {
        body: { label: 'Spare', fromId: LEGACY },
      })
    )
    const { cv } = (await created.json()) as { cv: CvDto }

    const refused = await del(LEGACY)
    expect(refused.status).toBe(409)
    expect((await refused.json()).code).toBe('published')

    const ok = await del(cv.id)
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ ok: true })

    expect((await del(UNKNOWN)).status).toBe(404)
    expect((await del('not-an-id')).status).toBe(404)
  })
})

describe('POST /api/admin/cvs/[id]/publish', () => {
  const pub = (id: string) =>
    publish.POST(request('POST', `/api/admin/cvs/${id}/publish`), ctx(id))

  it('{ publishedId } and GET agrees; 404 unknown or malformed', async () => {
    await listed()
    const created = await list.POST(
      request('POST', '/api/admin/cvs', {
        body: { label: 'Next', fromId: LEGACY },
      })
    )
    const { cv } = (await created.json()) as { cv: CvDto }

    const res = await pub(cv.id)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ publishedId: cv.id })
    expect((await listed()).publishedId).toBe(cv.id)

    expect((await pub(UNKNOWN)).status).toBe(404)
    expect((await pub('not-an-id')).status).toBe(404)
  })
})
