import 'server-only'

/**
 * The chat-completions client, and the only place `LLM_API_KEY` is read.
 *
 * ```
 *   chatCompletion({ model, messages, temperature })
 *          │
 *          │  POST <LLM_BASE_URL>/v1/chat/completions
 *          │  Authorization: Bearer $LLM_API_KEY
 *          │  { ..., "stream": false }      ← load-bearing, see below
 *          ▼
 *   { choices: [ { message: { content } } ], usage }
 *          │
 *          └──▶ { text, usage, model }
 * ```
 *
 * `import 'server-only'`: the key is a bearer token for a paid endpoint, so this module must
 * be unreachable from anything that ships to a browser. Nothing here is ever logged with the
 * key in it - `Authorization` is set at the call and never put in an error message.
 *
 * ## `"stream": false` is not a default, and leaving it out is the bug
 *
 * OpenAI's API treats a missing `stream` as `false`. This router does not: omit it and the
 * response arrives as `text/event-stream`, a run of `data: {...}` lines each carrying a
 * `choices[0].delta.content` fragment. Measured against the live endpoint - the same request
 * with and without the flag:
 *
 * ```
 *   (no stream key)    content-type: text/event-stream   delta fragments, "```json\n{\"ok\"...
 *   "stream": false    content-type: application/json    {"choices":[{"message":{...}}]}
 * ```
 *
 * A caller that reached for `res.json()` on the first of those gets a parse error on `data: `
 * and no hint as to why, which is why the flag is set here rather than left to each call
 * site. `assertNotStreamed` below turns a future change of that default back into a message
 * that names the cause instead of a JSON syntax error.
 *
 * ## Why there is no streaming path at all
 *
 * The one caller generates a blog post and then does three things that need the whole text:
 * parses it as JSON, validates every field, and renders the markdown through Shiki. There is
 * no partial state worth showing, so streaming would buy a progress bar in exchange for a
 * second response format to parse and get wrong.
 */

const DEFAULT_BASE_URL = 'https://9router-server.tail1e90ee.ts.net'

/**
 * Long, because the work is long. A 2000-word post from a thinking model is a minute-plus of
 * generation, and an abort at 30s would look to the author exactly like a model that refuses
 * long posts. The route above this has the matching `maxDuration`.
 */
