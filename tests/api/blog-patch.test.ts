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

import { MAX_IMAGE_PROMPTS } from '@/lib/blog/constants'
import { PostModel } from '@/models/Post'

/**
 * `PATCH /api/admin/blog/<id>` - the editor's only path to the server.
 *
 * There was no API test for PATCH at all, which is how three separate defects sat in it: the
 * editor's Publish button never sent `status`, `imagePrompts` past the cap were silently
 * truncated under a success banner, and `coverImage` accepted any URL and rendered it straight
 * to readers. Each one is a case below.
 *
 * `renderMarkdown` is mocked for the Shiki bootstrap cost, as in the generate tests. Nothing
 * here asserts on rendered HTML - the pipeline has its own tests.
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

let memory: MongoMemoryServer
let PATCH: (
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) => Promise<Response>

/** Matches the allowlist: https, res.cloudinary.com, and a path under this cloud name. */
const CLOUD_URL = 'https://res.cloudinary.com/test-cloud/image/upload/v1/a.png'

beforeAll(async () => {
  memory = await MongoMemoryServer.create()
  process.env.MONGODB_URI = memory.getUri()
  process.env.REQUIRE_ADMIN = 'false'
  // `isAllowedImageUrl` requires the path to start with `/<CLOUD_NAME>/`, so the allowlist is
  // inert without this - every cover URL would be refused and the tests below would pass for
  // the wrong reason.
  process.env.CLOUDINARY_CLOUD_NAME = 'test-cloud'
  await mongoose.connect(memory.getUri())
  ;({ PATCH } = await import('@/app/api/admin/blog/[id]/route'))
}, 120_000)

afterAll(async () => {
  await mongoose.disconnect()
  await memory.stop()
})

afterEach(async () => {
  vi.clearAllMocks()
  await PostModel.deleteMany({})
})

async function makePost(overrides: Record<string, unknown> = {}) {
  return PostModel.create({
    slug: 'a-post',
    title: 'A post',
    kind: 'article',
    bodyMarkdown: '## Heading\n\nProse.',
    ...overrides,
  })
}

