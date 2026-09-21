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
import { RateLimitModel } from '@/models/RateLimit'
import { SeriesModel } from '@/models/Series'

/**
 * `POST /api/cron/blog`, against a real database with the two paid boundaries stubbed.
 *
 * ## What this file is for
 *
 * The sampler has its own unit tests and the generation core is covered by
 * `tests/api/blog-generate.test.ts`. What is only true HERE is the chain: the secret gate, the
 * once-a-day guard, and - the reason the feature exists in this shape - what happens to a post
 * when an image refuses to be drawn. The requirement was explicit about that case: skip the
 * image, keep its prompt, keep going, leave the post archived. Every clause of that is a
 * separate way to get it wrong.
 *
 * ## Why `drawImageAsset` is the stub and not `generateImage`
 *
 * It is the whole paid leg in one function - the Gemini call AND the Cloudinary upload - so
 * stubbing it leaves the orchestration, the saves, the publish decision and the deadline
 * arithmetic all running for real. Stubbing `generateImage` alone would leave an upload trying
 * to reach Cloudinary with test credentials.
 */

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

/** Set per test: what the next image call does. */
let drawBehaviour: (name: string) => Promise<{ url: string; model: string }>

vi.mock('@/lib/blog/image-asset', () => ({
  drawImageAsset: vi.fn(async ({ name }: { name: string }) =>
    drawBehaviour(name)
  ),
}))

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
let POST: (request: NextRequest) => Promise<Response>

const SECRET = 'a-very-secret-cron-token'

/** A body with two placeholders, so the cover plus two images are always planned. */
const BODY_WITH_IMAGES = [
  '## A heading',
  '',
  'Some prose.',
  '',
  '![a chart](image1)',
  '',
  'More prose.',
  '',
  '![the fix](image2)',
].join('\n')

beforeAll(async () => {
  memory = await MongoMemoryServer.create()
  process.env.MONGODB_URI = memory.getUri()
  process.env.LLM_API_KEY = 'test-key'
  process.env.CRON_SECRET = SECRET
  await mongoose.connect(memory.getUri())
  ;({ POST } = await import('@/app/api/cron/blog/route'))
}, 120_000)

afterAll(async () => {
  await mongoose.disconnect()
  await memory.stop()
})

beforeEach(async () => {
  process.env.CRON_SECRET = SECRET
  drawBehaviour = async (name: string) => ({
    url: `https://res.cloudinary.com/demo/image/upload/${name}.jpg`,
    model: 'gemini-3.1-flash-image',
  })
  reply = {
    title: 'Five things I measured',
    slug: 'five-things-i-measured',
    excerpt: 'An excerpt.',
    bodyMarkdown: BODY_WITH_IMAGES,
    kind: 'article',
    tags: ['nextjs'],
    coverImagePrompt: 'Isometric render of a build pipeline',
    imagePrompts: [
      { key: 'image1', prompt: 'A flame chart with one tall bar' },
      { key: 'image2', prompt: 'The same chart, flat' },
    ],
  }
  await KindModel.create({ slug: 'article', label: 'Article', order: 0 })
})

afterEach(async () => {
  vi.clearAllMocks()
  await Promise.all([
    PostModel.deleteMany({}),
    KindModel.deleteMany({}),
    SeriesModel.deleteMany({}),
    // The once-a-day guard lives in this collection. Without clearing it every case after
    // the first would be refused, and they would all pass for the wrong reason.
    RateLimitModel.deleteMany({}),
  ])
})

function call(secret: string | null = SECRET) {
  const request = new NextRequest('http://localhost/api/cron/blog', {
    method: 'POST',
    headers: secret === null ? {} : { authorization: `Bearer ${secret}` },
  })
  return POST(request)
}

type CronBody = {
  id?: string
  slug?: string
  status?: string
  published?: boolean
  angle?: string
  imagesMade?: number
  imagesSkipped?: number
  blockers?: string[]
  warnings?: string[]
  skipped?: string
  error?: string
}

describe('the gate', () => {
  it('404s a caller with no Authorization header', async () => {
    const response = await call(null)

    expect(response.status).toBe(404)
    expect(await PostModel.countDocuments()).toBe(0)
  })

  it('404s a wrong secret', async () => {
    expect((await call('not-the-secret')).status).toBe(404)
  })

  it('404s a secret that is a prefix of the real one', async () => {
    // The length check runs before `timingSafeEqual`, which needs equal buffers. A prefix is
    // the input that would throw rather than refuse if that check were missing.
    expect((await call(SECRET.slice(0, 5))).status).toBe(404)
  })

  it('refuses everything when CRON_SECRET is unset, rather than running open', async () => {
    /*
      The failure this prevents is a fresh deploy with the variable missing: a public endpoint
      that writes to the database and publishes to the live site, looking completely healthy.
    */
    delete process.env.CRON_SECRET

    const response = await call(null)

    expect(response.status).toBe(404)
    expect(await PostModel.countDocuments()).toBe(0)
  })

  it('says nothing about the route existing', async () => {
    // 404, not 401 - an unauthenticated caller should not be able to confirm the endpoint is
    // there, let alone that it takes a bearer token.
    const body = (await (await call('wrong')).json()) as CronBody

    expect(body.error).toBe('Not found.')
  })
})

