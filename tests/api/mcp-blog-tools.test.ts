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

import { AgentActionModel } from '@/models/AgentAction'
import { AgentTokenModel } from '@/models/AgentToken'
import { KindModel } from '@/models/Kind'
import { PostEventModel } from '@/models/PostEvent'
import { PostModel } from '@/models/Post'
import { RateLimitModel } from '@/models/RateLimit'
import { SeriesModel } from '@/models/Series'
import { WhiteboardBoardModel } from '@/models/WhiteboardBoard'
import { WhiteboardItemModel } from '@/models/WhiteboardItem'

import { mcpClient, type RouteHandler } from './mcp-helpers'

/**
 * The blog tools through `/api/mcp`, as an agent calls them (phase 2, mcp-plan.md T6).
 *
 * ```
 *   scopes      read token lists only reads · write token cannot touch a live post · no status input
 *   scene 1     create_draft ──▶ illustrate_post ──▶ (after()) ──▶ get_post idle ──▶ publish_post
 *   retries     two create_draft with one clientRef ──▶ one post (R4)
 *   images      generate_image return / attach; the token's image bucket, not the editor's (R5)
 *   reads       list_posts (180-day views, dates, sort), get_post pages, lint_draft, get_me caps
 *   prompts     write-post rendered for the token's tool list (C6)
 * ```
 *
 * Image generation and the LLM are stubs; the pipeline, Mongo and runTool are real.
 */

vi.hoisted(() => {
  process.env.PROFILE_DOCUMENT_ID = 'mcp-blog-profile'
})

const deferred: (() => unknown)[] = []
vi.mock('next/server', async importOriginal => {
  const actual = await importOriginal<typeof import('next/server')>()
  return { ...actual, after: (fn: () => unknown) => deferred.push(fn) }
})
const flushAfter = async () => {
  while (deferred.length) await deferred.shift()!()
}

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
vi.mock('@/lib/blog/llm', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/blog/llm')>('@/lib/blog/llm')
  return {
    ...actual,
    chatCompletion: vi.fn(async () => ({
      text: '{"prompt": "A written prompt"}',
      model: 'stub',
    })),
  }
})

const MCP_URL = 'http://localhost/api/mcp'
const URL = (name: string) =>
  `https://res.cloudinary.com/test-cloud/image/upload/v1/${name}.png`

let memory: MongoMemoryServer
let client: ReturnType<typeof mcpClient>
let tokenLib: typeof import('@/lib/mcp/token')
let revalidate: ReturnType<typeof vi.fn>

beforeAll(async () => {
  memory = await MongoMemoryServer.create()
  process.env.MONGODB_URI = memory.getUri()
  process.env.AUTH_SECRET = 'mcp-blog-secret'
  process.env.CLOUDINARY_CLOUD_NAME = 'test-cloud'
  delete process.env.REQUIRE_ADMIN
  await mongoose.connect(memory.getUri())
  await Promise.all([
    PostModel.syncIndexes(),
    AgentTokenModel.syncIndexes(),
    AgentActionModel.syncIndexes(),
  ])
  const route = await import('@/app/api/mcp/route')
  client = mcpClient(route.POST as RouteHandler, MCP_URL)
  tokenLib = await import('@/lib/mcp/token')
  revalidate = (await import('@/lib/blog/revalidate'))
    .revalidatePublishedPost as unknown as ReturnType<typeof vi.fn>
}, 120_000)

afterAll(async () => {
  await mongoose.disconnect()
  await memory.stop()
})

afterEach(async () => {
  deferred.length = 0
  vi.clearAllMocks()
  draw.mockReset()
  await Promise.all([
    PostModel.deleteMany({}),
    PostEventModel.deleteMany({}),
    KindModel.deleteMany({}),
    SeriesModel.deleteMany({}),
    AgentTokenModel.deleteMany({}),
    AgentActionModel.deleteMany({}),
    RateLimitModel.deleteMany({}),
    WhiteboardItemModel.deleteMany({}),
    WhiteboardBoardModel.deleteMany({}),
  ])
})

