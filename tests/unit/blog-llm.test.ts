import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  chatCompletion,
  extractJsonObject,
  LlmError,
  type CompletionRequest,
} from '@/lib/blog/llm'

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
    expect(extractJsonObject('```json\n{"title":"a"}\n```')).toEqual({
      title: 'a',
    })
  })

  it('reads an unlabelled fence', () => {
    expect(extractJsonObject('```\n{"title":"a"}\n```')).toEqual({ title: 'a' })
  })

  it('reads an object wrapped in prose', () => {
    const text =
      'Here is the post you asked for:\n\n{"title":"a"}\n\nLet me know what you think.'

    expect(extractJsonObject(text)).toEqual({ title: 'a' })
  })

  it('keeps a body containing braces intact', () => {
    // The first-`{`-to-last-`}` span, not the first-to-first. A post about JavaScript is full
    // of braces, and a lazy scan would cut the body at the first code block.
    const payload = extractJsonObject(
      '```json\n{"bodyMarkdown":"use `{ a: 1 }` here"}\n```'
    )

    expect(payload.bodyMarkdown).toBe('use `{ a: 1 }` here')
  })

  it('refuses a truncated object rather than repairing it', () => {
    expect(() => extractJsonObject('{"bodyMarkdown":"half a post')).toThrow(
      LlmError
    )
    expect(() => extractJsonObject('{"bodyMarkdown":"half a post')).toThrow(
      /token limit/
    )
  })

  it('refuses a reply with no object in it', () => {
    expect(() => extractJsonObject('I cannot write that post.')).toThrow(
      LlmError
    )
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

  function ok(
    body: unknown,
    headers: Record<string, string> = { 'content-type': 'application/json' }
  ) {
    return new Response(JSON.stringify(body), { status: 200, headers })
  }

  const REPLY = {
    choices: [{ message: { content: '{"title":"x"}' } }],
    model: 'ag/claude-sonnet-4-6',
  }
  const ARGS = {
    model: 'ag/claude-sonnet-4-6',
    messages: [{ role: 'user' as const, content: 'hi' }],
  }

  beforeEach(() => {
    process.env.LLM_API_KEY = 'test-key'
    process.env.LLM_BASE_URL = 'https://router.example/'
    // Explicit, not incidental. Every failure case below asserts that `chatCompletion` REJECTS,
    // and it only rejects while there is no second provider to try. Leaving this to whether the
    // shell happened to export a key would make the block pass or fail on the environment.
    delete process.env.GOOGLE_API_KEY
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
  ])(
    'maps a %i from the router to a message the author can act on',
    async (status, message) => {
      stubFetch(new Response('nope', { status }))

      await expect(chatCompletion(ARGS)).rejects.toThrow(message)
    }
  )

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
    globalThis.fetch = (() =>
      Promise.reject(
        new Error('connect ECONNREFUSED router.example')
      )) as unknown as typeof fetch

    await expect(chatCompletion(ARGS)).rejects.toThrow(
      'Could not reach the model endpoint.'
    )
  })

  it('reports a timeout as a timeout, with the budget in seconds', async () => {
    const timeout = new Error('timed out')
    timeout.name = 'TimeoutError'
    globalThis.fetch = (() =>
      Promise.reject(timeout)) as unknown as typeof fetch

    await expect(
      chatCompletion({ ...ARGS, timeoutMs: 60_000 })
    ).rejects.toThrow(/within 60s/)
  })
})

/**
 * The Gemini fallback: what happens when the router cannot be reached at all.
 *
 * ```
 *   routerCompletion ──▶ ok ──────────────────────────────▶ result
 *          │
 *          ├─ bad-reply ─────────────────────────────────▶ throw, no second call
 *          │
 *          └─ unreachable / timeout / 401 / 429 / 5xx
 *                  └─ GOOGLE_API_KEY set ──▶ Gemini ─────▶ result
 * ```
 *
 * The distinction in the middle branch is the design, and it is the one worth testing hardest.
 * "We never got a completion" is worth a second provider. "We got a completion and it was
 * unusable" is a model behaving badly, and a different model billed separately will usually
 * behave badly too - so an empty reply or malformed JSON must NOT cost a second call.
 *
 * The request shape below was verified against the live API before the code was written, which
 * matters more here than anywhere else in this file: a fallback that 404s only reveals itself
 * on the day the primary is already down.
 */
