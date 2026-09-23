/**
 * Read a request body as JSON, bounded, without ever throwing.
 *
 * ```
 *   raw = await request.text()
 *        │
 *        ├─ Buffer.byteLength(raw) > maxBytes ──▶ { ok: false, 413 }
 *        │
 *        └─ JSON.parse(raw) ──┬─ throws ────────▶ { ok: false, 400 }
 *                             └─ value ─────────▶ { ok: true, body }
 * ```
 *
 * ## Why the cap is on the body and not on `Content-Length`
 *
 * `Content-Length` is a client-supplied header. It is *absent* on a chunked request and it
 * is a claim rather than a measurement on every other one, so a handler that trusts it
 * accepts an unbounded body from anyone who omits or lies about the header. `api/event`
 * still reads the header, and that is fine there - it guards a beacon whose real bound is
 * the idempotent `_id` - but it is not a bound, and the contact form has no second line of
 * defence behind it.
 *
 * `request.text()` does buffer the whole body before this function can measure it, so this
 * caps what reaches *our* code, not what reaches the process. The platform bound above it
 * (Vercel rejects request bodies over 4.5MB) is the one that stops a body from being read
 * at all. What this closes is the gap between that number and the few kilobytes any of
 * these routes can legitimately receive.
 *
 * ## Why the cap and the parse live in one function
 *
 * They were separate at three call sites and every one of them had re-derived the weak,
 * header-only version of the check. Splitting them again is how that comes back: the cap
 * is the boring half, so it is the half that gets copied wrong or left out. Callers get one
 * call and cannot obtain a parsed body without having paid for the bound.
 *
 * ## Why it returns a status instead of a `NextResponse`
 *
 * So the caller renders the error through `jsonError` like every other failure in the
 * codebase, and so this stays testable with a plain `Request` and no Next runtime.
 */

/** Plenty for every JSON body this site accepts. See the per-route constants below. */
const DEFAULT_MAX_BODY_BYTES = 16 * 1024

export type ReadJsonBodyResult<T> =
  | { ok: true; body: T }
  /** `error` is already safe to show a visitor - it never carries the parser's message. */
  | { ok: false; status: 400 | 413; error: string }

export async function readJsonBody<T = unknown>(
  request: Request,
  { maxBytes = DEFAULT_MAX_BODY_BYTES }: { maxBytes?: number } = {}
): Promise<ReadJsonBodyResult<T>> {
  let raw: string
  try {
    raw = await request.text()
  } catch {
    // A body that cannot even be read as text is a truncated or aborted upload, not
    // something the caller can fix by trying different JSON. Same 400 either way.
    return { ok: false, status: 400, error: 'Could not read request body' }
  }

  if (Buffer.byteLength(raw) > maxBytes)
    return { ok: false, status: 413, error: 'Payload too large' }

  try {
    return { ok: true, body: JSON.parse(raw) as T }
  } catch {
    // Never the parser's own message. `JSON.parse` echoes a slice of the input back in its
    // error text, which would reflect whatever a stranger posted into our response body.
    return { ok: false, status: 400, error: 'Invalid JSON body' }
  }
}

/**
 * The contact form, sized from its own field caps rather than guessed.
 *
 * The caps below sum to ~5.9k *characters*, and a character is not a byte: a Vietnamese
 * message is 2-3 bytes per character in UTF-8 and an emoji is 4, so a legitimate 5000
 * character message can be 15KB on the wire. 32KiB clears the worst realistic case with
 * room to spare and is still three orders of magnitude below the platform bound - which is
 * the whole point, since the field caps are what actually reject a long message, with an
 * error that says so.
 */
export const CONTACT_MAX_BODY_BYTES = 32 * 1024

/** `{ code, days }` - six digits and a small integer. Anything near this is not that. */
export const VERIFY_CODE_MAX_BODY_BYTES = 1024
