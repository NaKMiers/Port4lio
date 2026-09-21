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

import { KindModel } from '@/models/Kind'
import { PostModel } from '@/models/Post'
import { SeriesModel } from '@/models/Series'

/**
 * `POST /api/admin/blog/generate`, against a real database with the model stubbed.
 *
 * ## What this file is for
 *
 * The pure half of generation is covered by `tests/unit/blog-generate.test.ts` - prompt
 * building, and the validation of everything the model says back. None of that needed a
 * database, and none of it could reach the parts of this feature that do: the archive default,
 * slug allocation, the pillar guard, the rewrite path, and the mapping from an LLM failure to
 * a status code. Those live in the handler, and the handler had no test.
 *
 * The archive default is the one to look at first. "Default mark as archived, only publish when
 * the user presses publish" was the stated requirement of the whole feature, and nothing
 * anywhere asserted it - a one-word edit to `status: 'draft'` would have shipped green.
 *
 * ## Why `chatCompletion` is mocked and nothing else is
 *
 * It is the only boundary in the handler that leaves the process, and it costs money per call.
 * Everything else - the taxonomies, the uniqueness index, the pillar index, the schema
 * validators - is exercised for real against `mongodb-memory-server`, because those are
 * precisely the things a hand-rolled fake would get wrong in the same direction as the code.
 */

/** Set per test. The handler's whole job is turning this into a saved document. */
let reply: Record<string, unknown>

vi.mock('@/lib/blog/llm', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/blog/llm')>('@/lib/blog/llm')
  return {
    ...actual,
    chatCompletion: vi.fn(async () => ({
      text: JSON.stringify(reply),
      model: 'ag/claude-sonnet-4-6',
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    })),
  }
})

// `revalidatePath` needs the static-generation store that only exists inside a real request;
// called from vitest it throws. Mocked at our own wrapper rather than at `next/cache`, so the
// boundary is a module this repo owns.
vi.mock('@/lib/blog/revalidate', () => ({ revalidatePublishedPost: vi.fn() }))

// Shiki costs a ~5.5s bootstrap per process and renders HTML this file never asserts on. The
// pipeline has its own tests; paying for it here would dominate the runtime of every case.
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
let POST: (request: NextRequest) => Promise<Response>
let chatCompletion: ReturnType<typeof vi.fn>

beforeAll(async () => {
  memory = await MongoMemoryServer.create()
  process.env.MONGODB_URI = memory.getUri()
  process.env.REQUIRE_ADMIN = 'false'
  process.env.LLM_API_KEY = 'test-key'
  await mongoose.connect(memory.getUri())
  ;({ POST } = await import('@/app/api/admin/blog/generate/route'))
  ;({ chatCompletion } = (await import('@/lib/blog/llm')) as unknown as {
    chatCompletion: ReturnType<typeof vi.fn>
  })
}, 120_000)

afterAll(async () => {
  await mongoose.disconnect()
  await memory.stop()
})

beforeEach(async () => {
  reply = {
    title: 'Five things I measured',
    slug: 'five-things-i-measured',
    excerpt: 'An excerpt.',
    bodyMarkdown: '## A heading\n\nSome prose.',
    kind: 'article',
    tags: ['nextjs'],
  }
  await KindModel.create({ slug: 'article', label: 'Article', order: 0 })
})

afterEach(async () => {
  vi.clearAllMocks()
  await Promise.all([
    PostModel.deleteMany({}),
    KindModel.deleteMany({}),
    SeriesModel.deleteMany({}),
  ])
})

