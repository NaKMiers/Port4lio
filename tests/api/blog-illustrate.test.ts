import { MongoMemoryServer } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import { PostModel } from '@/models/Post'

/**
 * `lib/blog/illustrate-run.ts` after the MCP changes (mcp-plan.md R2, R3, R5).
 *
 * ```
 *   lease     double start ──▶ "already running" · expired lease ──▶ taken over
 *   patch     an edit made during the run survives · a removed placeholder is skipped
 *   publish   publish: false never publishes, even a whole post
 *   status    every failure lands in illustration.lastError; the lease is released
 *   budget    spendImage out ──▶ lastError "rate limit", the run stops cleanly
 * ```
 *
 * `drawImageAsset` is the stub, as in `blog-cron-route.test.ts`, so a test can act inside
 * the minutes a real image would take - which is exactly where the concurrency bugs live.
 */

const draw = vi.hoisted(() => vi.fn())
vi.mock('@/lib/blog/image-asset', () => ({ drawImageAsset: draw }))
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

const URL = (name: string) =>
  `https://res.cloudinary.com/test-cloud/image/upload/v1/${name}.png`

let memory: MongoMemoryServer
let run: typeof import('@/lib/blog/illustrate-run')
let revalidate: ReturnType<typeof vi.fn>

beforeAll(async () => {
  memory = await MongoMemoryServer.create()
  process.env.MONGODB_URI = memory.getUri()
  process.env.CLOUDINARY_CLOUD_NAME = 'test-cloud'
  await mongoose.connect(memory.getUri())
  run = await import('@/lib/blog/illustrate-run')
  revalidate = (await import('@/lib/blog/revalidate'))
    .revalidatePublishedPost as unknown as ReturnType<typeof vi.fn>
}, 120_000)

afterAll(async () => {
  await mongoose.disconnect()
  await memory.stop()
})

afterEach(async () => {
  vi.clearAllMocks()
  draw.mockReset()
  await PostModel.deleteMany({})
})

async function makePost(overrides: Record<string, unknown> = {}) {
  return PostModel.create({
    slug: 'illustrated',
    title: 'Illustrated',
    kind: 'article',
    status: 'draft',
    coverImagePrompt: 'A cover',
    bodyMarkdown:
      'Intro.\n\n![One](image1)\n\nMiddle.\n\n![Two](image2)\n\nEnd.',
    imagePrompts: [
      { key: 'image1', prompt: 'First picture' },
      { key: 'image2', prompt: 'Second picture' },
    ],
    ...overrides,
  })
}

const options = (
  overrides: Partial<Parameters<typeof run.runIllustration>[1]> = {}
) => ({
  model: 'gemini-3.1-flash-lite-image',
  deadlineAt: Date.now() + 240_000,
  publish: false,
  ...overrides,
})

const stored = (id: unknown) =>
  PostModel.findById(id).select('+bodyMarkdown').lean()

describe('the lease (R3)', () => {
  it('a second start while a run is live is refused with what is left', async () => {
    const post = await makePost()
    const id = String(post._id)
    expect(await run.claimIllustration(id, 3)).toMatchObject({
      claimed: true,
      planned: 3,
    })
    expect(await run.claimIllustration(id, 3)).toEqual({
      claimed: false,
      remaining: 3,
    })
  })

  it('an expired lease (a killed run) is taken over', async () => {
    const post = await makePost({
      illustration: {
        state: 'running',
        leaseUntil: new Date(Date.now() - 1_000),
        remaining: 2,
        lastError: null,
        startedAt: new Date(Date.now() - 400_000),
        finishedAt: null,
      },
    })
    expect(await run.claimIllustration(String(post._id), 3)).toMatchObject({
      claimed: true,
      planned: 3,
    })
    expect(
      (await stored(post._id))?.illustration?.leaseUntil?.getTime()
    ).toBeGreaterThan(Date.now())
  })

  it('two starts at the same moment: exactly one claims the lease', async () => {
    const post = await makePost()
    const id = String(post._id)
    const claims = await Promise.all([
      run.claimIllustration(id, 3),
      run.claimIllustration(id, 3),
    ])
    expect(claims.filter(claim => claim.claimed)).toHaveLength(1)
  })

  it('get_post reports a running lease that ran out as a cut-off run, not as running', async () => {
    const { illustrationStatus } = await import('@/lib/blog/post-service')
    const status = illustrationStatus({
      state: 'running',
      leaseUntil: new Date(Date.now() - 1_000),
      remaining: 2,
      lastError: null,
      startedAt: new Date(Date.now() - 400_000),
      finishedAt: null,
    })
    expect(status).toMatchObject({ state: 'failed', remaining: 2 })
    expect(status.lastError).toMatch(/cut off/)
  })

  it('a deleted post cannot be claimed', async () => {
    const post = await makePost({ status: 'deleted' })
    expect((await run.claimIllustration(String(post._id), 1)).claimed).toBe(
      false
    )
  })
})

