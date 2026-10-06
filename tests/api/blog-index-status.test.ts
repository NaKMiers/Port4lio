import crypto from 'node:crypto'

import { MongoMemoryServer } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import { NextRequest } from 'next/server'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import { getAuthCookieName, makeAuthToken } from '@/lib/auth'
import { PostModel } from '@/models/Post'
import { SearchConsoleStateModel } from '@/models/SearchConsoleState'

/**
 * Google index status on `/admin/blog` - the service, its two routes and the board's GET.
 *
 * ```
 *   POST /api/admin/blog/<id>/index-status   401 · 503 unconfigured/bad_config · 404 · 409
 *                                            200 writes every field, never moves updatedAt
 *                                            429/502 keeps the prior result, returns it
 *                                            archived mid-call ──▶ 409, nothing written
 *   POST /api/admin/blog/sitemap-submit      success clears lastError · failure sets it
 *   GET  /api/admin/blog                     posts carry indexStatus · indexing never fails it
 * ```
 *
 * The Google calls are the stub (`inspectUrl`, `submitSitemap`); the client's own mapping is
 * covered in `tests/unit/search-console.test.ts`. Everything else is real, against a real
 * mongod, because the race and the timestamps are database behaviour.
 */

const inspect = vi.hoisted(() => vi.fn())
const submit = vi.hoisted(() => vi.fn())

vi.mock('@/lib/search-console', async () => {
  const actual = await vi.importActual<typeof import('@/lib/search-console')>(
    '@/lib/search-console'
  )
  return { ...actual, inspectUrl: inspect, submitSitemap: submit }
})
vi.mock('@/lib/blog/revalidate', () => ({ revalidatePublishedPost: vi.fn() }))
vi.mock('@/lib/blog/markdown', async () => {
  const actual = await vi.importActual<typeof import('@/lib/blog/markdown')>(
    '@/lib/blog/markdown'
  )
  return {
    ...actual,
    renderMarkdown: vi.fn(async (markdown: string) => `<p>${markdown}</p>`),
  }
})

type IdHandler = (
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) => Promise<Response>
type Handler = (request: NextRequest) => Promise<Response>

let memory: MongoMemoryServer
let check: IdHandler
let sitemap: Handler
let board: Handler
let SearchConsoleError: typeof import('@/lib/search-console').SearchConsoleError

const { privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})
const KEY = Buffer.from(
  JSON.stringify({
    client_email: 'sa@proj.iam.gserviceaccount.com',
    private_key: privateKey,
  })
).toString('base64')

beforeAll(async () => {
  memory = await MongoMemoryServer.create()
  process.env.MONGODB_URI = memory.getUri()
  process.env.AUTH_SECRET = 'index-status-secret'
  delete process.env.REQUIRE_ADMIN
  await mongoose.connect(memory.getUri())
  ;({ POST: check } =
    await import('@/app/api/admin/blog/[id]/index-status/route'))
  ;({ POST: sitemap } =
    await import('@/app/api/admin/blog/sitemap-submit/route'))
  ;({ GET: board } = await import('@/app/api/admin/blog/route'))
  ;({ SearchConsoleError } = await import('@/lib/search-console'))
}, 120_000)

afterAll(async () => {
  await mongoose.disconnect()
  await memory.stop()
})

beforeEach(() => {
  process.env.GSC_SERVICE_ACCOUNT_JSON = KEY
  process.env.GSC_SITE_URL = 'sc-domain:example.com'
  process.env.NEXT_PUBLIC_SITE_URL = 'https://example.com'
})

afterEach(async () => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
  delete process.env.GSC_SERVICE_ACCOUNT_JSON
  delete process.env.GSC_SITE_URL
  delete process.env.NEXT_PUBLIC_SITE_URL
  await PostModel.deleteMany({})
  await SearchConsoleStateModel.deleteMany({})
})

const ownerCookie = () =>
  `${getAuthCookieName()}=${makeAuthToken(Date.now() + 3_600_000)}`

function post(path: string, cookie: string | null = ownerCookie()) {
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    headers: cookie ? { cookie } : {},
  })
}

const checkPost = (id: string, cookie?: string | null) =>
  check(post(`/api/admin/blog/${id}/index-status`, cookie), {
    params: Promise.resolve({ id }),
  })

async function makePost(overrides: Record<string, unknown> = {}) {
  return PostModel.create({
    slug: 'a-post',
    title: 'A post',
    kind: 'article',
    status: 'published',
    publishedAt: new Date('2026-09-20T00:00:00Z'),
    bodyMarkdown: 'Prose.',
    ...overrides,
  })
}

