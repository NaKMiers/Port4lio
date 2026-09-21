import 'server-only'

import { getRequiredEnv } from '@/lib/required-env'

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

  constructor(message: string, status: number | null = null) {
    super(message)
    this.name = 'LlmError'
    this.status = status
  }
}

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

export async function chatCompletion({
  model,
  messages,
  temperature,
  maxTokens,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: {
  model: string
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
  timeoutMs?: number
}): Promise<ChatResult> {
  const apiKey = getRequiredEnv('LLM_API_KEY')

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
        null
      )

    // Deliberately not `String(error)`: a fetch failure can carry the URL, and the URL is a
    // private tailnet host.
    console.error('[blog/llm] request failed', error)
    throw new LlmError('Could not reach the model endpoint.', null)
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
        response.status
      )

    if (response.status === 429)
      throw new LlmError(
        'The model endpoint is rate limiting us. Try again shortly.',
        429
      )

    throw new LlmError(
      `The model endpoint returned ${response.status}.`,
      response.status
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