describe('the run', () => {
  it('draws the cover and every placeholder, never publishes, and releases the lease', async () => {
    draw.mockImplementation(async ({ name }: { name: string }) => ({
      url: URL(name),
      model: 'm',
    }))
    const post = await makePost()
    const id = String(post._id)
    await run.claimIllustration(id, 3)
    const outcome = await run.runIllustration(id, options())

    expect(outcome).toMatchObject({
      imagesMade: 3,
      published: false,
      lastError: null,
    })
    const after = await stored(id)
    expect(after?.status).toBe('draft')
    expect(after?.coverImage).toBe(URL('illustrated-cover'))
    expect(after?.bodyMarkdown).toContain(
      `![One](${URL('illustrated-image1')})`
    )
    expect(after?.bodyMarkdown).toContain(
      `![Two](${URL('illustrated-image2')})`
    )
    expect(after?.illustration).toMatchObject({
      state: 'idle',
      leaseUntil: null,
      remaining: 0,
      lastError: null,
    })
    expect(revalidate).not.toHaveBeenCalled()
  })

  it('an edit made during the run survives the image saves', async () => {
    const post = await makePost()
    const id = String(post._id)
    draw.mockImplementation(async ({ name }: { name: string }) => {
      if (name.endsWith('image1'))
        // The owner (or update_post) fixes a word while the image is being drawn.
        await PostModel.updateOne(
          { _id: id },
          {
            $set: {
              bodyMarkdown: (await stored(id))!.bodyMarkdown!.replace(
                'Middle.',
                'Middle, edited.'
              ),
            },
          }
        )
      return { url: URL(name), model: 'm' }
    })
    await run.claimIllustration(id, 3)
    await run.runIllustration(id, options())

    const after = await stored(id)
    expect(after?.bodyMarkdown).toContain('Middle, edited.')
    expect(after?.bodyMarkdown).toContain(URL('illustrated-image1'))
    expect(after?.bodyMarkdown).toContain(URL('illustrated-image2'))
  })

  it('a placeholder removed during the run is skipped, not brought back', async () => {
    const post = await makePost()
    const id = String(post._id)
    draw.mockImplementation(async ({ name }: { name: string }) => {
      if (name.endsWith('image2'))
        await PostModel.updateOne(
          { _id: id },
          { $set: { bodyMarkdown: 'Intro.\n\n![One](image1)\n\nEnd.' } }
        )
      return { url: URL(name), model: 'm' }
    })
    await run.claimIllustration(id, 3)
    const outcome = await run.runIllustration(id, options())

    const after = await stored(id)
    expect(after?.bodyMarkdown).not.toContain('image2')
    expect(after?.bodyMarkdown).not.toContain(URL('illustrated-image2'))
    expect(outcome.warnings.join(' ')).toMatch(
      /Skipped image 2 of 2: it was removed/
    )
  })

  it('publish: false never publishes, even a post that came out whole', async () => {
    draw.mockImplementation(async ({ name }: { name: string }) => ({
      url: URL(name),
      model: 'm',
    }))
    const post = await makePost()
    await run.claimIllustration(String(post._id), 3)
    await run.runIllustration(String(post._id), options({ publish: false }))
    const after = await stored(post._id)
    expect(after?.status).toBe('draft')
    expect(after?.publishedAt).toBeNull()
  })

  it('a live post is revalidated after each image save, and stays live (C8)', async () => {
    draw.mockImplementation(async ({ name }: { name: string }) => ({
      url: URL(name),
      model: 'm',
    }))
    const post = await makePost({
      status: 'published',
      publishedAt: new Date(),
      coverImage: URL('existing'),
    })
    await run.claimIllustration(String(post._id), 2)
    await run.runIllustration(String(post._id), options())
    expect(revalidate).toHaveBeenCalledTimes(2)
    expect(revalidate).toHaveBeenCalledWith('illustrated')
    expect((await stored(post._id))?.coverImage).toBe(URL('existing'))
  })

  it('a failed image lands in lastError, the run keeps going, and ends failed', async () => {
    const { ImageGenError } = await import('@/lib/blog/image-gen')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    draw.mockImplementation(async ({ name }: { name: string }) => {
      if (name.endsWith('image1'))
        throw new ImageGenError('The model refused the prompt.', 400)
      return { url: URL(name), model: 'm' }
    })
    const post = await makePost()
    await run.claimIllustration(String(post._id), 3)
    const outcome = await run.runIllustration(String(post._id), options())

    expect(outcome.imagesMade).toBe(2)
    const after = await stored(post._id)
    expect(after?.bodyMarkdown).toContain('![One](image1)')
    expect(after?.illustration).toMatchObject({
      state: 'failed',
      leaseUntil: null,
      remaining: 1,
    })
    expect(after?.illustration?.lastError).toContain(
      'The model refused the prompt.'
    )
  })

  it('lastError keeps every failure of the run, not only the last', async () => {
    const { ImageGenError } = await import('@/lib/blog/image-gen')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    draw.mockImplementation(async ({ name }: { name: string }) => {
      if (name.endsWith('image1'))
        throw new ImageGenError('The model refused the prompt.', 400)
      if (name.endsWith('image2'))
        throw new ImageGenError('Quota exhausted.', 429)
      return { url: URL(name), model: 'm' }
    })
    const post = await makePost()
    await run.claimIllustration(String(post._id), 3)
    await run.runIllustration(String(post._id), options())
    const lastError = (await stored(post._id))?.illustration?.lastError ?? ''
    expect(lastError).toMatch(/^2 problems in this run/)
    expect(lastError).toContain('The model refused the prompt.')
    expect(lastError).toContain('Quota exhausted.')
  })

  it("a run's claim and bookkeeping never move updatedAt (no false stale-save banner)", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    draw.mockRejectedValue(new Error('down'))
    const post = await makePost()
    const before = (await stored(post._id))!.updatedAt.getTime()
    const claim = await run.claimIllustration(String(post._id), 3)
    await run.runIllustration(
      String(post._id),
      options(claim.claimed ? { fence: claim.startedAt } : {})
    )
    const after = await stored(post._id)
    expect(after?.illustration?.state).toBe('failed')
    expect(after!.updatedAt.getTime()).toBe(before)
  })

  it('a run that outlived its lease stops, and leaves the newer run alone', async () => {
    const post = await makePost()
    const id = String(post._id)
    const claim = await run.claimIllustration(id, 3)
    const newer = new Date(Date.now() + 5_000)
    draw.mockImplementationOnce(async ({ name }: { name: string }) => {
      // Meanwhile another run took the lease over.
      await PostModel.updateOne(
        { _id: post._id },
        {
          $set: {
            'illustration.state': 'running',
            'illustration.startedAt': newer,
            'illustration.leaseUntil': new Date(Date.now() + 300_000),
          },
        }
      )
      return { url: URL(name), model: 'm' }
    })
    const outcome = await run.runIllustration(
      id,
      options(claim.claimed ? { fence: claim.startedAt } : {})
    )
    expect(outcome.lastError).toMatch(/another run took the post over/)
    expect(draw).toHaveBeenCalledTimes(1)
    const after = await stored(post._id)
    expect(after?.illustration?.state).toBe('running')
    expect(after?.illustration?.startedAt?.getTime()).toBe(newer.getTime())
  })

  it('an unexpected throw is still a released lease with lastError', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const post = await makePost()
    await run.claimIllustration(String(post._id), 3)
    vi.spyOn(PostModel, 'findById').mockImplementationOnce(() => {
      throw new Error('connection reset')
    })
    await run.runIllustration(String(post._id), options())
    const after = await stored(post._id)
    expect(after?.illustration?.state).toBe('failed')
    expect(after?.illustration?.leaseUntil).toBeNull()
    expect(after?.illustration?.lastError).toContain('connection reset')
  })

  it('stops cleanly when the token image budget runs out (R5)', async () => {
    draw.mockImplementation(async ({ name }: { name: string }) => ({
      url: URL(name),
      model: 'm',
    }))
    const post = await makePost()
    let allowance = 1
    await run.claimIllustration(String(post._id), 3)
    const outcome = await run.runIllustration(
      String(post._id),
      options({
        spendImage: async () => ({
          ok: allowance-- > 0,
          retryAfterSeconds: 120,
        }),
      })
    )
    expect(outcome.imagesMade).toBe(1)
    expect(draw).toHaveBeenCalledTimes(1)
    const after = await stored(post._id)
    expect(after?.illustration?.state).toBe('failed')
    expect(after?.illustration?.lastError).toMatch(/^rate limit/)
    expect(after?.illustration?.remaining).toBe(2)
  })

  it('stops starting images at the deadline and says what is left', async () => {
    draw.mockImplementation(async ({ name }: { name: string }) => ({
      url: URL(name),
      model: 'm',
    }))
    const post = await makePost()
    await run.claimIllustration(String(post._id), 3)
    const outcome = await run.runIllustration(
      String(post._id),
      options({ deadlineAt: Date.now() + 10_000 })
    )
    expect(outcome.imagesMade).toBe(0)
    expect((await stored(post._id))?.illustration?.lastError).toMatch(
      /Ran out of time/
    )
  })
})

