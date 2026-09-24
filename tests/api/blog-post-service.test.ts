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

import { KindModel } from '@/models/Kind'
import { PostModel } from '@/models/Post'
import { SeriesModel } from '@/models/Series'

/**
 * `lib/blog/post-service.ts`, the one implementation behind `/api/admin/blog/**` and the site
 * MCP's blog tools (premise 2).
 *
 * ```
 *   R9    admin PATCH baseUpdatedAt: stale ──▶ 409 stale · fresh ──▶ ok + updatedAt · absent ──▶ unchanged
 *   C9    createDraft: every field checked and the body rendered BEFORE one insert; slug derivation
 *   R6    updatePostAsAgent edits: exactly-once finds, a two-page post keeps its tail, whole body only
 *         for one page with its version
 *   R7    a live post may not be left holding a placeholder; the live rule needs canEditLive
 *   C8    every mutation revalidates inside the service
 * ```
 *
 * The existing `blog-patch` / `blog-permanent-delete` suites already pin the moved admin
 * behaviour; this file covers what is new.
 */

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

const CLOUD = 'https://res.cloudinary.com/test-cloud/image/upload/v1/c.png'

let memory: MongoMemoryServer
let service: typeof import('@/lib/blog/post-service')
let revalidate: ReturnType<typeof vi.fn>
let PATCH: (
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) => Promise<Response>

beforeAll(async () => {
  memory = await MongoMemoryServer.create()
  process.env.MONGODB_URI = memory.getUri()
  process.env.REQUIRE_ADMIN = 'false'
  process.env.CLOUDINARY_CLOUD_NAME = 'test-cloud'
  await mongoose.connect(memory.getUri())
  await PostModel.syncIndexes()
  service = await import('@/lib/blog/post-service')
  revalidate = (await import('@/lib/blog/revalidate'))
    .revalidatePublishedPost as unknown as ReturnType<typeof vi.fn>
  ;({ PATCH } = await import('@/app/api/admin/blog/[id]/route'))
}, 120_000)

afterAll(async () => {
  await mongoose.disconnect()
  await memory.stop()
})

afterEach(async () => {
  vi.clearAllMocks()
  await Promise.all([
    PostModel.deleteMany({}),
    KindModel.deleteMany({}),
    SeriesModel.deleteMany({}),
  ])
})

async function seedTaxonomy() {
  await KindModel.create({ slug: 'article', label: 'Article', order: 0 })
  await SeriesModel.create({
    slug: 'build-logs',
    title: 'Build logs',
    blurb: '',
    order: 0,
  })
}

async function makePost(overrides: Record<string, unknown> = {}) {
  return PostModel.create({
    slug: 'a-post',
    title: 'A post',
    kind: 'article',
    bodyMarkdown: '## Heading\n\nProse.',
    ...overrides,
  })
}