type Scope = 'read' | 'write' | 'publish' | 'pii'
const token = async (scopes: Scope[]) =>
  (await tokenLib.createAgentToken('agent', scopes)).token
const parse = <T = Record<string, unknown>>(text: string) =>
  JSON.parse(text) as T

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
    bodyMarkdown: 'Intro.',
    ...overrides,
  })
}

const DRAFT = {
  title: 'What shipping the whiteboard taught me',
  bodyMarkdown:
    '## The claim\n\nShipping beat polishing.\n\n![The board](image1)\n\nThat was it.',
  excerpt: 'Shipping beat polishing.',
  kind: 'article',
  series: 'build-logs',
  language: 'en' as const,
  coverImagePrompt: 'A whiteboard covered in sticky notes',
  imagePrompts: [{ key: 'image1', prompt: 'A marker drawing a box' }],
}

describe('scopes and the tool list', () => {
  it('a read token lists no write or publish tool, and a write token no publish tool', async () => {
    const reader = await client.toolNames(await token(['read']))
    for (const name of [
      'create_draft',
      'update_post',
      'generate_image',
      'illustrate_post',
      'publish_post',
    ])
      expect(reader).not.toContain(name)
    expect(reader).toEqual(
      expect.arrayContaining([
        'get_post',
        'list_posts',
        'lint_draft',
        'get_writing_brief',
        'get_me',
        'list_taxonomy',
      ])
    )

    const writer = await client.toolNames(await token(['read', 'write']))
    expect(writer).toEqual(
      expect.arrayContaining([
        'create_draft',
        'update_post',
        'generate_image',
        'illustrate_post',
      ])
    )
    expect(writer).not.toContain('publish_post')
  })

  it('update_post has no status input at all, and a status sent anyway is refused', async () => {
    const t = await token(['read', 'write'])
    const list = await client.rpc(t, 'tools/list')
    const update = (
      list.body.result?.tools as {
        name: string
        inputSchema: { properties: Record<string, unknown> }
      }[]
    ).find(tool => tool.name === 'update_post')!
    expect(update.inputSchema.properties).not.toHaveProperty('status')

    const post = await makePost()
    const call = await client.callTool(t, 'update_post', {
      id: String(post._id),
      status: 'published',
    })
    expect(call.isError).toBe(true)
    expect(call.text).toMatch(/status/)
    expect((await PostModel.findById(post._id))?.status).toBe('draft')
  })

  it('a write token without publish cannot change a published post', async () => {
    const t = await token(['read', 'write'])
    const live = await makePost({
      status: 'published',
      publishedAt: new Date(),
      coverImage: URL('c'),
      bodyMarkdown: 'Intro. ![x](image1)',
      imagePrompts: [{ key: 'image1', prompt: 'p' }],
    })
    const id = String(live._id)
    for (const [name, args] of [
      ['update_post', { id, title: 'Changed' }],
      [
        'generate_image',
        { postId: id, target: 'image1', mode: 'attach', prompt: 'p' },
      ],
      ['illustrate_post', { id }],
    ] as const) {
      const call = await client.callTool(t, name, args)
      expect(call.isError, name).toBe(true)
      expect(call.text, name).toMatch(/publish scope/)
    }
    expect(draw).not.toHaveBeenCalled()
    const after = await PostModel.findById(live._id).select('+bodyMarkdown')
    expect(after?.title).toBe('A post')
    expect(after?.bodyMarkdown).toBe('Intro. ![x](image1)')
    await flushAfter()
    const rows = await AgentActionModel.find(
      {},
      { tool: 1, outcome: 1, reason: 1, _id: 0 }
    ).lean()
    expect(
      rows.map(row => `${row.tool}:${row.outcome}:${row.reason}`).sort()
    ).toEqual([
      'generate_image:refused:live-post',
      'illustrate_post:refused:live-post',
      'update_post:refused:live-post',
    ])
  })
})