describe('chatCompletion - the Gemini fallback', () => {
  const ORIGINAL_FETCH = globalThis.fetch
  const ORIGINAL = {
    llmKey: process.env.LLM_API_KEY,
    base: process.env.LLM_BASE_URL,
    google: process.env.GOOGLE_API_KEY,
    model: process.env.GEMINI_MODEL,
  }

  type Call = { url: string; init: RequestInit }

  /** Router answers with `routerStatus`; anything hitting Google gets `geminiBody`. */
  function stubBoth(options: {
    routerStatus?: number
    routerThrows?: boolean
    geminiBody?: unknown
    geminiStatus?: number
  }) {
    const calls: Call[] = []
    globalThis.fetch = ((url: string, init: RequestInit) => {
      calls.push({ url, init })

      if (url.includes('generativelanguage'))
        return Promise.resolve(
          new Response(JSON.stringify(options.geminiBody ?? GEMINI_REPLY), {
            status: options.geminiStatus ?? 200,
            headers: { 'content-type': 'application/json' },
          })
        )

      if (options.routerThrows) return Promise.reject(new Error('ECONNREFUSED'))

      return Promise.resolve(
        new Response('{"error":"nope"}', {
          status: options.routerStatus ?? 503,
          headers: { 'content-type': 'application/json' },
        })
      )
    }) as unknown as typeof fetch
    return calls
  }

  const GEMINI_REPLY = {
    candidates: [
      {
        finishReason: 'STOP',
        content: { parts: [{ text: '{"title":"from gemini"}' }] },
      },
    ],
    usageMetadata: {
      promptTokenCount: 11,
      candidatesTokenCount: 22,
      totalTokenCount: 33,
    },
    modelVersion: 'gemini-3.8-flash',
  }

  // Typed rather than inferred: the cases below vary the roles and add `temperature`, and a
  // literal widened from this object would refuse both.
  const ARGS: CompletionRequest = {
    model: 'ag/claude-sonnet-4-6',
    messages: [
      { role: 'system', content: 'the house style' },
      { role: 'user', content: 'the brief' },
    ],
  }

  beforeEach(() => {
    process.env.LLM_API_KEY = 'test-key'
    process.env.LLM_BASE_URL = 'https://router.example'
    process.env.GOOGLE_API_KEY = 'google-test-key'
    delete process.env.GEMINI_MODEL
  })

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH
    process.env.LLM_API_KEY = ORIGINAL.llmKey
    process.env.LLM_BASE_URL = ORIGINAL.base
    process.env.GOOGLE_API_KEY = ORIGINAL.google
    process.env.GEMINI_MODEL = ORIGINAL.model
  })

  describe('when it engages', () => {
    it.each([
      ['a transport failure', { routerThrows: true }],
      ['a 503', { routerStatus: 503 }],
      ['a 429', { routerStatus: 429 }],
      ['a 401 on our own key', { routerStatus: 401 }],
    ])('rescues %s', async (_label, options) => {
      const calls = stubBoth(options)

      const result = await chatCompletion(ARGS)

      expect(result.text).toBe('{"title":"from gemini"}')
      expect(calls).toHaveLength(2)
      expect(calls[1].url).toContain('generativelanguage')
    })

    it('runs when LLM_API_KEY is not configured at all', async () => {
      // A missing key used to throw out of `getRequiredEnv` before any provider was tried, which
      // would skip the one that IS configured. It is now just another way the router is absent.
      delete process.env.LLM_API_KEY
      const calls = stubBoth({})

      await expect(chatCompletion(ARGS)).resolves.toMatchObject({
        model: 'gemini-3.8-flash',
      })
      expect(calls).toHaveLength(1)
      expect(calls[0].url).toContain('generativelanguage')
    })

    it('reports the model that actually ran, so the caller can say so', async () => {
      stubBoth({ routerStatus: 503 })

      await expect(chatCompletion(ARGS)).resolves.toMatchObject({
        model: 'gemini-3.8-flash',
      })
    })

    it('maps usage out of Gemini names into ours', async () => {
      stubBoth({ routerStatus: 503 })

      await expect(chatCompletion(ARGS)).resolves.toMatchObject({
        usage: { promptTokens: 11, completionTokens: 22, totalTokens: 33 },
      })
    })
  })

  describe('when it stays out of the way', () => {
    it('does not pay for a second call on an unusable reply', async () => {
      // `bad-reply` is a model behaving badly, not a provider being down. A different model
      // billed separately usually behaves badly too.
      const calls = stubBoth({})
      globalThis.fetch = (() =>
        Promise.resolve(
          new Response(
            JSON.stringify({ choices: [{ message: { content: '' } }] }),
            {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }
          )
        )) as unknown as typeof fetch

      await expect(chatCompletion(ARGS)).rejects.toThrow(/empty reply/)
      expect(calls).toHaveLength(0)
    })

    it('does nothing when no Google key is configured', async () => {
      delete process.env.GOOGLE_API_KEY
      const calls = stubBoth({ routerStatus: 503 })

      await expect(chatCompletion(ARGS)).rejects.toThrow(/returned 503/)
      expect(calls).toHaveLength(1)
    })

    it('leads with the router failure when both fail', async () => {
      // The author has to fix the router, not the spare tyre. And `status` stays the router's so
      // the route keeps re-emitting a 429 as a 429.
      stubBoth({ routerStatus: 429, geminiStatus: 500 })

      await expect(chatCompletion(ARGS)).rejects.toMatchObject({
        status: 429,
        // `[\s\S]*` rather than the `s` flag: the tsconfig target predates it.
        message: expect.stringMatching(
          /rate limiting us[\s\S]*Gemini fallback also failed[\s\S]*500/
        ),
      })
    })
  })

  describe('the request Gemini actually receives', () => {
    async function geminiCall(args: CompletionRequest = ARGS) {
      const calls = stubBoth({ routerStatus: 503 })
      await chatCompletion(args)
      return calls[1]
    }

    it('sends the key as a header and never in the URL', async () => {
      /*
        A secret in a query string is written to every proxy log and error report between here
        and Google. The documented quickstart uses `?key=`; this does not, and the header form
        was verified against the live endpoint.
      */
      const call = await geminiCall()

      expect(call.url).not.toContain('google-test-key')
      expect(call.url).not.toContain('key=')
      expect(
        (call.init.headers as Record<string, string>)['x-goog-api-key']
      ).toBe('google-test-key')
    })

    it('lifts the system message out of contents into systemInstruction', async () => {
      // Two silent shape differences from the OpenAI-style API: the system prompt is its own
      // top-level field, and a `role: 'system'` left in `contents` is rejected as unknown.
      const body = JSON.parse((await geminiCall()).init.body as string)

      expect(body.systemInstruction.parts[0].text).toBe('the house style')
      expect(body.contents).toEqual([
        { role: 'user', parts: [{ text: 'the brief' }] },
      ])
    })

    it('calls the assistant role "model"', async () => {
      const call = await geminiCall({
        ...ARGS,
        messages: [
          { role: 'user', content: 'a' },
          { role: 'assistant', content: 'b' },
        ],
      })
      const body = JSON.parse(call.init.body as string)

      expect(
        body.contents.map((entry: { role: string }) => entry.role)
      ).toEqual(['user', 'model'])
    })

    it('passes temperature and the output cap under their Gemini names', async () => {
      const call = await geminiCall({
        ...ARGS,
        temperature: 0.4,
        maxTokens: 900,
      })
      const body = JSON.parse(call.init.body as string)

      expect(body.generationConfig).toEqual({
        temperature: 0.4,
        maxOutputTokens: 900,
      })
    })
  })

  describe('which Gemini model runs', () => {
    async function modelInUrl(args: CompletionRequest = ARGS) {
      const calls = stubBoth({ routerStatus: 503 })
      await chatCompletion(args)
      return calls[1].url
    }

    it('defaults to a model verified to exist on this key', async () => {
      expect(await modelInUrl()).toContain('models/gemini-3.8-flash:')
    })

    it('honours GEMINI_MODEL', async () => {
      process.env.GEMINI_MODEL = 'gemini-3.5-flash'

      expect(await modelInUrl()).toContain('models/gemini-3.5-flash:')
    })

    it('keeps the author on Gemini when they already chose it', async () => {
      // `ag/gemini-3.8-flash` is a router alias for a model Google serves under the same name.
      // Substituting a different one would quietly overrule a choice the author made.
      expect(
        await modelInUrl({ ...ARGS, model: 'ag/gemini-3.5-flash' })
      ).toContain('models/gemini-3.5-flash:')
    })
  })

  describe('reading the reply', () => {
    it('drops the thinking parts instead of pasting them into the post', async () => {
      // A reasoning model returns its scratchpad as extra parts flagged `thought`. Concatenating
      // those puts the model's deliberations inside the published body.
      stubBoth({
        routerStatus: 503,
        geminiBody: {
          candidates: [
            {
              finishReason: 'STOP',
              content: {
                parts: [
                  { text: 'let me think about this', thought: true },
                  { text: '{"title":' },
                  { text: '"real"}' },
                ],
              },
            },
          ],
        },
      })

      await expect(chatCompletion(ARGS)).resolves.toMatchObject({
        text: '{"title":"real"}',
      })
    })

    it('names a truncated reply as the budget rather than as bad JSON', async () => {
      // The post comes back as JSON, so hitting the cap is not a short post - it is an
      // unterminated string, which `extractJsonObject` would report as malformed with no hint
      // that the cause was the output limit.
      stubBoth({
        routerStatus: 503,
        geminiBody: {
          candidates: [
            {
              finishReason: 'MAX_TOKENS',
              content: { parts: [{ text: '{"a"' }] },
            },
          ],
        },
      })

      await expect(chatCompletion(ARGS)).rejects.toThrow(/output limit/)
    })

    it('quotes a non-STOP finish reason when nothing came back', async () => {
      stubBoth({
        routerStatus: 503,
        geminiBody: {
          candidates: [{ finishReason: 'SAFETY', content: { parts: [] } }],
        },
      })

      await expect(chatCompletion(ARGS)).rejects.toThrow(/SAFETY/)
    })

    it('says which model is missing on a 404', async () => {
      // The failure a guessed model id produces, and it only ever shows up on the day the
      // router is already down.
      stubBoth({ routerStatus: 503, geminiStatus: 404 })

      await expect(chatCompletion(ARGS)).rejects.toThrow(/GEMINI_MODEL/)
    })
  })
})
