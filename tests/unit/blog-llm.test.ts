import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { chatCompletion, extractJsonObject, LlmError } from '@/lib/blog/llm'

/**
 * Getting a JSON object out of a model that was asked for one.
 *
 * Every case here is a real near-miss rather than a hypothetical. Asked for "only JSON", the
 * live router answered ` ```json\n{"ok":true,...}\n``` ` - output that is exactly right and
 * that `JSON.parse` rejects on the first backtick. Refusing a generated post over a fence is
 * throwing away a minute of model time for nothing.
 *
 * The line the recovery does NOT cross is repair. A truncated object means the model ran out
 * of tokens mid-post, and half a post accepted silently is worse than a refusal the author
 * can act on - they would publish it.
 */

describe('extractJsonObject', () => {
  it('reads a bare object', () => {
    expect(extractJsonObject('{"title":"a"}')).toEqual({ title: 'a' })
  })

  it('reads the fenced form the live endpoint actually returns', () => {
    expect(extractJsonObject('```json\n{"title":"a"}\n```')).toEqual({ title: 'a' })
  })

  it('reads an unlabelled fence', () => {
    expect(extractJsonObject('```\n{"title":"a"}\n```')).toEqual({ title: 'a' })
  })

  it('reads an object wrapped in prose', () => {
    const text = 'Here is the post you asked for:\n\n{"title":"a"}\n\nLet me know what you think.'

    expect(extractJsonObject(text)).toEqual({ title: 'a' })
  })

  it('keeps a body containing braces intact', () => {
    // The first-`{`-to-last-`}` span, not the first-to-first. A post about JavaScript is full
    // of braces, and a lazy scan would cut the body at the first code block.
    const payload = extractJsonObject('```json\n{"bodyMarkdown":"use `{ a: 1 }` here"}\n```')

    expect(payload.bodyMarkdown).toBe('use `{ a: 1 }` here')
  })

  it('refuses a truncated object rather than repairing it', () => {
    expect(() => extractJsonObject('{"bodyMarkdown":"half a post')).toThrow(LlmError)
    expect(() => extractJsonObject('{"bodyMarkdown":"half a post')).toThrow(/token limit/)
  })

  it('refuses a reply with no object in it', () => {
    expect(() => extractJsonObject('I cannot write that post.')).toThrow(LlmError)
  })

  it('unwraps the single-element array a model returns when it reads "object" as "result"', () => {
    // Falls out of the first-`{`-to-last-`}` span rather than needing its own branch, and it
    // is the right outcome: the post is in there, and refusing it would cost a generation
    // over a pair of brackets.
    expect(extractJsonObject('[{"title":"a"}]')).toEqual({ title: 'a' })
  })
})

/**
 * `chatCompletion` itself, which had no test at all.
 *
 * ## Why this block exists
 *
 * Everything above tests `extractJsonObject`. `chatCompletion` - the function the whole file is
 * named for, and the one that spends money - was never called by any test, so the single line
 * this module exists to guarantee was unpinned:
 *
 * ```ts
 *   stream: false,   // "Not optional, not a default, and the reason this file exists"
 * ```
 *
 * The router streams Server-Sent Events by DEFAULT, unlike the OpenAI API it otherwise mimics.
 * Deleting that line broke every generation and broke no test. That is exactly backwards for a
 * line carrying a comment that emphatic.
 *
 * `fetch` is stubbed rather than a server being run: the assertions are about the request we
 * send and the errors we raise, both of which are this module's own behaviour.
 */