describe('scene 1: idea to published post', () => {
  it('create_draft, illustrate_post, poll get_post, publish_post', async () => {
    await seedTaxonomy()
    draw.mockImplementation(async ({ name }: { name: string }) => ({
      url: URL(name),
      model: 'm',
    }))
    const t = await token(['read', 'write', 'publish'])

    const created = await client.callTool(t, 'create_draft', {
      ...DRAFT,
      clientRef: 'scene-1',
    })
    expect(created.isError).toBe(false)
    const draft = parse<{
      id: string
      slug: string
      status: string
      placeholders: { key: string; hasPrompt: boolean }[]
    }>(created.text)
    expect(draft).toMatchObject({
      slug: 'what-shipping-the-whiteboard-taught-me',
      status: 'draft',
    })
    expect(draft.placeholders).toEqual([
      { key: 'image1', alt: 'The board', hasPrompt: true },
    ])

    const started = await client.callTool(t, 'illustrate_post', {
      id: draft.id,
    })
    expect(parse(started.text)).toMatchObject({
      started: true,
      placeholders: 2,
    })

    // The run has not happened yet: the response came first (R2).
    const running = parse<{ illustration: { state: string } }>(
      (await client.callTool(t, 'get_post', { id: draft.id })).text
    )
    expect(running.illustration.state).toBe('running')
    const again = await client.callTool(t, 'illustrate_post', { id: draft.id })
    expect(again.isError).toBe(true)
    expect(again.text).toMatch(/already in progress/)

    await flushAfter()
    const done = parse<{
      status: string
      illustration: { state: string; remaining: number }
      placeholders: unknown[]
      coverImage: string
    }>((await client.callTool(t, 'get_post', { id: draft.id })).text)
    expect(done).toMatchObject({
      status: 'draft',
      illustration: { state: 'idle', remaining: 0 },
      placeholders: [],
    })
    expect(done.coverImage).toBe(
      URL('what-shipping-the-whiteboard-taught-me-cover')
    )
    expect(revalidate).not.toHaveBeenCalled()

    const published = await client.callTool(t, 'publish_post', { id: draft.id })
    expect(parse(published.text)).toMatchObject({
      slug: draft.slug,
      alreadyPublished: false,
    })
    expect((await PostModel.findById(draft.id))?.status).toBe('published')
    expect(revalidate).toHaveBeenCalledWith(draft.slug)

    await flushAfter()
    const rows = await AgentActionModel.find(
      { outcome: { $ne: 'pending' } },
      { tool: 1, outcome: 1, _id: 0 }
    )
      .sort({ at: 1 })
      .lean()
    expect(rows.map(row => `${row.tool}:${row.outcome}`)).toEqual([
      'create_draft:ok',
      'illustrate_post:ok',
      'illustrate_post:refused',
      'publish_post:ok',
    ])
  })

  it('publish_post refuses a post with an unfilled placeholder', async () => {
    await seedTaxonomy()
    const t = await token(['read', 'write', 'publish'])
    const created = parse<{ id: string }>(
      (await client.callTool(t, 'create_draft', DRAFT)).text
    )
    const refused = await client.callTool(t, 'publish_post', { id: created.id })
    expect(refused.isError).toBe(true)
    expect(refused.text).toMatch(/no cover image/)
    expect((await PostModel.findById(created.id))?.status).toBe('draft')
  })

  it('illustrate_post on a draft never leaves it published, even with every image drawn', async () => {
    draw.mockImplementation(async ({ name }: { name: string }) => ({
      url: URL(name),
      model: 'm',
    }))
    const t = await token(['read', 'write'])
    const post = await makePost({
      coverImagePrompt: 'c',
      bodyMarkdown: 'Intro. ![x](image1)',
      imagePrompts: [{ key: 'image1', prompt: 'p' }],
    })
    await client.callTool(t, 'illustrate_post', { id: String(post._id) })
    await flushAfter()
    const after = await PostModel.findById(post._id)
    expect(after?.status).toBe('draft')
    expect(after?.coverImage).toBe(URL('a-post-cover'))
  })

  it('a placeholder without a prompt is nothing to draw, with a teaching message', async () => {
    const t = await token(['read', 'write'])
    const post = await makePost({
      coverImage: URL('c'),
      bodyMarkdown: 'Intro. ![x](image1)',
    })
    const call = await client.callTool(t, 'illustrate_post', {
      id: String(post._id),
    })
    expect(call.isError).toBe(true)
    expect(call.text).toMatch(/imagePrompts/)
  })
})

