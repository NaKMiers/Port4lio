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

import { MAX_IMAGE_PROMPTS } from '@/lib/blog/constants'
import { PostModel } from '@/models/Post'

/**
 * `POST /api/admin/blog/<id>/image-prompt`, against a real database with the model stubbed.
 *
 * ## The one thing here that no unit test could have caught
 *
 * ```ts
 *   post.markModified('imagePrompts')
 * ```
 *
 * Its own comment says why it is there: "Without it the push saves and the in-place edit
 * silently does not - which reads as 'regenerate works the first time'." That is a claim about
 * what mongoose does on a round trip to a real database, so proving it needs a real database
 * and a re-read. Every assertion below that matters reads the document back rather than
 * inspecting the response, for the same reason.
 *
 * The rest is the guard set: this route spends money per call, so each refusal it makes before
 * `chatCompletion` is a refusal that saves a completion, and each one it makes after is a
 * completion already paid for.
 */

let prompt =
  'A flat vector diagram of a request crossing three services, teal and slate.'

vi.mock('@/lib/blog/llm', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/blog/llm')>('@/lib/blog/llm')
  return {
    ...actual,
    chatCompletion: vi.fn(async () => ({
      text: JSON.stringify({ prompt }),
      model: 'ag/claude-sonnet-4-6',
      usage: undefined,
    })),
  }
})

let memory: MongoMemoryServer
let POST: (
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) => Promise<Response>
let chatCompletion: ReturnType<typeof vi.fn>

beforeAll(async () => {
  memory = await MongoMemoryServer.create()
  process.env.MONGODB_URI = memory.getUri()
  process.env.REQUIRE_ADMIN = 'false'
  process.env.LLM_API_KEY = 'test-key'
  await mongoose.connect(memory.getUri())
  ;({ POST } = await import('@/app/api/admin/blog/[id]/image-prompt/route'))
  ;({ chatCompletion } = (await import('@/lib/blog/llm')) as unknown as {
    chatCompletion: ReturnType<typeof vi.fn>
  })
}, 120_000)

afterAll(async () => {
  await mongoose.disconnect()
  await memory.stop()
})

beforeEach(() => {
  prompt =
    'A flat vector diagram of a request crossing three services, teal and slate.'
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
    bodyMarkdown:
      '## Heading\n\nProse.\n\n![image](image1)\n\nMore prose.\n\n![image](image2)',
    ...overrides,
  })
}

function call(id: string, body: Record<string, unknown>) {
  const request = new NextRequest(
    `http://localhost/api/admin/blog/${id}/image-prompt`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }
  )
  return POST(request, { params: Promise.resolve({ id }) })
}

describe('writing the prompt to the document', () => {
  it('saves a body prompt under its key', async () => {
    const post = await makePost()

    const response = await call(String(post._id), { key: 'image1' })

    expect(response.status).toBe(200)
    const after = await PostModel.findById(post._id)
    expect(
      after?.imagePrompts.find(entry => entry.key === 'image1')?.prompt
    ).toBe(prompt)
  })

  it('OVERWRITES an existing prompt in place, which is what markModified exists for', async () => {
    /*
      The regression the route's comment predicts. The first call pushes a new subdocument and
      mongoose tracks that; the second mutates one in place, which it does not track on this
      path. Without `markModified` the second `save()` is a silent no-op and the author sees
      "regenerate works the first time and never again".

      Re-reading from the database is the whole point - the in-memory document would show the
      new value either way.
    */
    const post = await makePost()

    await call(String(post._id), { key: 'image1' })
    prompt = 'A completely different second prompt, to prove the write landed.'
    await call(String(post._id), { key: 'image1' })

    const after = await PostModel.findById(post._id)
    expect(after?.imagePrompts).toHaveLength(1)
    expect(after?.imagePrompts[0].prompt).toBe(
      'A completely different second prompt, to prove the write landed.'
    )
  })

  it('saves a cover prompt to coverImagePrompt, not into the array', async () => {
    const post = await makePost()

    await call(String(post._id), { target: 'cover' })

    const after = await PostModel.findById(post._id)
    expect(after?.coverImagePrompt).toBe(prompt)
    expect(after?.imagePrompts).toHaveLength(0)
  })

  it('does not move contentUpdatedAt - a prompt is not something a reader can see', async () => {
    // The same rule the PATCH handler follows. Bumping the freshness date for a note about a
    // picture that does not exist yet would tell crawlers the post changed when nothing did.
    const post = await makePost()
    const before = post.contentUpdatedAt?.toISOString()

    await call(String(post._id), { key: 'image1' })

    expect(
      (await PostModel.findById(post._id))?.contentUpdatedAt?.toISOString()
    ).toBe(before)
  })
})