describe('chatCompletion', () => {
  const ORIGINAL_FETCH = globalThis.fetch
  const ORIGINAL_KEY = process.env.LLM_API_KEY
  const ORIGINAL_BASE = process.env.LLM_BASE_URL

  function stubFetch(response: Response) {
    const calls: { url: string; init: RequestInit }[] = []
    globalThis.fetch = ((url: string, init: RequestInit) => {
      calls.push({ url, init })
      return Promise.resolve(response)
    }) as unknown as typeof fetch
    return calls
  }

  function ok(body: unknown, headers: Record<string, string> = { 'content-type': 'application/json' }) {
    return new Response(JSON.stringify(body), { status: 200, headers })
  }

  const REPLY = { choices: [{ message: { content: '{"title":"x"}' } }], model: 'ag/claude-sonnet-4-6' }
  const ARGS = { model: 'ag/claude-sonnet-4-6', messages: [{ role: 'user' as const, content: 'hi' }] }

  beforeEach(() => {
    process.env.LLM_API_KEY = 'test-key'
    process.env.LLM_BASE_URL = 'https://router.example/'
  })

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH
    process.env.LLM_API_KEY = ORIGINAL_KEY
    process.env.LLM_BASE_URL = ORIGINAL_BASE
  })

  it('sends stream:false, which is the entire reason this module exists', async () => {
    // The load-bearing assertion in this file. The router's default is SSE, so without this
    // field every generation fails on `JSON.parse` at the first `data:` line.
    const calls = stubFetch(ok(REPLY))

    await chatCompletion(ARGS)

    expect(JSON.parse(String(calls[0].init.body)).stream).toBe(false)
  })

  it('does not let Next cache a completion, which would hand the author the same post twice', async () => {
    const calls = stubFetch(ok(REPLY))

    await chatCompletion(ARGS)

    expect((calls[0].init as { cache?: string }).cache).toBe('no-store')
  })

  it('omits temperature and max_tokens rather than sending undefined', async () => {
    // They are spread in conditionally. `{"temperature": undefined}` serialises to a missing
    // key, but an explicit `null` would not, and some routers reject it.
    const calls = stubFetch(ok(REPLY))

    await chatCompletion(ARGS)

    const body = JSON.parse(String(calls[0].init.body))
    expect('temperature' in body).toBe(false)
    expect('max_tokens' in body).toBe(false)
  })

  it('passes temperature and max_tokens when they are given', async () => {
    const calls = stubFetch(ok(REPLY))

    await chatCompletion({ ...ARGS, temperature: 0.85, maxTokens: 600 })

    const body = JSON.parse(String(calls[0].init.body))
    expect(body.temperature).toBe(0.85)
    expect(body.max_tokens).toBe(600)
  })

  it('strips the trailing slash off LLM_BASE_URL instead of doubling it', async () => {
    const calls = stubFetch(ok(REPLY))

    await chatCompletion(ARGS)

    expect(calls[0].url).toBe('https://router.example/v1/chat/completions')
  })

  it('names a streamed reply instead of failing on JSON.parse', async () => {
    /*
      The failure `assertNotStreamed` exists for. Without it the router changing its default
      surfaces as `Unexpected token 'd', "data: {"id"... is not valid JSON` - a message that
      points at our parser rather than at the cause, on a path that costs money per attempt.
    */
    stubFetch(
      new Response('data: {"id":"1"}\n\n', {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })
    )

    await expect(chatCompletion(ARGS)).rejects.toThrow(/stream: false/)
  })

  it('catches a streamed body even when the content-type does not say so', async () => {
    // The `raw.startsWith('data:')` half of the guard - a router that streams while still
    // labelling the response as JSON.
    stubFetch(
      new Response('data: {"id":"1"}\n\n', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )

    await expect(chatCompletion(ARGS)).rejects.toThrow(LlmError)
  })

  it.each([
    [401, /LLM_API_KEY/],
    [403, /LLM_API_KEY/],
    [429, /rate limiting/],
    [500, /returned 500/],
  ])('maps a %i from the router to a message the author can act on', async (status, message) => {
    stubFetch(new Response('nope', { status }))

    await expect(chatCompletion(ARGS)).rejects.toThrow(message)
  })

  it('carries the upstream status on the error, so the route can re-emit a 429 as a 429', async () => {
    stubFetch(new Response('slow down', { status: 429 }))

    await expect(chatCompletion(ARGS)).rejects.toMatchObject({ status: 429 })
  })

  it('refuses an empty reply rather than saving a post with no body', async () => {
    stubFetch(ok({ choices: [{ message: { content: '   ' } }] }))

    await expect(chatCompletion(ARGS)).rejects.toThrow(/empty reply/)
  })

  it('does not leak the endpoint URL when the request fails', async () => {
    /*
      `LLM_BASE_URL` is a private tailnet host. The catch deliberately avoids `String(error)`
      for that reason, and this pins it: a fetch rejection must not put the hostname in a
      message that reaches the browser.
    */
    globalThis.fetch = (() => Promise.reject(new Error('connect ECONNREFUSED router.example'))) as unknown as typeof fetch

    await expect(chatCompletion(ARGS)).rejects.toThrow('Could not reach the model endpoint.')
  })

  it('reports a timeout as a timeout, with the budget in seconds', async () => {
    const timeout = new Error('timed out')
    timeout.name = 'TimeoutError'
    globalThis.fetch = (() => Promise.reject(timeout)) as unknown as typeof fetch

    await expect(chatCompletion({ ...ARGS, timeoutMs: 60_000 })).rejects.toThrow(/within 60s/)
  })
})