describe('retries (R4)', () => {
  it('two create_draft calls with the same clientRef create one post and replay the result', async () => {
    await seedTaxonomy()
    const t = await token(['read', 'write'])
    const first = await client.callTool(t, 'create_draft', {
      ...DRAFT,
      clientRef: 'once',
    })
    const second = await client.callTool(t, 'create_draft', {
      ...DRAFT,
      clientRef: 'once',
    })
    expect(second).toEqual(first)
    expect(await PostModel.countDocuments()).toBe(1)
  })
})

describe('generate_image', () => {
  it("return mode gives a URL and leaves the post alone; it uses the post's stored prompt", async () => {
    draw.mockImplementation(
      async ({ name, prompt }: { name: string; prompt: string }) => ({
        url: URL(`${name}-${prompt.length}`),
        model: 'm',
      })
    )
    const t = await token(['read', 'write'])
    const post = await makePost({
      bodyMarkdown: 'Intro. ![x](image1)',
      imagePrompts: [{ key: 'image1', prompt: 'stored' }],
    })
    const call = await client.callTool(t, 'generate_image', {
      postId: String(post._id),
      target: 'image1',
    })
    expect(parse(call.text)).toMatchObject({
      attached: false,
      prompt: 'stored',
      url: URL('a-post-image1-6'),
    })
    expect(
      (await PostModel.findById(post._id).select('+bodyMarkdown'))?.bodyMarkdown
    ).toBe('Intro. ![x](image1)')
  })

  it('attach mode fills the placeholder in the current body; with no prompt anywhere it writes one', async () => {
    draw.mockImplementation(async ({ name }: { name: string }) => ({
      url: URL(name),
      model: 'm',
    }))
    const t = await token(['read', 'write'])
    const post = await makePost({ bodyMarkdown: 'Intro.\n\n![x](image1)' })
    const call = await client.callTool(t, 'generate_image', {
      postId: String(post._id),
      target: 'image1',
      mode: 'attach',
    })
    expect(parse(call.text)).toMatchObject({ attached: true, target: 'image1' })
    const after = await PostModel.findById(post._id).select('+bodyMarkdown')
    expect(after?.bodyMarkdown).toBe(`Intro.\n\n![x](${URL('a-post-image1')})`)
    expect(
      after?.imagePrompts.map(({ key, prompt }) => ({ key, prompt }))
    ).toEqual([{ key: 'image1', prompt: 'A written prompt' }])
  })

  it("a token over its image budget is refused while the editor's IP bucket still works (R5)", async () => {
    draw.mockImplementation(async ({ name }: { name: string }) => ({
      url: URL(name),
      model: 'm',
    }))
    const t = await token(['read', 'write'])
    const post = await makePost()
    for (let i = 0; i < 30; i++)
      expect(
        (
          await client.callTool(t, 'generate_image', {
            postId: String(post._id),
            prompt: `p${i}`,
          })
        ).isError
      ).toBe(false)
    const over = await client.callTool(t, 'generate_image', {
      postId: String(post._id),
      prompt: 'p31',
    })
    expect(over.isError).toBe(true)
    expect(over.text).toMatch(/Rate limit/)
    const { checkRateLimit, BLOG_GENERATE_IMAGE_LIMIT } =
      await import('@/lib/rate-limit')
    expect(
      (await checkRateLimit('198.51.100.7', BLOG_GENERATE_IMAGE_LIMIT)).ok
    ).toBe(true)
  })

  it('an illustrate run stops cleanly at the token limit', async () => {
    draw.mockImplementation(async ({ name }: { name: string }) => ({
      url: URL(name),
      model: 'm',
    }))
    const t = await token(['read', 'write'])
    const tokenDoc = await AgentTokenModel.findOne({}).lean()
    const { checkRateLimit, BLOG_GENERATE_IMAGE_LIMIT } =
      await import('@/lib/rate-limit')
    for (let i = 0; i < 29; i++)
      await checkRateLimit(
        `mcp-token:${tokenDoc!._id}`,
        BLOG_GENERATE_IMAGE_LIMIT
      )
    const post = await makePost({
      coverImagePrompt: 'c',
      bodyMarkdown: 'Intro. ![x](image1)',
      imagePrompts: [{ key: 'image1', prompt: 'p' }],
    })
    await client.callTool(t, 'illustrate_post', { id: String(post._id) })
    await flushAfter()
    const page = parse<{
      illustration: { state: string; remaining: number; lastError: string }
    }>((await client.callTool(t, 'get_post', { id: String(post._id) })).text)
    expect(page.illustration.state).toBe('failed')
    expect(page.illustration.remaining).toBe(1)
    expect(page.illustration.lastError).toMatch(/^rate limit/)
  })
})