describe('the cron path', () => {
  it('illustratePost still publishes a post that came out whole, and updates the caller document', async () => {
    draw.mockImplementation(async ({ name }: { name: string }) => ({
      url: URL(name),
      model: 'm',
    }))
    const post = await makePost({ status: 'archived' })
    const doc = (await PostModel.findById(post._id).select('+bodyMarkdown'))!
    const outcome = await run.illustratePost(doc, {
      model: 'gemini-3.1-flash-lite-image',
      deadlineAt: Date.now() + 240_000,
    })
    expect(outcome.published).toBe(true)
    expect(doc.status).toBe('published')
    expect(doc.publishedAt).toBeInstanceOf(Date)
    expect((await stored(post._id))?.status).toBe('published')
    expect(revalidate).toHaveBeenCalledWith('illustrated')
  })

  it('agents cannot edit a post while a publishing run holds it, and can again once it lets go', async () => {
    const service = await import('@/lib/blog/post-service')
    const images = await import('@/lib/blog/image-service')
    const post = await makePost({ status: 'archived' })
    const id = String(post._id)
    const edit = () =>
      service.updatePostAsAgent(
        id,
        { edits: [{ find: 'Middle.', replace: 'Planted.' }] },
        { canEditLive: false }
      )

    await run.claimIllustration(id, 3, new Date(), { publishing: true })
    const refused = await edit()
    expect(refused).toMatchObject({ ok: false, status: 409 })
    expect(!refused.ok && refused.error).toMatch(/daily job/)
    expect(
      (
        await images.patchImageIntoPost(id, 'image1', URL('planted'), {
          refusePublishingRun: true,
        })
      ).outcome
    ).toBe('publishing')
    expect((await stored(post._id))?.bodyMarkdown).toContain('Middle.')
    expect((await stored(post._id))?.bodyMarkdown).toContain('(image1)')

    // A lease that ran out no longer locks anyone out.
    await PostModel.updateOne(
      { _id: post._id },
      { $set: { 'illustration.leaseUntil': new Date(Date.now() - 1_000) } }
    )
    expect((await edit()).ok).toBe(true)
  })

  it('the cron publishes only what it drew: an agent edit during its run is refused', async () => {
    const service = await import('@/lib/blog/post-service')
    const post = await makePost({ status: 'archived' })
    const doc = (await PostModel.findById(post._id).select('+bodyMarkdown'))!
    let midRun: Awaited<ReturnType<typeof service.updatePostAsAgent>> | null =
      null
    draw.mockImplementation(async ({ name }: { name: string }) => {
      midRun ??= await service.updatePostAsAgent(
        String(post._id),
        { edits: [{ find: 'Middle.', replace: 'Planted.' }] },
        { canEditLive: false }
      )
      return { url: URL(name), model: 'm' }
    })
    const outcome = await run.illustratePost(doc, {
      model: 'gemini-3.1-flash-lite-image',
      deadlineAt: Date.now() + 240_000,
    })
    expect(midRun).toMatchObject({ ok: false, status: 409 })
    expect(outcome.published).toBe(true)
    const body = (await stored(post._id))?.bodyMarkdown
    expect(body).toContain('Middle.')
    expect(body).not.toContain('Planted.')
  })

  it('an illustrate_post run (publish: false) never locks the agent out (R3)', async () => {
    const service = await import('@/lib/blog/post-service')
    const post = await makePost()
    const id = String(post._id)
    await run.claimIllustration(id, 3)
    expect(
      (
        await service.updatePostAsAgent(
          id,
          { edits: [{ find: 'Middle.', replace: 'Changed.' }] },
          { canEditLive: false }
        )
      ).ok
    ).toBe(true)
  })

  it('illustratePost refuses to start over a live run', async () => {
    const post = await makePost({ status: 'archived' })
    await run.claimIllustration(String(post._id), 3)
    const doc = (await PostModel.findById(post._id).select('+bodyMarkdown'))!
    const outcome = await run.illustratePost(doc, {
      model: 'gemini-3.1-flash-lite-image',
      deadlineAt: Date.now() + 240_000,
    })
    expect(outcome.published).toBe(false)
    expect(outcome.warnings).toEqual([
      'An image run is already in progress for this post.',
    ])
    expect(draw).not.toHaveBeenCalled()
  })
})
