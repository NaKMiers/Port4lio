import { expect, test, type APIRequestContext } from '@playwright/test'

import { STORAGE_STATE } from './global-setup'

/**
 * Scene 1 end to end through `/api/mcp`, against a production build (mcp-plan.md T6, C8, R9).
 *
 * ```
 *   owner: create a p4_ token (read, write, publish)
 *   agent: create_draft ──▶ /blog/<slug> is 404
 *          illustrate_post ──▶ returns at once ──▶ poll get_post until idle        (R2)
 *          publish_post    ──▶ /blog/<slug> readable NOW, images in it
 *          update_post / generate_image attach / illustrate_post on the LIVE post
 *                          ──▶ each one refreshes /blog/<slug> on the next load    (C8)
 *   owner: a stale editor tab saves after an agent edit ──▶ Reload / Overwrite banner (R9)
 * ```
 *
 * Why this cannot be vitest: revalidation only means something under `next build && next
 * start` (see blog-publish.spec.ts), and `illustrate_post` draws inside `after()`, which only
 * a real request scope runs. The images are real too - Gemini and Cloudinary, the cheapest
 * model, four images per run. Without GOOGLE_API_KEY in `.env` the run cannot draw, so (2)
 * instead asserts that the failure lands in `illustration.lastError` and the owner fills the
 * images by hand, and the two image-only freshness checks (5) and (6) are skipped, saying why.
 *
 * Runs only against a disposable database (global-setup refuses anything else).
 */
test.use({ storageState: STORAGE_STATE })
test.describe.configure({ mode: 'serial' })

const RUN = Date.now()
const TITLE = `Scene one ${RUN}`
const MCP_HEADERS = { accept: 'application/json, text/event-stream' }

let token = ''
let postId = ''
let slug = ''
let agent: APIRequestContext

/** Real images need the key; without it the image-only steps are skipped, not faked. */
const HAS_IMAGE_KEY = Boolean(process.env.GOOGLE_API_KEY?.trim())
const CLOUD = process.env.CLOUDINARY_CLOUD_NAME ?? 'cloud'
const handUploaded = (name: string) =>
  `https://res.cloudinary.com/${CLOUD}/image/upload/v1/e2e-${RUN}-${name}.png`

let rpcId = 0
async function tool(name: string, args: Record<string, unknown>) {
  const res = await agent.post('/api/mcp', {
    headers: { ...MCP_HEADERS, authorization: `Bearer ${token}` },
    data: {
      jsonrpc: '2.0',
      id: ++rpcId,
      method: 'tools/call',
      params: { name, arguments: args },
    },
  })
  expect(res.status(), name).toBe(200)
  const body = await res.json()
  const text: string = body.result?.content?.[0]?.text ?? body.error?.message
  return { text, isError: Boolean(body.result?.isError ?? body.error) }
}

async function pollUntilIdle(id: string, timeoutMs = 280_000) {
  const started = Date.now()
  for (;;) {
    const page = JSON.parse((await tool('get_post', { id })).text)
    if (page.illustration.state !== 'running') return page
    if (Date.now() - started > timeoutMs)
      throw new Error('illustration did not finish in time')
    await new Promise(resolve => setTimeout(resolve, 5_000))
  }
}

test.afterAll(async () => {
  await agent?.dispose()
})

test('(1) an agent creates a draft, which stays private', async ({
  request,
  playwright,
  baseURL,
}) => {
  const created = await request.post('/api/admin/agents/tokens', {
    data: { name: `e2e scene 1 ${RUN}`, scopes: ['read', 'write', 'publish'] },
  })
  expect(created.ok()).toBe(true)
  token = (await created.json()).token
  agent = await playwright.request.newContext({ baseURL })

  const draft = await tool('create_draft', {
    title: TITLE,
    bodyMarkdown:
      '## The claim\n\nShipping beat polishing.\n\n![A whiteboard](image1)\n\nThat was it.',
    excerpt: 'Shipping beat polishing.',
    language: 'en',
    coverImagePrompt:
      'A flat illustration of a whiteboard covered in sticky notes, soft colours',
    imagePrompts: [
      {
        key: 'image1',
        prompt: 'A flat illustration of a marker drawing a box on a whiteboard',
      },
    ],
    clientRef: `scene-1-${RUN}`,
  })
  expect(draft.isError, draft.text).toBe(false)
  ;({ id: postId, slug } = JSON.parse(draft.text))
  expect(slug).toBe(`scene-one-${RUN}`)

  expect((await request.get(`/blog/${slug}`)).status()).toBe(404)
})