function patchRequest(id: string, body: Record<string, unknown>) {
  return PATCH(
    new NextRequest(`http://localhost/api/admin/blog/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) }
  )
}

describe('admin PATCH baseUpdatedAt (R9)', () => {
  it('a stale base is a 409 with code stale, and nothing is written', async () => {
    const post = await makePost()
    const loaded = post.updatedAt.toISOString()
    await PostModel.updateOne(
      { _id: post._id },
      { $set: { title: 'Agent edit' } }
    )

    const res = await patchRequest(String(post._id), {
      title: 'Owner stale save',
      baseUpdatedAt: loaded,
    })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('stale')
    expect(body.error).toMatch(/changed since you opened it/)
    expect(typeof body.updatedAt).toBe('string')
    expect((await PostModel.findById(post._id))?.title).toBe('Agent edit')
    expect(revalidate).not.toHaveBeenCalled()
  })

  it('a fresh base saves and answers with the new updatedAt', async () => {
    const post = await makePost()
    const res = await patchRequest(String(post._id), {
      title: 'Fresh save',
      baseUpdatedAt: post.updatedAt.toISOString(),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    const stored = await PostModel.findById(post._id)
    expect(stored?.title).toBe('Fresh save')
    expect(body).toEqual({
      ok: true,
      slug: 'a-post',
      status: 'draft',
      updatedAt: stored!.updatedAt.toISOString(),
    })
  })

  it('without the field the PATCH is unchanged: no check, no updatedAt in the answer', async () => {
    const post = await makePost()
    await PostModel.updateOne(
      { _id: post._id },
      { $set: { title: 'Agent edit' } }
    )
    const res = await patchRequest(String(post._id), { title: 'Owner wins' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      ok: true,
      slug: 'a-post',
      status: 'draft',
    })
    expect((await PostModel.findById(post._id))?.title).toBe('Owner wins')
  })

  it('a malformed base is a 400', async () => {
    const post = await makePost()
    const res = await patchRequest(String(post._id), {
      title: 'x',
      baseUpdatedAt: 'yesterday',
    })
    expect(res.status).toBe(400)
  })
})

describe('createDraft (C9)', () => {
  it('derives the slug from a Vietnamese title and renders before the insert', async () => {
    await seedTaxonomy()
    const result = await service.createDraft({
      title: 'Đã học được gì khi ship whiteboard',
      bodyMarkdown: '## Mở đầu\n\n![Bảng](image1)',
      imagePrompts: [{ key: 'image1', prompt: 'A whiteboard' }],
      coverImagePrompt: 'A cover',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.slug).toBe('da-hoc-duoc-gi-khi-ship-whiteboard')
    const stored = await PostModel.findById(result.value.id).select(
      '+bodyMarkdown +bodyHtml'
    )
    expect(stored).toMatchObject({
      status: 'draft',
      kind: 'article',
      bodyHtml: '<p>## Mở đầu\n\n![Bảng](image1)</p>',
      coverImagePrompt: 'A cover',
      publishedAt: null,
    })
    expect(stored?.renderedWith).not.toBe('')
    expect(stored?.imagePrompts.map(entry => entry.key)).toEqual(['image1'])
  })

  it('an invalid series leaves no post behind', async () => {
    await seedTaxonomy()
    const result = await service.createDraft({
      title: 'Hello',
      bodyMarkdown: 'x',
      series: 'nope',
    })
    expect(result).toMatchObject({ ok: false, status: 400 })
    expect(await PostModel.countDocuments()).toBe(0)
  })

  it('an unknown kind leaves no post behind', async () => {
    await seedTaxonomy()
    const result = await service.createDraft({
      title: 'Hello',
      bodyMarkdown: 'x',
      kind: 'nope',
    })
    expect(result.ok).toBe(false)
    expect(await PostModel.countDocuments()).toBe(0)
  })

  it('a reserved slug and a title with nothing to slug are errors', async () => {
    await seedTaxonomy()
    expect(
      await service.createDraft({ title: 'Privacy', bodyMarkdown: 'x' })
    ).toMatchObject({ ok: false, status: 400 })
    expect(
      await service.createDraft({ title: '!!! ???', bodyMarkdown: 'x' })
    ).toMatchObject({ ok: false, status: 400 })
    expect(await PostModel.countDocuments()).toBe(0)
  })

  it('a clash with a soft-deleted post names it and suggests -2, never reusing it', async () => {
    await seedTaxonomy()
    await makePost({ slug: 'hello', status: 'deleted' })
    const result = await service.createDraft({
      title: 'Hello',
      bodyMarkdown: 'x',
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(409)
    expect(result.error).toContain('deleted post')
    expect(result.error).toContain('"hello-2"')
    expect(await PostModel.countDocuments()).toBe(1)
  })

  it('more prompts than the cap, or a bad key, create nothing', async () => {
    await seedTaxonomy()
    expect(
      await service.createDraft({
        title: 'Hello',
        bodyMarkdown: 'x',
        imagePrompts: [{ key: 'cover', prompt: 'x' }],
      })
    ).toMatchObject({ ok: false, status: 400 })
    expect(await PostModel.countDocuments()).toBe(0)
  })
})

describe('updatePostAsAgent edits (R6)', () => {
  const edit = (
    id: string,
    input: Record<string, unknown>,
    canEditLive = false
  ) => service.updatePostAsAgent(id, input, { canEditLive })

  it('an unmatched find fails the whole call and names it', async () => {
    const post = await makePost({ bodyMarkdown: 'alpha beta gamma' })
    const result = await edit(String(post._id), {
      title: 'New title',
      edits: [
        { find: 'alpha', replace: 'ALPHA' },
        { find: 'delta', replace: 'DELTA' },
      ],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('Edit 2')
    expect(result.error).toContain('delta')
    const stored = await PostModel.findById(post._id).select('+bodyMarkdown')
    expect(stored?.bodyMarkdown).toBe('alpha beta gamma')
    expect(stored?.title).toBe('A post')
  })

  it('a find matching twice is ambiguous and changes nothing', async () => {
    const post = await makePost({ bodyMarkdown: 'same and same' })
    const result = await edit(String(post._id), {
      edits: [{ find: 'same', replace: 'other' }],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/more than once/)
  })

  it('a two-page post edited by find keeps its tail', async () => {
    const head = 'Opening paragraph with a typo: teh.\n\n'
    const tail = '\n\nTHE VERY LAST LINE OF THE POST.'
    const body = head + 'filler line\n'.repeat(4_000) + tail
    expect(body.length).toBeGreaterThan(service.POST_PAGE_CHARS)
    const post = await makePost({ bodyMarkdown: body })

    const result = await edit(String(post._id), {
      edits: [{ find: 'typo: teh.', replace: 'typo: the.' }],
    })
    expect(result.ok).toBe(true)
    const stored = await PostModel.findById(post._id).select('+bodyMarkdown')
    expect(
      stored?.bodyMarkdown.startsWith('Opening paragraph with a typo: the.')
    ).toBe(true)
    expect(stored?.bodyMarkdown.endsWith(tail)).toBe(true)
    expect(stored?.bodyMarkdown.length).toBe(body.length)
  })

  it('a whole-body replace is refused on a two-page post', async () => {
    const body = 'line\n'.repeat(6_000)
    const post = await makePost({ bodyMarkdown: body })
    const result = await edit(String(post._id), {
      bodyMarkdown: 'line\n'.repeat(5_900),
      version: service.bodyVersion(body),
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/more than one page/)
  })

  it('a whole-body replace on a one-page post needs the current version, and keeps the 50% guard', async () => {
    const post = await makePost({ bodyMarkdown: 'one two three four' })
    const id = String(post._id)
    expect(
      await edit(id, { bodyMarkdown: 'one two three FOUR', version: 'stale' })
    ).toMatchObject({ ok: false, status: 409 })
    expect(
      await edit(id, {
        bodyMarkdown: 'one',
        version: service.bodyVersion('one two three four'),
      })
    ).toMatchObject({ ok: false, status: 400 })
    const good = await edit(id, {
      bodyMarkdown: 'one two three FOUR',
      version: service.bodyVersion('one two three four'),
    })
    expect(good.ok).toBe(true)
  })

  it('never takes a status', async () => {
    const post = await makePost()
    await edit(String(post._id), { status: 'published', title: 'T' })
    expect((await PostModel.findById(post._id))?.status).toBe('draft')
  })
})

describe('the live-post rule (R7)', () => {
  it('a published post needs canEditLive', async () => {
    const post = await makePost({
      status: 'published',
      publishedAt: new Date(),
    })
    const result = await service.updatePostAsAgent(
      String(post._id),
      { title: 'New' },
      { canEditLive: false }
    )
    expect(result).toMatchObject({ ok: false, status: 403 })
    expect((await PostModel.findById(post._id))?.title).toBe('A post')
  })

  it('an edit adding a placeholder is refused on a live post and allowed on a draft', async () => {
    const live = await makePost({
      slug: 'live',
      status: 'published',
      publishedAt: new Date(),
      bodyMarkdown: 'Intro.',
    })
    const draft = await makePost({ slug: 'draft', bodyMarkdown: 'Intro.' })
    const input = {
      edits: [{ find: 'Intro.', replace: 'Intro.\n\n![Diagram](image1)' }],
    }

    const refused = await service.updatePostAsAgent(String(live._id), input, {
      canEditLive: true,
    })
    expect(refused.ok).toBe(false)
    if (!refused.ok) {
      expect(refused.error).toContain('image1')
      expect(refused.error).toContain('generate_image')
    }

    const allowed = await service.updatePostAsAgent(String(draft._id), input, {
      canEditLive: false,
    })
    expect(allowed.ok).toBe(true)
  })

  it('inserting a finished image into a live post is fine, and revalidates', async () => {
    const live = await makePost({
      slug: 'live',
      status: 'published',
      publishedAt: new Date(),
      bodyMarkdown: 'Intro.',
    })
    const result = await service.updatePostAsAgent(
      String(live._id),
      {
        edits: [{ find: 'Intro.', replace: `Intro.\n\n![Diagram](${CLOUD})` }],
      },
      { canEditLive: true }
    )
    expect(result.ok).toBe(true)
    expect(revalidate).toHaveBeenCalledWith('live')
  })

  it('a concurrent write between the read and the save is a conflict, not an overwrite', async () => {
    const post = await makePost({ bodyMarkdown: 'Intro.' })
    const markdown = await import('@/lib/blog/markdown')
    vi.mocked(markdown.renderMarkdown).mockImplementationOnce(async text => {
      // An image run patches the post while this edit is rendering.
      await PostModel.updateOne(
        { _id: post._id },
        { $set: { coverImage: CLOUD } }
      )
      return `<p>${text}</p>`
    })
    const result = await service.updatePostAsAgent(
      String(post._id),
      { edits: [{ find: 'Intro.', replace: 'Intro, edited.' }] },
      { canEditLive: false }
    )
    expect(result).toMatchObject({ ok: false, status: 409 })
    const stored = await PostModel.findById(post._id).select('+bodyMarkdown')
    expect(stored?.coverImage).toBe(CLOUD)
    expect(stored?.bodyMarkdown).toBe('Intro.')
  })
})

describe('publishPost', () => {
  it('refuses while publishBlockers has reasons', async () => {
    const post = await makePost({
      bodyMarkdown: 'Text ![x](image1)',
      coverImage: null,
    })
    const result = await service.publishPost(String(post._id))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('no cover image')
      expect(result.error).toContain('image1')
    }
    expect((await PostModel.findById(post._id))?.status).toBe('draft')
  })

  it('publishes a whole post, stamps publishedAt once, and revalidates', async () => {
    const post = await makePost({ coverImage: CLOUD })
    const result = await service.publishPost(String(post._id))
    expect(result).toMatchObject({
      ok: true,
      value: { alreadyPublished: false },
    })
    const stored = await PostModel.findById(post._id)
    expect(stored?.status).toBe('published')
    expect(stored?.publishedAt).toBeInstanceOf(Date)
    expect(revalidate).toHaveBeenCalledWith('a-post')
  })

  it('republishing an archived, once-public post keeps its publishedAt', async () => {
    const when = new Date('2025-01-01T00:00:00.000Z')
    const post = await makePost({
      coverImage: CLOUD,
      status: 'archived',
      publishedAt: when,
    })
    await service.publishPost(String(post._id))
    expect(
      (await PostModel.findById(post._id))?.publishedAt?.toISOString()
    ).toBe(when.toISOString())
  })
})

describe('revalidation lives inside the services (C8)', () => {
  it('every mutating service call revalidates the slug', async () => {
    const post = await makePost({ coverImage: CLOUD })
    const id = String(post._id)
    await service.patchPost(id, { title: 'B' })
    await service.updatePostAsAgent(id, { title: 'C' }, { canEditLive: false })
    await service.publishPost(id)
    await service.softDeletePost(id)
    expect(revalidate).toHaveBeenCalledTimes(4)
    for (const call of revalidate.mock.calls) expect(call).toEqual(['a-post'])
  })
})