describe('reads', () => {
  it('list_posts: published over a year ago, sorted by 180-day views', async () => {
    const old = new Date(Date.now() - 400 * 86_400_000)
    await makePost({ slug: 'old-read', status: 'published', publishedAt: old })
    await makePost({ slug: 'old-quiet', status: 'published', publishedAt: old })
    await makePost({
      slug: 'recent',
      status: 'published',
      publishedAt: new Date(),
    })
    await makePost({ slug: 'gone', status: 'deleted', publishedAt: old })
    await PostEventModel.insertMany(
      [1, 2, 3].map(i => ({
        _id: `old-read:view:s${i}`,
        slug: 'old-read',
        kind: 'view',
        count: 1,
        createdAt: new Date(),
        expireAt: new Date(Date.now() + 86_400_000),
      }))
    )
    const t = await token(['read'])
    const cutoff = new Date(Date.now() - 365 * 86_400_000)
      .toISOString()
      .slice(0, 10)
    const listed = parse<{
      total: number
      metricsWindow: string
      posts: { slug: string; views: number }[]
    }>(
      (
        await client.callTool(t, 'list_posts', {
          status: ['published'],
          publishedTo: cutoff,
          sort: 'views',
          order: 'asc',
        })
      ).text
    )
    expect(listed.metricsWindow).toContain('180 days')
    expect(listed.posts.map(post => [post.slug, post.views])).toEqual([
      ['old-quiet', 0],
      ['old-read', 3],
    ])
  })

  it('list_posts pages by cursor', async () => {
    for (let i = 0; i < 5; i++) await makePost({ slug: `p-${i}` })
    const t = await token(['read'])
    const first = parse<{ nextCursor: string; posts: unknown[] }>(
      (await client.callTool(t, 'list_posts', { limit: 3 })).text
    )
    expect(first.posts).toHaveLength(3)
    const second = parse<{ nextCursor: string | null; posts: unknown[] }>(
      (
        await client.callTool(t, 'list_posts', {
          limit: 3,
          cursor: first.nextCursor,
        })
      ).text
    )
    expect(second.posts).toHaveLength(2)
    expect(second.nextCursor).toBeNull()
  })

  it('get_post pages a maximum-size body without the budget net firing (C10)', async () => {
    const warn = vi.spyOn(console, 'warn')
    const body =
      `${'# '.slice(0, 0)}${'A line of the post that goes on.\n'.repeat(6_000)}`.slice(
        0,
        200_000
      )
    const post = await makePost({ bodyMarkdown: body })
    const t = await token(['read'])
    const pages: string[] = []
    let offset: number | null = 0
    while (offset !== null) {
      const reply: { text: string } = await client.callTool(t, 'get_post', {
        id: String(post._id),
        offset,
      })
      const text: string = reply.text
      expect(text).not.toContain('[truncated:')
      const page: {
        body: { markdown: string; nextOffset: number | null; complete: boolean }
      } = parse(text)
      pages.push(page.body.markdown)
      offset = page.body.nextOffset
    }
    expect(pages.join('')).toBe(body)
    expect(pages.length).toBeGreaterThan(1)
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('budget net'))
  })

  it('lint_draft reports em dashes, raw HTML, off-site images and a stray h1', async () => {
    const t = await token(['read'])
    const report = parse<{
      clean: boolean
      prose: { code: string }[]
      rawHtml: string[]
      refusedImages: string[]
      h1: boolean
      placeholders: { key: string; hasPrompt: boolean }[]
    }>(
      (
        await client.callTool(t, 'lint_draft', {
          language: 'en',
          bodyMarkdown:
            '# Title\n\nA claim — with a dash.\n\n<div>raw</div>\n\n![x](https://evil.example/a.png)\n\n![y](image1)',
        })
      ).text
    )
    expect(report.clean).toBe(false)
    expect(report.prose.map(finding => finding.code)).toContain('em-dash')
    expect(report.rawHtml).toEqual(['<div>raw</div>'])
    expect(report.refusedImages).toEqual(['https://evil.example/a.png'])
    expect(report.h1).toBe(true)
    expect(report.placeholders).toEqual([
      { key: 'image1', alt: 'y', hasPrompt: false },
    ])
  })

  it('get_me: titles only, at most 5 posts, visible goals only', async () => {
    const board = await WhiteboardBoardModel.create({ title: 'Life' })
    const { createItem } = await import('@/lib/whiteboard/data')
    const { validateItem } = await import('@/lib/whiteboard/limits')
    for (const fields of [
      {
        title: 'Career 2027',
        meaning: 'goal',
        status: 'active',
        body: 'SECRET PLAN',
      },
      {
        title: 'Hidden dream',
        meaning: 'dream',
        status: 'active',
        includeInAi: false,
      },
    ]) {
      const checked = validateItem({
        _id: new mongoose.Types.ObjectId().toHexString(),
        form: 'text',
        ...fields,
      })
      if (!checked.ok) throw new Error(checked.error)
      await createItem(String(board._id), checked.value)
    }
    for (let i = 0; i < 7; i++)
      await makePost({
        slug: `post-${i}`,
        title: `Post ${i}`,
        status: 'published',
        publishedAt: new Date(Date.now() - i * 86_400_000),
        bodyMarkdown: 'BODY TEXT',
      })

    const t = await token(['read'])
    const text = (await client.callTool(t, 'get_me')).text
    const me = parse<{
      recentPosts: { title: string }[]
      activeGoalsAndDreams: { title: string }[]
    }>(text)
    expect(me.recentPosts.map(post => post.title)).toEqual([
      'Post 0',
      'Post 1',
      'Post 2',
      'Post 3',
      'Post 4',
    ])
    expect(me.activeGoalsAndDreams.map(item => item.title)).toEqual([
      'Career 2027',
    ])
    for (const secret of ['SECRET PLAN', 'Hidden dream', 'BODY TEXT'])
      expect(text).not.toContain(secret)
  })
})