describe('one blog a day', () => {
  it('writes a post on the first call', async () => {
    const response = await call()
    const body = (await response.json()) as CronBody

    expect(response.status).toBe(201)
    expect(await PostModel.countDocuments()).toBe(1)
    expect(body.slug).toBe('five-things-i-measured')
  })

  it('refuses the second call in the same window', async () => {
    await call()
    const response = await call()
    const body = (await response.json()) as CronBody

    expect(response.status).toBe(429)
    expect(body.skipped).toBe('already-ran')
    expect(await PostModel.countDocuments()).toBe(1)
  })

  it('refuses a retry without spending a model call', async () => {
    // The scenario the guard is actually for: a scheduler whose HTTP timeout is shorter than
    // this route retries while the first run is still going. The counter increments before
    // the work starts, so the retry is refused rather than billed.
    const { chatCompletion } = (await import('@/lib/blog/llm')) as unknown as {
      chatCompletion: ReturnType<typeof vi.fn>
    }
    await call()
    chatCompletion.mockClear()

    await call()

    expect(chatCompletion).not.toHaveBeenCalled()
  })

  it('counts by the blog, not by the caller address', async () => {
    // A scheduler's egress IP changes between retries. An IP-keyed bucket would hand each new
    // address a fresh allowance, which is the whole guard defeated.
    await call()

    const request = new NextRequest('http://localhost/api/cron/blog', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${SECRET}`,
        'x-forwarded-for': '203.0.113.9',
      },
    })

    expect((await POST(request)).status).toBe(429)
  })
})

describe('images are on by default', () => {
  it('draws the cover and every placeholder without being asked', async () => {
    const body = (await (await call()).json()) as CronBody

    expect(body.imagesMade).toBe(3)
    expect(body.imagesSkipped).toBe(0)
  })

  it('resolves the placeholders in the saved body', async () => {
    const body = (await (await call()).json()) as CronBody
    const post = await PostModel.findById(body.id).select('+bodyMarkdown')

    expect(post?.bodyMarkdown).not.toContain('(image1)')
    expect(post?.bodyMarkdown).toContain('res.cloudinary.com')
    expect(post?.coverImage).toContain('res.cloudinary.com')
  })

  it('keeps the alt text through the replacement', async () => {
    const body = (await (await call()).json()) as CronBody
    const post = await PostModel.findById(body.id).select('+bodyMarkdown')

    expect(post?.bodyMarkdown).toContain(
      '![a chart](https://res.cloudinary.com'
    )
  })

  it('publishes a post that came out whole', async () => {
    const body = (await (await call()).json()) as CronBody

    expect(body.published).toBe(true)
    expect(body.status).toBe('published')
    expect((await PostModel.findById(body.id))?.status).toBe('published')
  })

  it('stamps publishedAt once when it publishes', async () => {
    const body = (await (await call()).json()) as CronBody

    expect((await PostModel.findById(body.id))?.publishedAt).toBeInstanceOf(
      Date
    )
  })

  it('revalidates the path it just made public', async () => {
    const { revalidatePublishedPost } = await import('@/lib/blog/revalidate')

    await call()

    expect(revalidatePublishedPost).toHaveBeenCalledWith(
      'five-things-i-measured'
    )
  })
})

describe('when an image fails', () => {
  beforeEach(() => {
    // The cover succeeds, `image1` refuses, `image2` succeeds - so the run has to survive a
    // failure in the middle rather than at the end.
    drawBehaviour = async (name: string) => {
      if (name.endsWith('image1')) throw new Error('Gemini returned no image.')
      return {
        url: `https://res.cloudinary.com/demo/image/upload/${name}.jpg`,
        model: 'gemini-3.1-flash-image',
      }
    }
  })

  it('keeps going and draws the rest', async () => {
    const body = (await (await call()).json()) as CronBody

    expect(body.imagesMade).toBe(2)
    expect(body.imagesSkipped).toBe(1)
  })

  it('leaves the post archived rather than publishing a broken image', async () => {
    /*
      The stated requirement, and the reason it matters: an unresolved placeholder is refused
      by `rehypeRestrictImageHosts` and renders as a sourceless `<img>` - a broken-image icon
      on a live page. Archived is the honest state for a post that is not finished.
    */
    const body = (await (await call()).json()) as CronBody

    expect(body.published).toBe(false)
    expect(body.status).toBe('archived')
    expect((await PostModel.findById(body.id))?.status).toBe('archived')
  })

  it('never stamps publishedAt, so the slug stays editable', async () => {
    const body = (await (await call()).json()) as CronBody

    expect((await PostModel.findById(body.id))?.publishedAt).toBeNull()
  })

  it('keeps the image prompt, so the editor still offers the card', async () => {
    // "Still create image prompt as normal" - the post has to arrive as a task, not as a hole.
    const body = (await (await call()).json()) as CronBody
    const post = await PostModel.findById(body.id)

    expect(
      post?.imagePrompts.find(entry => entry.key === 'image1')?.prompt
    ).toBe('A flame chart with one tall bar')
  })

  it('keeps the placeholder in the body for that key only', async () => {
    const body = (await (await call()).json()) as CronBody
    const post = await PostModel.findById(body.id).select('+bodyMarkdown')

    expect(post?.bodyMarkdown).toContain('![a chart](image1)')
    expect(post?.bodyMarkdown).not.toContain('(image2)')
  })

  it('says why it did not publish', async () => {
    const body = (await (await call()).json()) as CronBody

    expect(body.blockers).toEqual(['"image1" is still a placeholder'])
  })

  it('names the failure in the warnings', async () => {
    const body = (await (await call()).json()) as CronBody

    expect(body.warnings?.join(' ')).toContain(
      'Its prompt is still on the post'
    )
  })

  it('still saves the images that did work', async () => {
    // The per-image save. A run that batched them would have lost the cover and image2 too.
    const body = (await (await call()).json()) as CronBody
    const post = await PostModel.findById(body.id).select('+bodyMarkdown')

    expect(post?.coverImage).toContain('res.cloudinary.com')
    expect(post?.bodyMarkdown).toContain(
      '![the fix](https://res.cloudinary.com'
    )
  })

  it('leaves the post archived when EVERY image fails', async () => {
    drawBehaviour = async () => {
      throw new Error('Gemini is rate limiting us.')
    }

    const body = (await (await call()).json()) as CronBody

    expect(body.imagesMade).toBe(0)
    expect(body.imagesSkipped).toBe(3)
    expect(body.status).toBe('archived')
    expect((await PostModel.findById(body.id))?.status).toBe('archived')
  })
})

