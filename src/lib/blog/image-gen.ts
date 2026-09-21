import 'server-only'

/**
 * Cover-image generation, direct against Google's Generative Language API.
 *
 * ```
 *   generateImage({ prompt, model })
 *          │
 *          │  POST <GOOGLE_API_BASE_URL>/models/<model>:generateContent
 *          │  x-goog-api-key: $GOOGLE_API_KEY          ← header, never ?key=, see llm.ts
 *          │  { contents: [{ role: 'user', parts: [{ text: prompt }] }] }
 *          ▼
 *   { candidates: [ { content: { parts: [ { inlineData: { mimeType, data } } ] } } ] }
 *          │
 *          └──▶ { base64, mimeType, model }
 * ```
 *
 * `chatCompletion` in `llm.ts` has no image path - the router it speaks to "has no image
 * model" (see the comment on `Post.coverImagePrompt`) - so this calls Gemini directly rather
 * than adding an image branch to that file's very different response shape (chat text vs.
 * inline image bytes). It reuses `GOOGLE_API_KEY` and `GOOGLE_API_BASE_URL`, the same env vars
 * `llm.ts`'s text fallback already reads, rather than asking for a second key.
 *
 * ## The shape below was measured, not guessed
 *
 * Same discipline `llm.ts` documents for its own Gemini fallback. `GET /v1beta/models` on this
 * project's key lists `gemini-3.1-flash-image` and `gemini-3-pro-image` (`IMAGE_MODEL_OPTIONS`
 * in `generation-fields.ts`) with `generateContent` as a supported method - not a separate
 * `:generateImage` or `:predict` endpoint - and a live call against both returned
 * `candidates[0].content.parts[0].inlineData` holding `{ mimeType: "image/jpeg", data }`, `data`
 * being the image as base64. No `text` part is present on a pure image reply.
 */

const DEFAULT_GEMINI_BASE_URL =
  'https://generativelanguage.googleapis.com/v1beta'

/**
 * 45s used to be enough for one `generateContent` round trip - shorter than a post's model
 * call, longer than a prompt rewrite's - but image generation itself is the slow part here,
 * not the request/response plumbing, and it measurably ran past 45s on real prompts. 2 minutes
 * gives the model room to actually finish instead of the route timing out on work that was
 * still in progress.
 */
const DEFAULT_TIMEOUT_MS = 120_000

/** Thrown for every failure mode, with a message already safe to show the owner. */
export class ImageGenError extends Error {
  readonly status: number | null

  constructor(message: string, status: number | null = null) {
    super(message)
    this.name = 'ImageGenError'
    this.status = status
  }
}

export type GeneratedImage = {
  /** The image bytes, base64-encoded - Gemini's own wire format, passed through untouched. */
  base64: string
  mimeType: string
  /** The model that actually answered, which `generateImage`'s caller chose but does not verify. */
  model: string
}

export async function generateImage({
  prompt,
  model,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: {
  prompt: string
  model: string
  timeoutMs?: number
}): Promise<GeneratedImage> {
  const apiKey = process.env.GOOGLE_API_KEY?.trim()
  if (!apiKey) throw new ImageGenError('GOOGLE_API_KEY is not set.', null)

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
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
      }),
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError')
      throw new ImageGenError(
        `The image model did not answer within ${Math.round(timeoutMs / 1000)}s.`,
        null
      )

    // Deliberately not `String(error)` - see the matching note in `llm.ts`.
    console.error('[blog/image-gen] request failed', error)
    throw new ImageGenError('Could not reach the image model.', null)
  }

  const raw = await response.text()

  if (!response.ok) {
    console.error(`[blog/image-gen] ${response.status}`, raw.slice(0, 300))

    if (response.status === 401 || response.status === 403)
      throw new ImageGenError(
        'Gemini refused our key. Check GOOGLE_API_KEY.',
        response.status
      )

    if (response.status === 429)
      throw new ImageGenError('Gemini is rate limiting us.', 429)

    if (response.status === 404)
      throw new ImageGenError(
        `Gemini has no image model called "${model}".`,
        404
      )

    throw new ImageGenError(
      `Gemini returned ${response.status}.`,
      response.status
    )
  }

  let payload: {
    modelVersion?: unknown
    candidates?: {
      finishReason?: unknown
      content?: {
        parts?: { inlineData?: { data?: unknown; mimeType?: unknown } }[]
      }
    }[]
  }
  try {
    payload = JSON.parse(raw)
  } catch {
    console.error('[blog/image-gen] unparseable body', raw.slice(0, 300))
    throw new ImageGenError(
      'Gemini returned something that was not JSON.',
      null
    )
  }

  const candidate = payload.candidates?.[0]
  const part = candidate?.content?.parts?.find(
    item => typeof item.inlineData?.data === 'string'
  )
  const data = part?.inlineData?.data
  const mimeType = part?.inlineData?.mimeType

  if (typeof data !== 'string' || !data || typeof mimeType !== 'string')
    throw new ImageGenError(
      candidate?.finishReason && candidate.finishReason !== 'STOP'
        ? `Gemini returned no image and gave "${String(candidate.finishReason)}" as the reason.`
        : 'Gemini returned no image.',
      null
    )

  return {
    base64: data,
    mimeType,
    model:
      typeof payload.modelVersion === 'string' ? payload.modelVersion : model,
  }
}