test('(2) illustrate_post answers at once, and polling get_post reaches idle with every image in place', async ({
  request,
}) => {
  test.setTimeout(320_000)
  const started = Date.now()
  const start = await tool('illustrate_post', { id: postId })
  expect(start.isError, start.text).toBe(false)
  expect(JSON.parse(start.text)).toMatchObject({
    started: true,
    placeholders: 2,
  })
  // It came back before any image could have been drawn (R2).
  expect(Date.now() - started).toBeLessThan(15_000)

  const page = await pollUntilIdle(postId)

  if (!HAS_IMAGE_KEY) {
    // No key, so no image can be drawn - and the background failure must still reach the
    // agent through get_post rather than only a server log (R2).
    expect(page.illustration).toMatchObject({ state: 'failed', remaining: 2 })
    expect(page.illustration.lastError).toContain('GOOGLE_API_KEY')
    expect(page.status).toBe('draft')

    // The owner fills the pictures by hand, so the rest of the scene can run.
    const filled = await request.patch(`/api/admin/blog/${postId}`, {
      data: {
        coverImage: handUploaded('cover'),
        bodyMarkdown: page.body.markdown.replace(
          '(image1)',
          `(${handUploaded('image1')})`
        ),
      },
    })
    expect(filled.ok()).toBe(true)
    return
  }

  expect(page.illustration, JSON.stringify(page.illustration)).toMatchObject({
    state: 'idle',
    remaining: 0,
    lastError: null,
  })
  expect(page.placeholders).toEqual([])
  expect(page.coverImage).toMatch(/^https:\/\/res\.cloudinary\.com\//)
  expect(page.status).toBe('draft')
})

test('(3) publish_post makes the post readable immediately, images included', async ({
  request,
}) => {
  const published = await tool('publish_post', { id: postId })
  expect(published.isError, published.text).toBe(false)

  const res = await request.get(`/blog/${slug}`)
  expect(res.status()).toBe(200)
  const html = await res.text()
  expect(html).toContain(TITLE)
  const page = JSON.parse((await tool('get_post', { id: postId })).text)
  const bodyImage = /!\[A whiteboard\]\(([^)]+)\)/.exec(page.body.markdown)?.[1]
  expect(bodyImage).toMatch(/^https:\/\/res\.cloudinary\.com\//)
  expect(html).toContain(bodyImage!)
})

test('(4) update_post on the live post: the next load shows the edit (C8)', async ({
  request,
}) => {
  const edited = await tool('update_post', {
    id: postId,
    edits: [
      {
        find: 'Shipping beat polishing.\n\n![',
        replace: 'Shipping beat polishing, every single time.\n\n![',
      },
    ],
  })
  expect(edited.isError, edited.text).toBe(false)
  const html = await (await request.get(`/blog/${slug}`)).text()
  expect(html).toContain('Shipping beat polishing, every single time.')
})

test('(5) generate_image attached to the live post: the next load shows it (C8)', async ({
  request,
}) => {
  test.skip(
    !HAS_IMAGE_KEY,
    'GOOGLE_API_KEY is not set, so no image can be drawn'
  )
  test.setTimeout(180_000)
  const drawn = await tool('generate_image', {
    postId,
    target: 'cover',
    mode: 'attach',
    prompt:
      'A flat illustration of a finished whiteboard photographed at an angle, soft colours',
  })
  expect(drawn.isError, drawn.text).toBe(false)
  const { url } = JSON.parse(drawn.text)
  const html = await (await request.get(`/blog/${slug}`)).text()
  expect(html).toContain(url)
})

test('(6) illustrate_post on the live post: the next load shows the new image (C8)', async ({
  request,
}) => {
  test.skip(
    !HAS_IMAGE_KEY,
    'GOOGLE_API_KEY is not set, so no image can be drawn'
  )
  test.setTimeout(320_000)
  // The owner adds a picture in the editor - an agent may not put a placeholder on a live
  // post (R7), but the owner's own editor is unchanged.
  const current = JSON.parse((await tool('get_post', { id: postId })).text)
  const patched = await request.patch(`/api/admin/blog/${postId}`, {
    data: {
      bodyMarkdown: `${current.body.markdown}\n\n![A second board](image2)`,
      imagePrompts: [
        ...current.imagePrompts,
        {
          key: 'image2',
          prompt: 'A flat illustration of two whiteboards side by side',
        },
      ],
    },
  })
  expect(patched.ok()).toBe(true)

  const start = await tool('illustrate_post', { id: postId })
  expect(start.isError, start.text).toBe(false)
  const page = await pollUntilIdle(postId)
  expect(page.illustration.state).toBe('idle')
  const second = /!\[A second board\]\(([^)]+)\)/.exec(page.body.markdown)?.[1]
  expect(second).toMatch(/^https:\/\/res\.cloudinary\.com\//)

  const html = await (await request.get(`/blog/${slug}`)).text()
  expect(html).toContain(second!)
})

test('(7) a stale editor tab gets the Reload / Overwrite banner after an MCP update_post (R9)', async ({
  page,
}) => {
  await page.goto(`/admin/blog/${postId}`)
  const title = page.getByLabel('Title', { exact: true })
  await expect(title).toHaveValue(TITLE)

  const agentTitle = `${TITLE} (agent)`
  const edited = await tool('update_post', { id: postId, title: agentTitle })
  expect(edited.isError, edited.text).toBe(false)

  await title.fill(`${TITLE} (stale tab)`)
  await page.getByRole('button', { name: 'Save now' }).first().click()
  const banner = page.getByTestId('blog-stale-banner')
  await expect(banner).toContainText('changed since you opened it')

  await banner.getByRole('button', { name: 'Reload' }).click()
  await expect(title).toHaveValue(agentTitle)
  await expect(banner).toHaveCount(0)
})