const FIELDS = {
  verdict: 'NEUTRAL',
  coverageState: 'Crawled - currently not indexed',
  indexingState: 'INDEXING_ALLOWED',
  robotsTxtState: 'ALLOWED',
  pageFetchState: 'SUCCESSFUL',
  lastCrawlTime: new Date('2026-10-01T00:00:00Z'),
  googleCanonical: null,
  userCanonical: null,
  inspectionResultLink: 'https://search.google.com/search-console/inspect?x',
}

const stored = (id: unknown) => PostModel.findById(id).lean()

describe('owner gate', () => {
  it('both routes are 401 without the owner cookie and call nothing', async () => {
    const created = await makePost()
    expect((await checkPost(String(created._id), null)).status).toBe(401)
    expect(
      (await sitemap(post('/api/admin/blog/sitemap-submit', null))).status
    ).toBe(401)
    expect(inspect).not.toHaveBeenCalled()
    expect(submit).not.toHaveBeenCalled()
  })
})

describe('configuration', () => {
  it('unset env is 503 unconfigured and writes nothing', async () => {
    delete process.env.GSC_SERVICE_ACCOUNT_JSON
    const created = await makePost()
    const res = await checkPost(String(created._id))
    expect(res.status).toBe(503)
    expect((await res.json()).code).toBe('unconfigured')
    expect((await stored(created._id))?.indexStatus).toBeUndefined()
  })

  it('a malformed key is 503 bad_config, never a 500', async () => {
    process.env.GSC_SERVICE_ACCOUNT_JSON = 'not-a-key'
    const res = await checkPost(String((await makePost())._id))
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.code).toBe('bad_config')
    expect(body.error).toContain('GSC_SERVICE_ACCOUNT_JSON')
  })

  it('an origin outside the property is bad_config, before Google is asked', async () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://www.other.dev'
    const res = await checkPost(String((await makePost())._id))
    expect(res.status).toBe(503)
    expect((await res.json()).error).toContain('not inside')
    expect(inspect).not.toHaveBeenCalled()
  })

  it('a subdomain of a domain property is inside it', async () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://www.example.com'
    inspect.mockResolvedValue(FIELDS)
    expect((await checkPost(String((await makePost())._id))).status).toBe(200)
  })
})

describe('POST /api/admin/blog/<id>/index-status', () => {
  it('404 for an invalid or unknown id, 409 for a post that is not published', async () => {
    expect((await (await checkPost('nope')).json()).code).toBe('not_found')
    expect(
      (await checkPost(new mongoose.Types.ObjectId().toHexString())).status
    ).toBe(404)

    const draft = await makePost({ status: 'draft', publishedAt: null })
    const res = await checkPost(String(draft._id))
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('not_published')
    expect(inspect).not.toHaveBeenCalled()
  })

  it('inspects the canonical URL and stores the answer without moving updatedAt', async () => {
    const created = await makePost()
    const before = await stored(created._id)
    inspect.mockResolvedValue(FIELDS)

    const res = await checkPost(String(created._id))

    expect(res.status).toBe(200)
    expect(inspect).toHaveBeenCalledWith(
      expect.objectContaining({
        clientEmail: 'sa@proj.iam.gserviceaccount.com',
      }),
      'sc-domain:example.com',
      'https://example.com/blog/a-post'
    )
    const body = await res.json()
    expect(body.indexStatus).toMatchObject({
      verdict: 'NEUTRAL',
      coverageState: 'Crawled - currently not indexed',
    })
    expect(body.indexStatus.checkedAt).toBeTruthy()

    const after = await stored(created._id)
    // R9 and the board's sort both read updatedAt; a check is bookkeeping, not an edit.
    expect(after?.updatedAt.toISOString()).toBe(before?.updatedAt.toISOString())
    expect(after?.contentUpdatedAt.toISOString()).toBe(
      before?.contentUpdatedAt.toISOString()
    )
  })

  it('a field Google left out this time clears the old value', async () => {
    const created = await makePost({
      indexStatus: {
        verdict: 'NEUTRAL',
        googleCanonical: 'https://example.com/blog/other',
        userCanonical: 'https://example.com/blog/a-post',
        checkedAt: new Date('2026-10-01T00:00:00Z'),
        lastError: 'old failure',
        lastErrorAt: new Date('2026-10-02T00:00:00Z'),
      },
    })
    inspect.mockResolvedValue({ ...FIELDS, verdict: 'PASS' })

    await checkPost(String(created._id))

    const status = (await stored(created._id))?.indexStatus
    expect(status?.verdict).toBe('PASS')
    expect(status?.googleCanonical).toBeNull()
    expect(status?.lastError).toBeUndefined()
  })

  it('a failed check keeps the previous result and returns it with the error', async () => {
    const checkedAt = new Date('2026-10-01T00:00:00Z')
    const created = await makePost({
      indexStatus: {
        verdict: 'PASS',
        coverageState: 'Submitted and indexed',
        checkedAt,
      },
    })
    inspect.mockRejectedValue(new SearchConsoleError('quota', 'Quota reached.'))

    const res = await checkPost(String(created._id))

    expect(res.status).toBe(429)
    const body = await res.json()
    expect(body).toMatchObject({ code: 'quota', error: 'Quota reached.' })
    expect(body.indexStatus).toMatchObject({
      verdict: 'PASS',
      lastError: 'Quota reached.',
    })
    const status = (await stored(created._id))?.indexStatus
    expect(status?.checkedAt?.toISOString()).toBe(checkedAt.toISOString())
    expect(status?.lastErrorAt).toBeInstanceOf(Date)
  })

  it('a post archived while Google was answering gets nothing written (409)', async () => {
    const created = await makePost()
    inspect.mockImplementation(async () => {
      await PostModel.updateOne({ _id: created._id }, { status: 'archived' })
      return FIELDS
    })

    const res = await checkPost(String(created._id))

    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('not_published')
    expect((await stored(created._id))?.indexStatus).toBeUndefined()
  })
})