describe('refusals that happen BEFORE a completion is paid for', () => {
  it('refuses a body with neither a cover target nor a key', async () => {
    const post = await makePost()

    expect((await call(String(post._id), {})).status).toBe(400)
    expect(chatCompletion).not.toHaveBeenCalled()
  })

  it('refuses a post with an empty body', async () => {
    // A prompt written from an empty post is a prompt about nothing, and returning one would
    // look like success.
    const post = await makePost({ bodyMarkdown: '   ' })

    expect((await call(String(post._id), { target: 'cover' })).status).toBe(409)
    expect(chatCompletion).not.toHaveBeenCalled()
  })

  it('refuses a key that is no longer a placeholder in the body', async () => {
    /*
      The orphan guard. `imagePrompts` is a lookup beside the markdown and the editor only
      renders cards for keys it finds in the text, so a prompt written for a key the author has
      since deleted would be saved, invisible, and unreachable.
    */
    const post = await makePost()

    expect((await call(String(post._id), { key: 'image9' })).status).toBe(409)
    expect(chatCompletion).not.toHaveBeenCalled()
  })

  it('refuses a soft-deleted post', async () => {
    // A post the author has already thrown away. Spending a model call to write a field
    // nothing will render is paying for nothing.
    const post = await makePost({ status: 'deleted' })

    expect((await call(String(post._id), { key: 'image1' })).status).toBe(409)
    expect(chatCompletion).not.toHaveBeenCalled()
  })

  it('refuses a new key once the post is already at the cap, naming the limit', async () => {
    /*
      This used to be discovered at `save()` - i.e. AFTER the completion - where the schema
      validator threw and the catch turned it into a generic 500. "Could not write an image
      prompt right now" for a condition that is permanent, fixable, and costs money each time
      the author retries.
    */
    const keys = Array.from(
      { length: MAX_IMAGE_PROMPTS + 1 },
      (_, n) => `image${n + 1}`
    )
    const post = await makePost({
      bodyMarkdown: keys.map(key => `![image](${key})`).join('\n\n'),
      imagePrompts: keys
        .slice(0, MAX_IMAGE_PROMPTS)
        .map(key => ({ key, prompt: 'x' })),
    })

    const response = await call(String(post._id), {
      key: keys[MAX_IMAGE_PROMPTS],
    })
    const body = (await response.json()) as { error?: string }

    expect(response.status).toBe(409)
    expect(body.error).toContain(String(MAX_IMAGE_PROMPTS))
    expect(chatCompletion).not.toHaveBeenCalled()
  })

  it('still rewrites an EXISTING key when the post is at the cap', async () => {
    // The control. A cap check that blocked rewrites would make a full post uneditable, which
    // is worse than the 500 it replaced.
    const keys = Array.from(
      { length: MAX_IMAGE_PROMPTS },
      (_, n) => `image${n + 1}`
    )
    const post = await makePost({
      bodyMarkdown: keys.map(key => `![image](${key})`).join('\n\n'),
      imagePrompts: keys.map(key => ({ key, prompt: 'x' })),
    })

    expect((await call(String(post._id), { key: 'image1' })).status).toBe(200)
    expect(chatCompletion).toHaveBeenCalledTimes(1)
  })

  it('404s an id that is not an ObjectId', async () => {
    expect((await call('not-an-id', { target: 'cover' })).status).toBe(404)
  })
})

describe('when the model does not cooperate', () => {
  it('maps an empty prompt to 422 rather than saving a blank one', async () => {
    prompt = '   '
    const post = await makePost()

    expect((await call(String(post._id), { key: 'image1' })).status).toBe(422)
    expect((await PostModel.findById(post._id))?.imagePrompts).toHaveLength(0)
  })

  it('re-emits an upstream 429 as a 429', async () => {
    const { LlmError } =
      await vi.importActual<typeof import('@/lib/blog/llm')>('@/lib/blog/llm')
    chatCompletion.mockRejectedValueOnce(new LlmError('Rate limited.', 429))
    const post = await makePost()

    expect((await call(String(post._id), { key: 'image1' })).status).toBe(429)
  })

  it('maps any other model failure to 502, not to our own 500', async () => {
    const { LlmError } =
      await vi.importActual<typeof import('@/lib/blog/llm')>('@/lib/blog/llm')
    chatCompletion.mockRejectedValueOnce(
      new LlmError('Could not reach the model endpoint.', null)
    )
    const post = await makePost()

    expect((await call(String(post._id), { key: 'image1' })).status).toBe(502)
  })
})