describe('a post with no pictures in it', () => {
  it('stays archived, because a post with no cover has no og:image', async () => {
    // Not a failure - `publishBlockers` refuses it for the cover alone. A share of a post
    // with no cover is a bare link, which is a worse outcome than a day's delay.
    reply = { ...reply, bodyMarkdown: 'Just prose.', coverImagePrompt: '' }

    const body = (await (await call()).json()) as CronBody

    expect(body.imagesMade).toBe(0)
    expect(body.published).toBe(false)
    expect(body.blockers).toEqual(['it has no cover image'])
  })
})

describe('the brief', () => {
  it('reports which angle it drew', async () => {
    const body = (await (await call()).json()) as CronBody

    expect(typeof body.angle).toBe('string')
    expect(body.angle?.length).toBeGreaterThan(0)
  })

  it('still has a kind to sample even when the collection is empty', async () => {
    /*
      Not the assertion this test started as. It was written expecting a 409 from the route's
      own "no kinds exist" guard, and that guard turns out to be unreachable: `listKinds`
      calls `ensureKindsSeeded` first, so an emptied collection is refilled with the defaults
      on the way past.

      Worth keeping as the record of that, because the sampler's behaviour hangs on it - an
      empty `kinds` array would leave `kind` on auto and hand the choice back to the model,
      which is the one thing the sampler exists to stop. The guard stays in the route as
      defence for a seeding path that changes later.
    */
    await KindModel.deleteMany({})

    const response = await call()
    const body = (await response.json()) as CronBody

    expect(response.status).toBe(201)
    expect(await KindModel.countDocuments()).toBeGreaterThan(0)
    expect(body.slug).toBe('five-things-i-measured')
  })

  it('sends the model the titles it has already written', async () => {
    /*
      The anti-repetition lever, and the one that is easy to get subtly wrong: the list must
      include ARCHIVED posts. Every post this job makes is archived until the owner reads it,
      so a published-only list means day two cannot see day one.
    */
    await PostModel.create({
      slug: 'an-older-post',
      title: 'An older archived post',
      kind: 'article',
      bodyMarkdown: 'text',
      bodyHtml: '<p>text</p>',
      status: 'archived',
    })

    const { chatCompletion } = (await import('@/lib/blog/llm')) as unknown as {
      chatCompletion: ReturnType<typeof vi.fn>
    }
    await call()

    const prompt = JSON.stringify(chatCompletion.mock.calls[0]?.[0])
    expect(prompt).toContain('An older archived post')
  })
})