describe('POST /api/admin/blog/sitemap-submit', () => {
  it('records success, then a failure, then clears the failure on the next success', async () => {
    submit.mockResolvedValueOnce(undefined)
    const ok = await sitemap(post('/api/admin/blog/sitemap-submit'))
    expect(ok.status).toBe(200)
    expect(submit).toHaveBeenCalledWith(
      expect.anything(),
      'sc-domain:example.com',
      'https://example.com/sitemap.xml'
    )
    const first = (await ok.json()).sitemap
    expect(first).toMatchObject({ lastTrigger: 'manual' })
    expect(first.lastSubmittedAt).toBeTruthy()

    submit.mockRejectedValueOnce(
      new SearchConsoleError('forbidden', 'Add sa@x as a Full user.')
    )
    const refused = await sitemap(post('/api/admin/blog/sitemap-submit'))
    expect(refused.status).toBe(502)
    const failed = await refused.json()
    expect(failed.code).toBe('forbidden')
    expect(failed.sitemap.lastError).toBe('Add sa@x as a Full user.')
    expect(failed.sitemap.lastSubmittedAt).toBe(first.lastSubmittedAt)

    submit.mockResolvedValueOnce(undefined)
    const again = await (
      await sitemap(post('/api/admin/blog/sitemap-submit'))
    ).json()
    expect(again.sitemap.lastError).toBeUndefined()
  })

  it('unconfigured is 503 and writes no state', async () => {
    delete process.env.GSC_SITE_URL
    const res = await sitemap(post('/api/admin/blog/sitemap-submit'))
    expect(res.status).toBe(503)
    expect(await SearchConsoleStateModel.countDocuments()).toBe(0)
  })

  it('retries once when the first upsert of the fixed document races itself', async () => {
    submit.mockResolvedValue(undefined)
    const original = SearchConsoleStateModel.findOneAndUpdate.bind(
      SearchConsoleStateModel
    )
    const spy = vi
      .spyOn(SearchConsoleStateModel, 'findOneAndUpdate')
      .mockImplementationOnce(() => {
        throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 })
      })
      .mockImplementation(((...args: Parameters<typeof original>) =>
        original(...args)) as never)

    const res = await sitemap(post('/api/admin/blog/sitemap-submit'))

    expect(res.status).toBe(200)
    expect(spy).toHaveBeenCalledTimes(2)
  })
})

describe('GET /api/admin/blog', () => {
  it("carries each post's indexStatus and the board-level indexing state", async () => {
    await makePost({
      indexStatus: { verdict: 'PASS', checkedAt: new Date() },
    })
    const res = await board(
      new NextRequest('http://localhost/api/admin/blog', {
        headers: { cookie: ownerCookie() },
      })
    )
    const body = await res.json()
    expect(body.posts[0].indexStatus.verdict).toBe('PASS')
    expect(body.indexing).toEqual({
      configured: true,
      problem: null,
      sitemap: null,
    })
  })

  it('a failed state read costs the sitemap marker, never the board', async () => {
    await makePost()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(SearchConsoleStateModel, 'findById').mockImplementation(() => {
      throw new Error('state collection down')
    })
    const res = await board(
      new NextRequest('http://localhost/api/admin/blog', {
        headers: { cookie: ownerCookie() },
      })
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.posts).toHaveLength(1)
    expect(body.indexing.sitemap).toBeNull()
  })

  it('unconfigured still loads, saying what to set', async () => {
    delete process.env.GSC_SERVICE_ACCOUNT_JSON
    const body = await (
      await board(
        new NextRequest('http://localhost/api/admin/blog', {
          headers: { cookie: ownerCookie() },
        })
      )
    ).json()
    expect(body.indexing.configured).toBe(false)
    expect(body.indexing.problem).toContain('GSC_SERVICE_ACCOUNT_JSON')
  })
})