describe('the write-post prompt and the brief (C6)', () => {
  it('names publish_post only for a token that has it', async () => {
    const get = async (t: string) =>
      (
        await client.rpc(t, 'prompts/get', {
          name: 'write-post',
          arguments: { topic: 'shipping', language: 'en' },
        })
      ).body.result?.messages?.[0].content.text ?? ''
    const withPublish = await get(await token(['read', 'write', 'publish']))
    const readOnly = await get(await token(['read']))
    expect(withPublish).toContain('Write a blog post about: shipping')
    expect(withPublish).toContain('publish_post')
    expect(withPublish).toContain('illustrate_post')
    expect(readOnly).toContain('This token cannot save drafts')
    expect(readOnly).toContain('Publishing is not in your tool list')
    expect(readOnly).not.toMatch(/Publish only when the owner asked/)
  })

  it('get_writing_brief returns the same brief as a tool', async () => {
    const t = await token(['read', 'write'])
    const brief = (
      await client.callTool(t, 'get_writing_brief', { language: 'vi' })
    ).text
    expect(brief).toContain('## The evidence law')
    expect(brief).toContain('![alt text](image1)')
    expect(brief).toContain('create_draft')
  })
})

describe('races, costs and caps (the /review follow-ups)', () => {
  const imagePost = () =>
    makePost({
      coverImage: URL('c'),
      bodyMarkdown: 'Intro. ![x](image1) End.',
      imagePrompts: [{ key: 'image1', prompt: 'p' }],
    })

  it('generate_image attach: a post published during the draw is not changed by a write-only token', async () => {
    const t = await token(['read', 'write'])
    const post = await imagePost()
    draw.mockImplementation(async ({ name }: { name: string }) => {
      // The owner publishes while the image is being drawn.
      await PostModel.updateOne(
        { _id: post._id },
        { $set: { status: 'published', publishedAt: new Date() } }
      )
      return { url: URL(name), model: 'm' }
    })
    const call = await client.callTool(t, 'generate_image', {
      postId: String(post._id),
      target: 'image1',
      mode: 'attach',
      prompt: 'a box',
    })
    expect(call.isError).toBe(true)
    expect(call.text).toMatch(/published while the image was being drawn/)
    const stored = await PostModel.findById(post._id).select('+bodyMarkdown')
    expect(stored?.bodyMarkdown).toContain('(image1)')
  })

  it('generate_image attach to a placeholder that is not in the body spends no image', async () => {
    const t = await token(['read', 'write'])
    const post = await imagePost()
    const call = await client.callTool(t, 'generate_image', {
      postId: String(post._id),
      target: 'image9',
      mode: 'attach',
      prompt: 'a box',
    })
    expect(call.isError).toBe(true)
    expect(call.text).toMatch(/not a placeholder/)
    expect(draw).not.toHaveBeenCalled()
    const buckets = (await RateLimitModel.find({}).lean()).map(row =>
      String(row._id)
    )
    expect(buckets.some(key => key.startsWith('blog-generate-image:'))).toBe(
      false
    )
  })

  it('illustrate_post: a draft published mid-run is left alone by a write-only token', async () => {
    const t = await token(['read', 'write'])
    const post = await makePost({
      coverImagePrompt: 'c',
      bodyMarkdown: 'Intro. ![x](image1) End.',
      imagePrompts: [{ key: 'image1', prompt: 'p' }],
    })
    draw.mockImplementation(async ({ name }: { name: string }) => {
      await PostModel.updateOne(
        { _id: post._id },
        { $set: { status: 'published', publishedAt: new Date() } }
      )
      return { url: URL(name), model: 'm' }
    })
    await client.callTool(t, 'illustrate_post', { id: String(post._id) })
    await flushAfter()
    const stored = await PostModel.findById(post._id).select('+bodyMarkdown')
    expect(stored?.coverImage).toBeNull()
    expect(stored?.bodyMarkdown).toContain('(image1)')
    expect(stored?.illustration?.state).toBe('failed')
    expect(stored?.illustration?.lastError).toMatch(
      /published while this run was drawing/
    )
  })

  it('illustrate_post: revoking the token stops the run at its next image', async () => {
    const t = await token(['read', 'write'])
    const post = await makePost({
      coverImagePrompt: 'c',
      bodyMarkdown: 'Intro. ![x](image1) End.',
      imagePrompts: [{ key: 'image1', prompt: 'p' }],
    })
    draw.mockImplementation(async ({ name }: { name: string }) => ({
      url: URL(name),
      model: 'm',
    }))
    await client.callTool(t, 'illustrate_post', { id: String(post._id) })
    await AgentTokenModel.updateMany({}, { $set: { revokedAt: new Date() } })
    await flushAfter()
    expect(draw).not.toHaveBeenCalled()
    const stored = await PostModel.findById(post._id)
    expect(stored?.illustration?.lastError).toMatch(/revoked/)
  })

  it('update_post: edits that would grow the body past the cap are refused before the render', async () => {
    const t = await token(['read', 'write'])
    const post = await makePost({ bodyMarkdown: `A${'y'.repeat(160_000)}` })
    const { renderMarkdown } = await import('@/lib/blog/markdown')
    vi.mocked(renderMarkdown).mockClear()
    const call = await client.callTool(t, 'update_post', {
      id: String(post._id),
      edits: [{ find: 'Ay', replace: 'z'.repeat(50_000) }],
    })
    expect(call.isError).toBe(true)
    expect(call.text).toMatch(/over the 200000-character limit/)
    expect(renderMarkdown).not.toHaveBeenCalled()
  })
})