const DEFAULT_TIMEOUT_MS = 180_000

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type ChatUsage = {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export type ChatResult = {
  text: string
  /** The model the router actually ran, which is not always the alias that was asked for. */
  model: string
  usage: ChatUsage | null
}

/**
 * Thrown for every failure mode, with a message already safe to show the owner.
 *
 * `status` is the router's HTTP status where there was one, so a caller can tell a 401 on our
 * key from a 503 on their side - the first is our configuration and the second is worth
 * retrying. It is `null` for a timeout or a transport error.
 */
export class LlmError extends Error {
  readonly status: number | null
  /**
   * WHY it failed, as something switchable.
   *
   * Added for the Gemini fallback, which has to distinguish "the router never answered" from
   * "the router answered with something unusable". The first is worth trying a second provider
   * for; the second means a model produced a bad reply and a different model would most likely
   * produce a different bad reply at twice the cost. Doing that on `status` alone is not
   * possible - a transport failure and a malformed body both carry `null`.
   */
  readonly cause: LlmFailure

  constructor(
    message: string,
    status: number | null = null,
    cause: LlmFailure = 'bad-reply'
  ) {
    super(message)
    this.name = 'LlmError'
    this.status = status
    this.cause = cause
  }
}

export type LlmFailure =
  /** No key configured, or the endpoint refused the one we sent. */
  | 'unauthorized'
  /** Transport failure - DNS, refused connection, the tailnet host being down. */
  | 'unreachable'
  /** The budget ran out before a reply arrived. */
  | 'timeout'
  /** 429. */
  | 'rate-limited'
  /** 5xx. The provider is up enough to answer and not well enough to work. */
  | 'upstream'
  /** It answered, and what it said was unusable. A second provider does not help. */
  | 'bad-reply'

/**
 * The failures a second provider can rescue.
 *
 * Every one of these is "we did not get a completion", never "we got a bad completion". A
 * malformed or empty reply is deliberately absent: that is a model behaving badly rather than
 * a provider being unavailable, and paying a second provider to find out usually buys a
 * second malformed reply.
 */
const FALLBACK_WORTHY: ReadonlySet<LlmFailure> = new Set<LlmFailure>([
  'unauthorized',
  'unreachable',
  'timeout',
  'rate-limited',
  'upstream',
])

function baseUrl(): string {
  return (process.env.LLM_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '')
}

/**
 * Catch a streamed body before `JSON.parse` does.
 *
 * The failure this prevents is a real one that a plain parse reports uselessly: if the
 * router's default changes, or `stream: false` is dropped from the body below, every
 * generation fails with `Unexpected token 'd', "data: {"id"... is not valid JSON` and nothing
 * points at the cause. Naming it costs four lines.
 */
function assertNotStreamed(contentType: string | null, raw: string): void {
  if (contentType?.includes('text/event-stream') || raw.startsWith('data:'))
    throw new LlmError(
      'The model endpoint streamed its reply. It was asked not to - `stream: false` is set on every request - so the router changed its default.',
      null
    )
}

export type CompletionRequest = {
  model: string
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
  timeoutMs?: number
}

async function routerCompletion({
  model,
  messages,
  temperature,
  maxTokens,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: CompletionRequest): Promise<ChatResult> {
  /*
    Read rather than required, and that is the change.

    `getRequiredEnv` threw, which was right when the router was the only provider: a missing key
    is a misconfiguration and crashing names it. With a fallback behind this it is just one more
    way the router is unavailable, and throwing here would skip the provider that IS configured.
  */
  const apiKey = process.env.LLM_API_KEY?.trim()
  if (!apiKey)
    throw new LlmError('LLM_API_KEY is not set.', null, 'unauthorized')

  // `AbortSignal.timeout` rather than a manual controller plus `setTimeout`: the manual
  // version leaks the timer on the success path unless every caller remembers to clear it,
  // and on a 180s budget that timer outlives plenty of requests.
  const signal = AbortSignal.timeout(timeoutMs)

  let response: Response
  try {
    response = await fetch(`${baseUrl()}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        // See the header. Not optional, not a default, and the reason this file exists.
        stream: false,
        ...(temperature === undefined ? {} : { temperature }),
        ...(maxTokens === undefined ? {} : { max_tokens: maxTokens }),
      }),
      signal,
      // Next caches `fetch` in a route handler by default under some configurations, and a
      // cached completion would hand the author the same post twice.
      cache: 'no-store',
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError')
      throw new LlmError(
        `The model did not answer within ${Math.round(timeoutMs / 1000)}s. A shorter post, or a faster model, usually gets through.`,
        null,
        'timeout'
      )

    // Deliberately not `String(error)`: a fetch failure can carry the URL, and the URL is a
    // private tailnet host.
    console.error('[blog/llm] request failed', error)
    throw new LlmError(
      'Could not reach the model endpoint.',
      null,
      'unreachable'
    )
  }

  const raw = await response.text()

  if (!response.ok) {
    console.error(
      `[blog/llm] ${response.status} from the router`,
      raw.slice(0, 500)
    )
    if (response.status === 401 || response.status === 403)
      throw new LlmError(
        'The model endpoint refused our key. Check LLM_API_KEY.',
        response.status,
        'unauthorized'
      )

    if (response.status === 429)
      throw new LlmError(
        'The model endpoint is rate limiting us. Try again shortly.',
        429,
        'rate-limited'
      )

    throw new LlmError(
      `The model endpoint returned ${response.status}.`,
      response.status,
      response.status >= 500 ? 'upstream' : 'bad-reply'
    )
  }

  assertNotStreamed(response.headers.get('content-type'), raw.trimStart())

  let payload: {
    model?: unknown
    choices?: { message?: { content?: unknown } }[]
    usage?: {
      prompt_tokens?: unknown
      completion_tokens?: unknown
      total_tokens?: unknown
    }
  }
  try {
    payload = JSON.parse(raw)
  } catch {
    console.error('[blog/llm] unparseable body', raw.slice(0, 500))
    throw new LlmError(
      'The model endpoint returned something that was not JSON.',
      null
    )
  }

  const text = payload.choices?.[0]?.message?.content
  if (typeof text !== 'string' || !text.trim())
    throw new LlmError('The model returned an empty reply.', null)

  return {
    text,
    model: typeof payload.model === 'string' ? payload.model : model,
    usage: payload.usage
      ? {
          promptTokens: Number(payload.usage.prompt_tokens ?? 0),
          completionTokens: Number(payload.usage.completion_tokens ?? 0),
          totalTokens: Number(payload.usage.total_tokens ?? 0),
        }
      : null,
  }
}

/**
 * Google's Generative Language API, used only when the router could not produce a completion.
 *
 * ```
 *   POST <GOOGLE_API_BASE_URL>/models/<model>:generateContent
 *   x-goog-api-key: $GOOGLE_API_KEY          ← header, never ?key=
 *   { systemInstruction, contents, generationConfig }
 *          ▼
 *   { candidates: [ { content: { parts: [ {text} ] }, finishReason } ], usageMetadata }
 * ```
 *
 * ## The key goes in a header, and that is not a style preference
 *
 * The documented quickstart puts it in the query string as `?key=…`. A secret in a URL is
 * written to every proxy log, every error report and every `fetch` failure message between
 * here and Google - and `llm.ts` already refuses to interpolate the router URL into an error
 * for the weaker version of that reason. `x-goog-api-key` is the supported header form and was
 * verified against the live endpoint before this was written.
 *
 * ## The shape below was measured, not guessed
 *
 * A fallback that 404s is worse than no fallback, because it only runs on the day the primary
 * is already down. The model list, the request body and the response shape were all checked
 * against the live API with the project's own key first: `gemini-3.8-flash` exists, the
 * `systemInstruction` / `contents` / `generationConfig` body is accepted, and the reply carries
 * `candidates[0].content.parts[].text` plus a `usageMetadata` whose counts are named
 * differently from the router's.
 */
const DEFAULT_GEMINI_BASE_URL =
  'https://generativelanguage.googleapis.com/v1beta'

/** Overridable, because a model list is not a constant. Verified present on this project's key. */
const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash'

/**
 * Shorter than the router's 180s, and the number comes from the route above.
 *
 * `generate/route.ts` sets `maxDuration = 300`. The fallback runs AFTER the primary has already
 * spent its budget, so on the worst path - a router timeout - the two have to fit inside that
 * together: 180 + 90 leaves 30s for everything else. A fallback that gets killed by the
 * platform mid-flight is a fallback that turns one clear error into no error at all.
 */
const GEMINI_TIMEOUT_MS = 90_000

/** The Gemini model to run, given whatever the caller asked the router for. */
function geminiModelFor(requested: string): string {
  const configured = process.env.GEMINI_MODEL?.trim()
  if (configured) return configured

  // `ag/gemini-3.8-flash` is a router alias for a model Google serves directly under the same
  // name. When the author already chose Gemini, honour that rather than silently substituting.
  const withoutPrefix = requested.replace(/^[a-z]+\//, '')
  if (withoutPrefix.startsWith('gemini-')) return withoutPrefix

  return DEFAULT_GEMINI_MODEL
}

/**
 * Chat messages to Gemini's request body.
 *
 * Two shape differences from the OpenAI-style API the router speaks, and both are silent if
 * got wrong: the system prompt is its own top-level field rather than a message with
 * `role: 'system'`, and the assistant role is called `model`. A system message left in
 * `contents` is rejected as an unknown role.
 */
function toGeminiBody({ messages, temperature, maxTokens }: CompletionRequest) {
  const system = messages
    .filter(message => message.role === 'system')
    .map(message => message.content)
    .join('\n\n')

  const contents = messages
    .filter(message => message.role !== 'system')
    .map(message => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: message.content }],
    }))

  return {
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    contents,
    generationConfig: {
      ...(temperature === undefined ? {} : { temperature }),
      ...(maxTokens === undefined ? {} : { maxOutputTokens: maxTokens }),
    },
  }
}

async function geminiCompletion(
  request: CompletionRequest,
  apiKey: string
): Promise<ChatResult> {
  const model = geminiModelFor(request.model)
  const base = (
    process.env.GOOGLE_API_BASE_URL || DEFAULT_GEMINI_BASE_URL
  ).replace(/\/+$/, '')

  let response: Response
  try {
    response = await fetch(`${base}/models/${model}:generateContent`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(toGeminiBody(request)),
      signal: AbortSignal.timeout(request.timeoutMs ?? GEMINI_TIMEOUT_MS),
      cache: 'no-store',
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError')
      throw new LlmError(
        `Gemini did not answer within ${Math.round((request.timeoutMs ?? GEMINI_TIMEOUT_MS) / 1000)}s.`,
        null,
        'timeout'
      )

    console.error('[blog/llm] gemini request failed', error)
    throw new LlmError('Could not reach Gemini.', null, 'unreachable')
  }

  const raw = await response.text()

  if (!response.ok) {
    // Truncated, and never the request body: the body is the whole brief and the reply quotes
    // parts of it back in error messages.
    console.error(`[blog/llm] gemini ${response.status}`, raw.slice(0, 300))

    if (response.status === 401 || response.status === 403)
      throw new LlmError(
        'Gemini refused our key. Check GOOGLE_API_KEY.',
        response.status,
        'unauthorized'
      )

    if (response.status === 429)
      throw new LlmError('Gemini is rate limiting us.', 429, 'rate-limited')

    if (response.status === 404)
      throw new LlmError(
        `Gemini has no model called "${model}". Set GEMINI_MODEL to one the key can reach.`,
        404,
        'bad-reply'
      )

    throw new LlmError(
      `Gemini returned ${response.status}.`,
      response.status,
      response.status >= 500 ? 'upstream' : 'bad-reply'
    )
  }

  let payload: {
    modelVersion?: unknown
    candidates?: {
      finishReason?: unknown
      content?: { parts?: { text?: unknown; thought?: unknown }[] }
    }[]
    usageMetadata?: {
      promptTokenCount?: unknown
      candidatesTokenCount?: unknown
      totalTokenCount?: unknown
    }
  }
  try {
    payload = JSON.parse(raw)
  } catch {
    console.error('[blog/llm] gemini unparseable body', raw.slice(0, 300))
    throw new LlmError('Gemini returned something that was not JSON.', null)
  }

  const candidate = payload.candidates?.[0]

  /*
    `MAX_TOKENS` is named separately because of what it does downstream. The post comes back as
    JSON, so a truncated reply is not a short post - it is an unterminated string, and
    `extractJsonObject` reports it as malformed JSON with no hint that the cause was the budget.
  */
  if (candidate?.finishReason === 'MAX_TOKENS')
    throw new LlmError(
      'Gemini hit its output limit mid-post, so the JSON is truncated. Try a shorter length.',
      null
    )

  // Joined across parts, and thinking parts dropped: a reasoning model returns its scratchpad
  // as additional parts flagged `thought`, and concatenating those into the body would put the
  // model's deliberations inside the post.
  const text = (candidate?.content?.parts ?? [])
    .filter(part => part.thought !== true && typeof part.text === 'string')
    .map(part => part.text as string)
    .join('')

  if (!text.trim())
    throw new LlmError(
      candidate?.finishReason && candidate.finishReason !== 'STOP'
        ? `Gemini returned nothing and gave "${String(candidate.finishReason)}" as the reason.`
        : 'Gemini returned an empty reply.',
      null
    )

  return {
    text,
    model:
      typeof payload.modelVersion === 'string' ? payload.modelVersion : model,
    usage: payload.usageMetadata
      ? {
          promptTokens: Number(payload.usageMetadata.promptTokenCount ?? 0),
          completionTokens: Number(
            payload.usageMetadata.candidatesTokenCount ?? 0
          ),
          totalTokens: Number(payload.usageMetadata.totalTokenCount ?? 0),
        }
      : null,
  }
}

/**
 * The router, and Gemini behind it when the router could not be reached.
 *
 * ```
 *   routerCompletion ──▶ ok ────────────────────────────────▶ result
 *          │
 *          ├─ bad-reply ───────────────────────────────────▶ throw (a second model does not help)
 *          │
 *          └─ unreachable / timeout / 401 / 429 / 5xx
 *                  │
 *                  ├─ no GOOGLE_API_KEY ──────────────────▶ throw the original
 *                  │
 *                  └─ geminiCompletion ──▶ ok ────────────▶ result, `model` says gemini
 *                             │
 *                             └─ failed ─────────────────▶ throw, naming BOTH failures
 * ```
 *
 * ## Why the original error is the one that survives
 *
 * When both providers fail the author needs to fix the router, not Gemini - the fallback is
 * the spare tyre and nobody diagnoses a spare tyre. So the message leads with what the router
 * did and appends what Gemini did, and `status` stays the router's so `generate/route.ts` keeps
 * re-emitting a 429 as a 429.
 *
 * ## Why a bad reply does not fall through
 *
 * `bad-reply` covers a streamed body, an empty completion and unparseable JSON. Those are a
 * model behaving badly rather than a provider being down, and spending a second provider's
 * tokens to discover the same thing costs money and a minute for an outcome the author would
 * have to act on either way.
 */
export async function chatCompletion(
  request: CompletionRequest
): Promise<ChatResult> {
  try {
    return await routerCompletion(request)
  } catch (error) {
    if (!(error instanceof LlmError) || !FALLBACK_WORTHY.has(error.cause))
      throw error

    const googleKey = process.env.GOOGLE_API_KEY?.trim()
    if (!googleKey) throw error

    // Logged at warn, because a generation that quietly changes provider is a generation whose
    // cost and voice changed without anybody being told. The response carries the model that
    // actually ran, and `generate/route.ts` turns that into a warning for the author.
    console.warn(
      `[blog/llm] router failed (${error.cause}), falling back to Gemini: ${error.message}`
    )

    try {
      return await geminiCompletion(request, googleKey)
    } catch (fallbackError) {
      const detail =
        fallbackError instanceof Error ? fallbackError.message : 'unknown error'
      throw new LlmError(
        `${error.message} The Gemini fallback also failed: ${detail}`,
        error.status,
        error.cause
      )
    }
  }
}

/**
 * Pull a JSON object out of a model reply.
 *
 * Models fence their JSON. Asked for "only JSON", the live endpoint answered
 * ` ```json\n{"ok":true,...}\n``` ` - so a direct `JSON.parse` of the reply fails on the
 * first backtick, for output that is otherwise exactly right. Prose before or after the
 * object is the same class of near-miss.
 *
 * The recovery is deliberately narrow: strip a fence if there is one, otherwise take the span
 * from the first `{` to the last `}`. It does NOT try to repair malformed JSON - a truncated
 * object means the model ran out of tokens mid-post, and half a post silently accepted is
 * worse than a refusal the author can act on.
 */
export function extractJsonObject(text: string): Record<string, unknown> {
  let candidate = text.trim()

  const fence = candidate.match(/^```(?:json)?\s*\n([\s\S]*?)\n?```$/)
  if (fence) candidate = fence[1].trim()

  /*
    The first `{` to the last `}`, and both ends of that span are deliberate.

    The first `{` skips a preamble ("Here is the post you asked for:") and also unwraps the
    `[{...}]` a model occasionally returns when it reads "an object" as "a result". The LAST
    `}` rather than the first is what keeps a body intact: a post about JavaScript is full of
    braces, and cutting at the first closing one truncates it inside the first code block.

    A span that does not parse is left to fail below rather than being nudged further - see
    the header on repair.
  */
  if (!candidate.startsWith('{')) {
    const start = candidate.indexOf('{')
    const end = candidate.lastIndexOf('}')
    if (start === -1 || end <= start)
      throw new LlmError('The model did not return a JSON object.', null)

    candidate = candidate.slice(start, end + 1)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(candidate)
  } catch {
    throw new LlmError(
      'The model returned malformed JSON - usually a post that ran past the token limit. Try a shorter length.',
      null
    )
  }

  // `Array.isArray` is not checked here and does not need to be: the span above always
  // begins at a `{`, so a top-level array has already been unwrapped to its first object.
  if (!parsed || typeof parsed !== 'object')
    throw new LlmError('The model returned JSON that was not an object.', null)

  return parsed as Record<string, unknown>
}