function call(id: string, body: Record<string, unknown>) {
  const request = new NextRequest(`http://localhost/api/admin/blog/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return PATCH(request, { params: Promise.resolve({ id }) })
}

describe('status, which the editor could not actually change', () => {
  it('publishes an archived post and stamps publishedAt', async () => {
    /*
      The bug this covers was on the client - `flush` serialised thirteen fields and `status`
      was not one of them, so the editor's Publish button repainted the toolbar and saved
      nothing. The route always accepted the field. This asserts the contract the editor now
      relies on.
    */
    const post = await makePost({ status: 'archived' })

    const response = await call(String(post._id), { status: 'published' })

    expect(response.status).toBe(200)
    const after = await PostModel.findById(post._id)
    expect(after?.status).toBe('published')
    expect(after?.publishedAt).not.toBeNull()
  })

  it('stamps publishedAt only once, so a republish does not rewrite the feed date', async () => {
    const when = new Date('2026-01-01T00:00:00.000Z')
    const post = await makePost({ status: 'archived', publishedAt: when })

    await call(String(post._id), { status: 'published' })

    expect(
      (await PostModel.findById(post._id))?.publishedAt?.toISOString()
    ).toBe(when.toISOString())
  })

  it('lets a NEVER-published archived post go back to draft', async () => {
    /*
      Every generated post is created `archived` with `publishedAt: null`. The transition guard
      used to key on status alone and refused this, telling the author their URL "has been
      public" about a slug nobody had ever seen - and trapping generated posts out of the drafts
      list for a reason that did not apply to them.
    */
    const post = await makePost({ status: 'archived', publishedAt: null })

    const response = await call(String(post._id), { status: 'draft' })

    expect(response.status).toBe(200)
    expect((await PostModel.findById(post._id))?.status).toBe('draft')
  })

  it('still refuses draft for an archived post that WAS published', async () => {
    // The control, and the case the rule was written for: draft is where slugs are editable,
    // and this URL is indexed and in somebody's feed reader.
    const post = await makePost({ status: 'archived', publishedAt: new Date() })

    const response = await call(String(post._id), { status: 'draft' })

    expect(response.status).toBe(409)
    expect((await PostModel.findById(post._id))?.status).toBe('archived')
  })

  it('refuses to reach the deleted state through PATCH', async () => {
    const post = await makePost()

    expect((await call(String(post._id), { status: 'deleted' })).status).toBe(
      400
    )
  })
})

describe('the cover image, the one image URL a reader gets unfiltered', () => {
  it('accepts a URL from our own Cloudinary account', async () => {
    const post = await makePost()

    expect(
      (await call(String(post._id), { coverImage: CLOUD_URL })).status
    ).toBe(200)
    expect((await PostModel.findById(post._id))?.coverImage).toBe(CLOUD_URL)
  })

  it.each([
    ['another host', 'https://cdn.some-tool.ai/out/abc.png'],
    [
      'another cloud account',
      'https://res.cloudinary.com/someone-else/image/upload/v1/a.png',
    ],
    [
      'plain http',
      'http://res.cloudinary.com/test-cloud/image/upload/v1/a.png',
    ],
    ['a protocol-relative URL', '//evil.example/x.png'],
    ['a data URI', 'data:image/png;base64,iVBORw0KGgo='],
  ])('refuses %s', async (_label, url) => {
    /*
      The body's images are guarded by `rehypeRestrictImageHosts`; the cover is rendered
      straight into an `<img src>` by the post page and the share card, so it bypassed the
      pipeline entirely. An off-host cover leaks every reader's IP and User-Agent to a third
      party, on a page whose whole premise is that it does not do that.
    */
    const post = await makePost()

    const response = await call(String(post._id), { coverImage: url })

    expect(response.status).toBe(400)
    expect((await PostModel.findById(post._id))?.coverImage).toBeNull()
  })

  it('still allows clearing the cover', async () => {
    const post = await makePost({ coverImage: CLOUD_URL })

    expect((await call(String(post._id), { coverImage: null })).status).toBe(
      200
    )
    expect((await PostModel.findById(post._id))?.coverImage).toBeNull()
  })
})

describe('image prompts', () => {
  it('refuses more than the cap instead of silently dropping the extras', async () => {
    /*
      This used to `.slice()` and return 200. The editor renders one card per placeholder and
      `findImagePlaceholders` has no cap, so a body with thirteen placeholders gave the author
      thirteen editable cards and threw the last one away on save, under a success banner.
      Silent data loss on the write path is the worst shape this can take - nothing prompts the
      author to look.
    */
    const post = await makePost()
    const prompts = Array.from({ length: MAX_IMAGE_PROMPTS + 1 }, (_, n) => ({
      key: `image${n + 1}`,
      prompt: 'A picture.',
    }))

    const response = await call(String(post._id), { imagePrompts: prompts })

    expect(response.status).toBe(409)
    expect((await PostModel.findById(post._id))?.imagePrompts).toHaveLength(0)
  })

  it('accepts exactly the cap', async () => {
    const post = await makePost()
    const prompts = Array.from({ length: MAX_IMAGE_PROMPTS }, (_, n) => ({
      key: `image${n + 1}`,
      prompt: 'A picture.',
    }))

    expect(
      (await call(String(post._id), { imagePrompts: prompts })).status
    ).toBe(200)
    expect((await PostModel.findById(post._id))?.imagePrompts).toHaveLength(
      MAX_IMAGE_PROMPTS
    )
  })

  it.each([
    ['an empty key', ''],
    ['a key that is not a placeholder', 'cover'],
    ['a key with the wrong shape', 'image-1'],
  ])(
    'refuses %s with a written message, not raw mongoose text',
    async (_label, key) => {
      // `key` was accepted on `typeof === 'string'` alone, so `''` passed the filter and then
      // failed `required` at save - surfacing "Path `key` is required" to the client. Nothing
      // bounded its length either.
      const post = await makePost()

      const response = await call(String(post._id), {
        imagePrompts: [{ key, prompt: 'x' }],
      })
      const body = (await response.json()) as { error?: string }

      expect(response.status).toBe(400)
      expect(body.error).not.toMatch(/Path `|validation failed/)
    }
  )

  it('does not move contentUpdatedAt - prompts are not reader-visible content', async () => {
    const post = await makePost()
    const before = post.contentUpdatedAt?.toISOString()

    await call(String(post._id), {
      imagePrompts: [{ key: 'image1', prompt: 'A picture.' }],
      coverImagePrompt: 'A cover.',
    })

    expect(
      (await PostModel.findById(post._id))?.contentUpdatedAt?.toISOString()
    ).toBe(before)
  })

  it('leaves both prompt fields untouched when they are omitted', async () => {
    // Backwards compatibility: an older client that does not know these fields must not clear
    // them by saying nothing about them.
    const post = await makePost({
      coverImagePrompt: 'A cover.',
      imagePrompts: [{ key: 'image1', prompt: 'A picture.' }],
    })

    await call(String(post._id), { title: 'A new title' })

    const after = await PostModel.findById(post._id)
    expect(after?.coverImagePrompt).toBe('A cover.')
    expect(after?.imagePrompts).toHaveLength(1)
  })
})