function call(body: Record<string, unknown>) {
  // `NextRequest`, not `Request`: the handler reads `request.cookies` through `requireOwner`.
  const request = new NextRequest('http://localhost/api/admin/blog/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return POST(request)
}

/** A spec with every field on auto - what the dialog sends when the author touches nothing. */
const AUTO = {}

/** One field pinned. `normaliseSpec` keys off the registry, so the shape has to be exact. */
function manual(key: string, value: string | string[] | boolean) {
  return { [key]: { mode: 'manual', value } }
}

describe('the archive default - the requirement the feature was built around', () => {
  it('saves a generated post as archived, never published or draft', async () => {
    /*
      The single most important assertion in this file. "Default mark as achieved [archived],
      only publish when user press publish" was the requirement; `status: 'archived'` at the
      create is the whole of its implementation, and it had nothing holding it in place.
    */
    const response = await call({ spec: AUTO })
    const body = (await response.json()) as { status?: string; id?: string }

    expect(response.status).toBe(201)
    expect(body.status).toBe('archived')

    const saved = await PostModel.findById(body.id)
    expect(saved?.status).toBe('archived')
  })

  it('leaves publishedAt null, so the slug is still editable', async () => {
    // The pair to the archive default. `publishedAt` is what freezes a slug, so a generated
    // post the author wants to rename before publishing must not have it stamped.
    const response = await call({ spec: AUTO })
    const { id } = (await response.json()) as { id: string }

    expect((await PostModel.findById(id))?.publishedAt).toBeNull()
  })

  it('does not revalidate anything on a fresh generation', async () => {
    // An archived post has no public surface and its slug is brand new, so there is no cached
    // path to clear. Revalidating one would be a no-op that hides a real one going missing.
    const { revalidatePublishedPost } = await import('@/lib/blog/revalidate')

    await call({ spec: AUTO })

    expect(revalidatePublishedPost).not.toHaveBeenCalled()
  })
})

describe('slug allocation', () => {
  it('suffixes a model-chosen slug that is already taken', async () => {
    // The model did not choose this name in any meaningful sense, so failing a paid generation
    // over the collision would be absurd. It gets `-2`.
    await PostModel.create({
      slug: 'five-things-i-measured',
      title: 'Taken',
      kind: 'article',
    })

    const response = await call({ spec: AUTO })
    const body = (await response.json()) as { slug?: string }

    expect(response.status).toBe(201)
    expect(body.slug).toBe('five-things-i-measured-2')
  })

  it('refuses an AUTHOR-chosen slug that is taken, rather than silently moving it', async () => {
    // The opposite case and deliberately not symmetric: they asked for that URL. Handing them
    // `-2` would be a different post at a different address than the one they requested.
    await PostModel.create({
      slug: 'my-choice',
      title: 'Taken',
      kind: 'article',
    })

    const response = await call({ spec: manual('slug', 'my-choice') })

    expect(response.status).toBe(409)
    expect(await PostModel.countDocuments({})).toBe(1)
  })

  it('counts a soft-deleted post as holding its slug', async () => {
    /*
      A soft delete exists precisely to retain the slug, so `findFreeSlug` queries every status.
      If it filtered to live posts, generation would hand a new post the URL of a deleted one
      and it would inherit its contact attributions - the exact failure the soft delete prevents.
    */
    await PostModel.create({
      slug: 'five-things-i-measured',
      title: 'Deleted',
      kind: 'article',
      status: 'deleted',
    })

    const body = (await (await call({ spec: AUTO })).json()) as {
      slug?: string
    }

    expect(body.slug).toBe('five-things-i-measured-2')
  })
})

describe('validating what the author pinned, before the model is called', () => {
  it.each([
    ['a slug with spaces', 'slug', 'Five Things I Measured'],
    ['a reserved slug', 'slug', 'privacy'],
    ['a kind that does not exist', 'kind', 'newsletter'],
    ['a series that does not exist', 'series', 'ghosts'],
  ])('refuses %s without spending a completion', async (_label, key, value) => {
    /*
      The point is the second assertion, not the first. These checks also exist inside
      `parseGeneratedDraft`, which runs on the reply - twenty to ninety seconds and one billable
      call later. Catching them here turns a lost generation into an instant, fixable error.
    */
    const response = await call({ spec: manual(key, value) })

    expect(response.status).toBe(400)
    expect(chatCompletion).not.toHaveBeenCalled()
  })

  it('still calls the model when the pinned values are all valid', async () => {
    // The control. A guard that refuses everything would pass every case above.
    await SeriesModel.create({ slug: 'real-series', title: 'Real', order: 0 })

    const response = await call({
      spec: {
        ...manual('slug', 'a-fine-slug'),
        ...manual('kind', 'article'),
        ...manual('series', 'real-series'),
      },
    })

    expect(response.status).toBe(201)
    expect(chatCompletion).toHaveBeenCalledTimes(1)
  })
})

describe('the one-pillar-per-series invariant', () => {
  it('demotes a second pillar to an ordinary post and says so, rather than failing', async () => {
    // Checking before the save turns a lost generation into a warning and a saved post. The
    // partial unique index is still what holds the invariant under a concurrent write.
    await SeriesModel.create({ slug: 'a-series', title: 'A series', order: 0 })
    await PostModel.create({
      slug: 'the-hub',
      title: 'The hub',
      kind: 'article',
      series: 'a-series',
      isPillar: true,
    })

    const response = await call({
      spec: { ...manual('series', 'a-series'), ...manual('isPillar', true) },
    })
    const body = (await response.json()) as { id: string; warnings: string[] }

    expect(response.status).toBe(201)
    expect((await PostModel.findById(body.id))?.isPillar).toBe(false)
    expect(body.warnings.join(' ')).toMatch(/already has a pillar/)
  })
})

describe('rewriting an existing post', () => {
  async function existing(overrides: Record<string, unknown> = {}) {
    return PostModel.create({
      slug: 'an-old-post',
      title: 'An old post',
      kind: 'article',
      bodyMarkdown: '## Old\n\nOld prose.',
      ...overrides,
    })
  }

  it('overwrites in place and returns 200 rather than creating a second post', async () => {
    const post = await existing()
    reply.slug = 'an-old-post'

    const response = await call({ spec: AUTO, postId: String(post._id) })
    const body = (await response.json()) as { replaced?: boolean; id?: string }

    expect(response.status).toBe(200)
    expect(body.replaced).toBe(true)
    expect(body.id).toBe(String(post._id))
    expect(await PostModel.countDocuments({})).toBe(1)
  })

  it('keeps status and publishedAt, so rewriting a live post does not silently unpublish it', async () => {
    const when = new Date('2026-01-01T00:00:00.000Z')
    const post = await existing({ status: 'published', publishedAt: when })
    reply.slug = 'an-old-post'

    await call({ spec: AUTO, postId: String(post._id) })

    const after = await PostModel.findById(post._id)
    expect(after?.status).toBe('published')
    expect(after?.publishedAt?.toISOString()).toBe(when.toISOString())
  })

  it('carries the old body images forward instead of publishing broken ones', async () => {
    /*
      A measured regression, and the worst one this feature had. A rewrite replaces the whole
      body, and a text model can only emit placeholders - so a PUBLISHED post with uploaded
      pictures had them swapped for `![image](image1)`, kept `status: 'published'`, and
      revalidated. `rehypeRestrictImageHosts` deletes the `src` and keeps the node, so every
      reader of a live article saw a broken-image icon.
    */
    const url = 'https://res.cloudinary.com/demo/image/upload/v1/a.png'
    const post = await existing({
      status: 'published',
      publishedAt: new Date(),
      bodyMarkdown: `## Old\n\n![a chart](${url})`,
    })
    reply.slug = 'an-old-post'
    reply.bodyMarkdown = '## New\n\n![image](image1)'

    const response = await call({ spec: AUTO, postId: String(post._id) })
    const body = (await response.json()) as { warnings: string[] }

    const after = await PostModel.findById(post._id).select('+bodyMarkdown')
    expect(after?.bodyMarkdown).toContain(url)
    expect(after?.bodyMarkdown).not.toContain('(image1)')
    expect(body.warnings.join(' ')).toMatch(/Kept 1 image/)
  })

  it('names the pictures that no longer fit when the new body has fewer images', async () => {
    // The surplus case. Dropping a paid-for upload silently would be the same class of
    // failure as blanking it, so the URL is quoted back.
    const a = 'https://res.cloudinary.com/demo/image/upload/v1/a.png'
    const b = 'https://res.cloudinary.com/demo/image/upload/v1/b.png'
    const post = await existing({
      bodyMarkdown: `![one](${a})\n\n![two](${b})`,
    })
    reply.slug = 'an-old-post'
    reply.bodyMarkdown = '## New\n\n![image](image1)'

    const body = (await (
      await call({ spec: AUTO, postId: String(post._id) })
    ).json()) as {
      warnings: string[]
    }

    expect(body.warnings.join(' ')).toContain(b)
  })

  it('refuses to rewrite a soft-deleted post', async () => {
    // Its slug is held against reuse. Rewriting one resurrects a URL the author retired.
    const post = await existing({ status: 'deleted' })

    const response = await call({ spec: AUTO, postId: String(post._id) })

    expect(response.status).toBe(409)
  })

  it('refuses to change the slug of a published post', async () => {
    const post = await existing({
      status: 'published',
      publishedAt: new Date(),
    })
    reply.slug = 'a-brand-new-slug'

    const response = await call({
      spec: manual('slug', 'a-brand-new-slug'),
      postId: String(post._id),
    })

    expect(response.status).toBe(409)
    expect((await PostModel.findById(post._id))?.slug).toBe('an-old-post')
  })

  it('does not collide with its own slug when the slug is unchanged', async () => {
    // Without the self-exclusion branch every regeneration 409s on the post's own URL.
    const post = await existing()
    reply.slug = 'an-old-post'

    expect((await call({ spec: AUTO, postId: String(post._id) })).status).toBe(
      200
    )
  })

  it('404s an unknown postId', async () => {
    const response = await call({
      spec: AUTO,
      postId: '000000000000000000000000',
    })

    expect(response.status).toBe(404)
  })

  it('does not offer the post being rewritten as related to itself', async () => {
    /*
      The post sat in its own candidate list, so the model could validly pick it and
      `resolveRelated` would accept it - it IS a published slug. The live page then rendered a
      "related" link back to the page the reader was already on.
    */
    const post = await existing({
      status: 'published',
      publishedAt: new Date(),
    })
    reply.slug = 'an-old-post'
    reply.relatedSlugs = ['an-old-post']

    await call({ spec: AUTO, postId: String(post._id) })

    expect((await PostModel.findById(post._id))?.relatedSlugs).toEqual([])
  })
})

describe('related posts the author pinned by hand', () => {
  it('keeps a curated link to a post outside the prompt window', async () => {
    /*
      `relatedCandidates` is capped at 40 because it is a PROMPT budget, and that same set was
      being used to validate the AUTHOR's list. With more than 40 published posts, a curated
      link to an older one was dropped and the author was told it "does not exist" - a false
      statement about a live post. Regeneration hit this hardest: the preset pins the post's
      own related list, so every rewrite stripped its oldest links.
    */
    for (let n = 0; n < 45; n += 1)
      await PostModel.create({
        slug: `filler-${n}`,
        title: `Filler ${n}`,
        kind: 'article',
        status: 'published',
        publishedAt: new Date(2026, 0, n + 1),
      })

    // `filler-0` is the oldest, so it is outside the 40 newest.
    const response = await call({ spec: manual('relatedSlugs', ['filler-0']) })
    const body = (await response.json()) as { id: string; warnings: string[] }

    expect((await PostModel.findById(body.id))?.relatedSlugs).toEqual([
      'filler-0',
    ])
    expect(body.warnings.join(' ')).not.toMatch(/do not exist/)
  })

  it('still drops a pinned slug that really is not a published post', async () => {
    // The control for the case above - the check was loosened, not removed.
    const body = (await (
      await call({ spec: manual('relatedSlugs', ['no-such-post']) })
    ).json()) as {
      id: string
      warnings: string[]
    }

    expect((await PostModel.findById(body.id))?.relatedSlugs).toEqual([])
    expect(body.warnings.join(' ')).toMatch(/do not exist/)
  })
})

describe('image placeholders', () => {
  it('caps the prompts at the schema limit instead of losing the whole generation', async () => {
    /*
      `imagePrompts` is capped at 12 by the schema, which rejects the WHOLE document past it.
      Reaching that means the author has already paid for the completion, so the cap is applied
      before the write - the same reason tags break at 8 and related slugs at 5.
    */
    const keys = Array.from({ length: 15 }, (_, n) => `image${n + 1}`)
    reply.bodyMarkdown = `## Heading\n\n${keys.map(key => `![image](${key})`).join('\n\n')}`
    reply.imagePrompts = keys.map(key => ({
      key,
      prompt: `A picture for ${key}.`,
    }))

    const response = await call({ spec: AUTO })
    const body = (await response.json()) as {
      id: string
      imageCount: number
      warnings: string[]
    }

    expect(response.status).toBe(201)
    expect(body.imageCount).toBe(12)
    expect((await PostModel.findById(body.id))?.imagePrompts).toHaveLength(12)
    expect(body.warnings.join(' ')).toMatch(/only 12 can carry a prompt/)
  })
})

describe('what happens when the model does not cooperate', () => {
  it('maps an unparseable reply to 422, not 500 - the request was fine, the answer was not', async () => {
    chatCompletion.mockResolvedValueOnce({
      text: 'I cannot do that.',
      model: 'x',
      usage: undefined,
    })

    const response = await call({ spec: AUTO })

    expect(response.status).toBe(422)
    expect(await PostModel.countDocuments({})).toBe(0)
  })

  it('maps a reply with no body to 422 and saves nothing', async () => {
    // One of the only two fatal parse failures. A post with no text has no sensible fallback.
    reply.bodyMarkdown = ''

    const response = await call({ spec: AUTO })

    expect(response.status).toBe(422)
    expect(await PostModel.countDocuments({})).toBe(0)
  })

  it('re-emits an upstream 429 as a 429, so the client can back off', async () => {
    const { LlmError } =
      await vi.importActual<typeof import('@/lib/blog/llm')>('@/lib/blog/llm')
    chatCompletion.mockRejectedValueOnce(new LlmError('Rate limited.', 429))

    expect((await call({ spec: AUTO })).status).toBe(429)
  })

  it('maps any other LLM failure to 502 rather than blaming our own database', async () => {
    const { LlmError } =
      await vi.importActual<typeof import('@/lib/blog/llm')>('@/lib/blog/llm')
    chatCompletion.mockRejectedValueOnce(
      new LlmError('Could not reach the model endpoint.', null)
    )

    expect((await call({ spec: AUTO })).status).toBe(502)
  })
})

describe('the preconditions', () => {
  it('re-seeds the default kinds rather than refusing, because listKinds seeds', async () => {
    /*
      Not the assertion this test was first written to make, and the difference is worth
      recording. The route carries a `kinds.length === 0` guard returning 409, and it is
      UNREACHABLE: `listKinds` calls `ensureKindsSeeded` first, so an empty collection heals
      itself before the guard ever sees it.
      
      The guard is kept as a backstop - it costs one comparison and it is the correct answer if
      seeding is ever made conditional - but nothing should be written on the belief that it
      fires. This test pins the behaviour that actually happens.
    */
    await KindModel.deleteMany({})

    const response = await call({ spec: AUTO })

    expect(response.status).toBe(201)
    expect(await KindModel.countDocuments({})).toBeGreaterThan(0)
  })

  it('reports unknown spec keys as warnings rather than failing', async () => {
    // The dialog and the route share one registry, so an unknown key means a stale client.
    // Dropping it loudly is better than a 400 that makes the whole dialog unusable.
    const body = (await (
      await call({ spec: manual('notAField', 'x') })
    ).json()) as {
      warnings: string[]
    }

    expect(body.warnings.join(' ')).toMatch(/notAField/)
  })
})
