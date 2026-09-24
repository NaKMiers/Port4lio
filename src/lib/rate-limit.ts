import { RateLimitModel } from '@/models/RateLimit'

/**
 * Fixed-window rate limiting backed by Mongo.
 *
 * ```
 *   request ──▶ bucket key = route : ip : floor(now / window)
 *                    │
 *                    ▼
 *          findOneAndUpdate($inc count, upsert)   ◀── atomic, one round trip
 *                    │
 *          count > limit ? 429 : continue
 * ```
 *
 * Fixed window, not sliding: a caller can get up to 2x the limit across a window
 * boundary. That is a known and accepted property. The job here is to stop a script from
 * writing a hundred thousand documents into a database shared with the portfolio, not to
 * meter an API precisely, and a fixed window does that in one atomic operation with no
 * extra state.
 *
 * `$inc` with `upsert` is the whole concurrency story: two simultaneous requests cannot
 * both read 0 and both write 1, because neither reads at all.
 */

export type RateLimitResult = {
  ok: boolean
  /** Seconds until the current window ends. Sent as `Retry-After` on a 429. */
  retryAfterSeconds: number
}

export type RateLimitOptions = {
  /** Distinguishes routes so submitting a test does not consume the invite budget. */
  route: string
  limit: number
  windowSeconds: number
}

/**
 * Best-effort client IP.
 *
 * `x-forwarded-for` is client-controlled in general, but behind Vercel (and any sane
 * proxy) the platform overwrites it, and the leftmost entry is the real client. There is
 * no perfect answer here without a trusted-proxy config; an attacker who can forge it can
 * spread across buckets, which is why this is a volume guard and not an auth control.
 *
 * Takes anything with `headers.get`, so a server component can pass `{ headers: await
 * headers() }` - the shared whiteboard page limits itself the same way its API does.
 */
export function clientIpFrom(request: {
  headers: Pick<Headers, 'get'>
}): string | null {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }
  return request.headers.get('x-real-ip')?.trim() || null
}

export async function checkRateLimit(
  ip: string | null,
  { route, limit, windowSeconds }: RateLimitOptions
): Promise<RateLimitResult> {
  // No identifiable caller means no meaningful bucket. Collapsing everyone into a shared
  // 'unknown' key looks like rate limiting but throttles real visitors against each
  // other: ten strangers finishing the test in the same minute would 429 one another,
  // while an actual attacker just rotates headers. Fail open and say so, rather than
  // punish the users we can least identify.
  if (!ip) {
    console.warn(`[rate-limit] no client IP on ${route} - check skipped`)
    return { ok: true, retryAfterSeconds: 0 }
  }

  const nowMs = Date.now()
  const windowMs = windowSeconds * 1000
  const windowStart = Math.floor(nowMs / windowMs)
  const windowEndsAt = new Date((windowStart + 1) * windowMs)
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((windowEndsAt.getTime() - nowMs) / 1000)
  )

  try {
    const doc = await RateLimitModel.findByIdAndUpdate(
      `${route}:${ip}:${windowStart}`,
      { $inc: { count: 1 }, $setOnInsert: { expireAt: windowEndsAt } },
      { upsert: true, returnDocument: 'after', lean: true }
    )

    return { ok: (doc?.count ?? 1) <= limit, retryAfterSeconds }
  } catch (error) {
    // Fail OPEN, deliberately. This guards against volume, not against an attacker, and a
    // transient Mongo blip must not take down a free test that is the top of the funnel.
    // The trade is explicit: a database outage means no rate limiting for its duration.
    console.error('[rate-limit] check failed, allowing request', error)
    return { ok: true, retryAfterSeconds }
  }
}

/** Submitting a finished 60-question test. Generous: a real person cannot approach this. */
export const SUBMIT_LIMIT: RateLimitOptions = {
  route: 'mbti-submit',
  limit: 10,
  windowSeconds: 60,
}

/**
 * Starting a checkout. Tighter than submitting, because each one creates a payment link at
 * PayOS and burns an order code - so this is protecting a third-party quota, not just our
 * own database. A real buyer needs one, or two if they change their mind about the email.
 */
export const CHECKOUT_LIMIT: RateLimitOptions = {
  route: 'mbti-checkout',
  limit: 6,
  windowSeconds: 60,
}

/**
 * Polling for payment status. Deliberately loose: the client polls every 3 seconds while a
 * payment is in flight, and someone may have the page open in two tabs. Throttling this
 * would strand a buyer on a spinner after their money had already left.
 */
export const STATUS_LIMIT: RateLimitOptions = {
  route: 'payos-status',
  limit: 90,
  windowSeconds: 60,
}

/**
 * Measurement beacons. Loose, because a single honest visitor legitimately emits several:
 * one share, one attribution on landing, and a progress beacon on each tab switch away
 * from the test. Tight enough that a script cannot fill a database shared with the
 * portfolio.
 *
 * Worth being clear about what this does and does not protect. Writes here are already
 * idempotent - the subject is baked into the document `_id`, so a flood of repeats updates
 * one row rather than adding rows. This is a volume guard on the write path, not the thing
 * keeping the numbers honest; that job belongs to the `_id` and to `assertClientPostable`.
 */
export const EVENT_LIMIT: RateLimitOptions = {
  route: 'event',
  limit: 60,
  windowSeconds: 60,
}

/**
 * Starting an IQ test. Each call writes a row and starts a 24-minute clock, so this is the
 * one IQ endpoint a script could use to fill the collection. Tight, because a real person
 * starts one test, or a few if they abandon and come back.
 */
export const IQ_START_LIMIT: RateLimitOptions = {
  route: 'iq-start',
  limit: 8,
  windowSeconds: 60,
}

/**
 * Submitting a finished IQ test. Looser than starting: submit is idempotent, so a retry
 * after a flaky connection is a normal thing to do and must not be punished with a 429 on
 * work that took 24 minutes.
 */
export const IQ_SUBMIT_LIMIT: RateLimitOptions = {
  route: 'iq-submit',
  limit: 20,
  windowSeconds: 60,
}

/**
 * Saving CCA-F study progress. Behind the owner gate, so this is not protecting against
 * strangers - it is a ceiling on a debounced autosave that fires on every tick of a
 * checkbox. The client coalesces edits into one write per ~800ms; a burst of ticking is a
 * handful of writes, so 40 leaves room for an impatient session without letting a stuck
 * retry loop rewrite the same document hundreds of times a minute.
 */
export const CCAF_SAVE_LIMIT: RateLimitOptions = {
  route: 'ccaf-save',
  limit: 40,
  windowSeconds: 60,
}

/**
 * Writes through a whiteboard edit link (`/api/whiteboard/shared/<key>/*`) - the one canvas
 * write path with no owner gate in front of it.
 *
 * Far looser than the CCA-F save because a canvas is chatty by design: a drag is a bulk
 * move, every card edit is its own debounced PATCH, and an undo of a big delete replays one
 * create per card. 300 a minute is well past a person working fast and still stops a script
 * from filling the board, or the collection, at database speed. Reads have their own, looser
 * bucket below; the board's size is capped separately (SHARED_BOARD_MAX_ITEMS).
 */
export const WHITEBOARD_SHARE_WRITE_LIMIT: RateLimitOptions = {
  route: 'whiteboard-share-write',
  limit: 300,
  windowSeconds: 60,
}

/**
 * Reads through a whiteboard share link: the board stream and the vocab list. A page load
 * is one of each and a reload is two more, so 120 a minute never touches a person. It is
 * here because unlike a public page these are `force-dynamic` and `no-store` - every hit
 * streams the whole board out of Mongo, and an ink-heavy board is megabytes - so an
 * unbounded loop on one link would be a cheap way to load the database.
 */
export const WHITEBOARD_SHARE_READ_LIMIT: RateLimitOptions = {
  route: 'whiteboard-share-read',
  limit: 120,
  windowSeconds: 60,
}

/**
 * The contact form. The tightest bucket here, and the window is an hour rather than a
 * minute.
 *
 * Every other bucket protects a database. This one protects a *mailbox*: each accepted
 * submission sends a message with a visitor-controlled subject, body and `replyTo` from the
 * site's own Gmail account. The failure mode is not a large collection, it is the owner's
 * inbox buried under a relayed spam run and the sending account suspended for it - and
 * Gmail's own daily quota is the only thing behind this.
 *
 * Three per hour, because a real person sends one. Two if they realise they typoed their
 * email, and three is already generous for the third attempt nobody makes. A minute-long
 * window would be useless here: a script sending one message a minute for a day stays under
 * every limit above and still delivers 1440 emails.
 *
 * This is NOT the only bound on the mail path, and it must not be treated as one.
 * `checkRateLimit` fails open on a missing client IP and fails open on a Mongo error, so
 * both of the failure modes that make this bucket matter most are also the ones that switch
 * it off. `api/contact/route.ts` carries a second, process-local ceiling for exactly that
 * reason - see `claimMailBudget` there.
 */
/**
 * The blog editor's autosave, modelled on `CCAF_SAVE_LIMIT` above.
 *
 * Owner-only, so this is not an abuse control - `requireOwner` already refused everyone else
 * before the limiter is reached. What it bounds is our own editor misbehaving: a debounce
 * that stops debouncing, a retry loop on a failing save, a second tab left open on the same
 * draft. Each PATCH re-renders the markdown through Shiki and writes `bodyHtml`, so a runaway
 * client is not a cheap no-op write, it is real CPU per request.
 *
 * Generous on purpose. A person typing produces a save every few seconds at most, and 60 in
 * a minute is far above anything a human can cause, so a 429 here means something is broken
 * rather than someone being productive.
 */
/**
 * The public blog beacon. Anonymous, unauthenticated, and writing to Mongo.
 *
 * `api/event` - the test beacon - carries three volume controls and the first draft of this
 * feature copied only its two input-bounding rules. That gap is what this closes: without a
 * bucket, `POST /api/blog/event` is an unthrottled anonymous write, and the only thing
 * standing between it and an arbitrarily large collection is how fast a script can loop.
 *
 * 60 a minute is generous for a real reader, who fires one `view` per post and occasionally a
 * `share`. It is not generous for a script, and it is the only bound on the number the admin
 * board calls "unique readers" - which is why that number is documented as advisory rather
 * than as evidence. `sessionId` is client-chosen, so a determined caller can still spread
 * across sessions inside this limit; the kill criterion deliberately reads
 * `ContactMessage.sourceSlug` instead, which needs a human to have written a sentence.
 */
/**
 * Subscribing. Tight for the same reason `CONTACT_LIMIT` is: it sends mail.
 *
 * Each accepted submission emails a confirmation to an address the submitter typed, which
 * means an unthrottled endpoint is a way to send our mail to somebody else's inbox - the
 * classic double-opt-in abuse, where the confirmation email itself becomes the payload.
 * Three an hour per IP, and the unique index on email means a repeat for an address already
 * on the list does not send anything at all.
 */
export const SUBSCRIBE_LIMIT: RateLimitOptions = {
  route: 'blog-subscribe',
  limit: 3,
  windowSeconds: 60 * 60,
}

export const BLOG_EVENT_LIMIT: RateLimitOptions = {
  route: 'blog-event',
  limit: 60,
  windowSeconds: 60,
}

export const BLOG_SAVE_LIMIT: RateLimitOptions = {
  route: 'blog-save',
  limit: 60,
  windowSeconds: 60,
}

/**
 * Generating a post with an LLM. Two orders of magnitude tighter than `BLOG_SAVE_LIMIT`, and
 * it is guarding a different thing entirely.
 *
 * `requireOwner` already refused everyone else, so this is not an abuse control either - but
 * unlike a save, one accepted request here spends real money at a third party and occupies a
 * lambda for up to three minutes. The failure it bounds is a double-click on a button whose
 * work takes 40 seconds and shows nothing for the first five: the natural response to that is
 * to press it again, and without a bucket that is two posts generated and two bills.
 *
 * Ten in ten minutes is far above deliberate use - a generated post takes longer to READ than
 * that - and low enough that a stuck retry loop costs a few requests rather than a few
 * hundred. The window is long rather than per-minute for the same reason `CONTACT_LIMIT`'s
 * is: a loop that fires once a minute stays under every short window and still runs all day.
 */
export const BLOG_GENERATE_LIMIT: RateLimitOptions = {
  route: 'blog-generate',
  limit: 10,
  windowSeconds: 10 * 60,
}

/**
 * Rewriting one image prompt. Its own bucket, deliberately not `BLOG_GENERATE_LIMIT`.
 *
 * Sharing that bucket was the obvious move and is the wrong one: a post with four placeholders
 * invites four regenerates while the author reads the results, and at ten per ten minutes
 * that is most of the allowance for writing an actual post spent on captions for pictures
 * that do not exist yet. The two calls also cost different amounts - a prompt is a sentence,
 * a post is two thousand words - so one limit priced for both is priced wrong for one.
 *
 * Forty in ten minutes: generous for a person clicking regenerate until a prompt reads well,
 * and still a ceiling if a button ends up wired to a render loop.
 */
export const BLOG_IMAGE_PROMPT_LIMIT: RateLimitOptions = {
  route: 'blog-image-prompt',
  limit: 40,
  windowSeconds: 10 * 60,
}

/**
 * Generating an image. Its own bucket, and priced like `BLOG_GENERATE_LIMIT` rather than
 * `BLOG_IMAGE_PROMPT_LIMIT` - a prompt rewrite is a sentence from the router, this is an image
 * from a model call that costs and takes roughly what writing the post itself does.
 *
 * ## Why thirty and not the ten it used to be
 *
 * The number was chosen when every image was one deliberate button press in the editor, where
 * ten in ten minutes is generous. `GenerateBlogDialog`'s "make every image, then publish"
 * switch made that assumption false: one press is now up to five calls in sequence - a cover
 * plus four body placeholders on a long post - so the old ceiling let TWO posts through a
 * window and then failed the third one halfway, leaving a half-illustrated post and a warning
 * list. A limit that a feature's normal use hits is a limit that only ever fires on the
 * honest user.
 *
 * Thirty is six full posts per window, which is well past any real session, and the worst case
 * it permits is about $2 of Gemini 3.1 Flash or $4 of 3 Pro behind an owner-only gate. The
 * limiter here is a runaway-loop guard, not a budget - the budget is the switch, which is off
 * by default and prices itself on its own label.
 */
export const BLOG_GENERATE_IMAGE_LIMIT: RateLimitOptions = {
  route: 'blog-generate-image',
  limit: 30,
  windowSeconds: 10 * 60,
}

/** Fetching a remote image into Cloudinary storage. Priced like `BLOG_GENERATE_IMAGE_LIMIT`. */
export const CLOUDINARY_UPLOAD_LIMIT: RateLimitOptions = {
  route: 'cloudinary-upload',
  limit: 30,
  windowSeconds: 10 * 60,
}

/** Deleting a Cloudinary asset is irreversible, so its bucket is tighter than the upload one. */
export const CLOUDINARY_DELETE_LIMIT: RateLimitOptions = {
  route: 'cloudinary-delete',
  limit: 15,
  windowSeconds: 10 * 60,
}

/**
 * The daily blog cron, and this is where "1 blog/day" is actually enforced.
 *
 * NOT the schedule. Vercel's own cron docs are explicit that delivery is best effort and that
 * "cron delivery can also occasionally invoke the same scheduled run more than once" - they
 * recommend a lock for exactly this, and this is that lock. (They do NOT retry a failed
 * invocation, which was the wrong reason an earlier version of this comment gave. The right
 * one is duplicate delivery, plus the second case Vercel names: a job that runs longer than
 * its own interval can have a second instance started while the first is still going.)
 *
 * The limiter catches that where a "has a post been created today?" query cannot, because it
 * increments BEFORE the work starts rather than after it finishes. A duplicate delivery sixty
 * seconds in is refused by a counter that is already at 1, with the first post still unsaved.
 *
 * A MISSED run is the other half of best-effort delivery and needs nothing: a day with no post
 * is a day with no post, and tomorrow's run is unaffected.
 *
 * `windowSeconds` is a whole day and the window is fixed and aligned to the epoch, so buckets
 * begin at 00:00 UTC. The documented fixed-window property - up to 2x across a boundary - can
 * only fire here for a run scheduled within minutes of UTC midnight, which is the one time of
 * day not to schedule it. See the workflow in `docs/blog/generate-daily.yml`.
 */
export const BLOG_CRON_LIMIT: RateLimitOptions = {
  route: 'blog-cron',
  limit: 10,
  windowSeconds: 24 * 60 * 60,
}

export const CONTACT_LIMIT: RateLimitOptions = {
  route: 'contact',
  limit: 3,
  windowSeconds: 60 * 60,
}

/**
 * Every agent route, one bucket for all of them: `/api/mcp`, the `/api/whiteboard/mcp` alias
 * and `/api/whiteboard/context.md`. Keyed by client IP. (Renamed from
 * `WHITEBOARD_AGENT_LIMIT` when the MCP moved from the whiteboard to the whole site.)
 *
 * Checked BEFORE the bearer token is verified, so a stranger guessing tokens is throttled on
 * the same budget as a real agent - a failed guess still counts. 120 in 10 minutes is sized
 * for Claude Code answering one question with several tool calls in a row (overview, two
 * searches, a few reads, a draft), repeatedly, with room to spare.
 *
 * This is the front door only. What a single token may SPEND - images, image prompts, saves -
 * is a second set of buckets keyed `mcp-token:<id>` and checked per tool in `runTool`, reusing
 * `BLOG_GENERATE_IMAGE_LIMIT`, `BLOG_IMAGE_PROMPT_LIMIT` and `BLOG_SAVE_LIMIT` (mcp-plan.md
 * R5). Separate buckets, so a runaway agent never spends the owner's editor budget.
 *
 * Remember this limiter fails OPEN on a Mongo error. That is fine here only because the token
 * check behind it fails CLOSED: a database outage means no rate limit, and also no access.
 */
export const MCP_AGENT_LIMIT: RateLimitOptions = {
  route: 'mcp-agent',
  limit: 120,
  windowSeconds: 10 * 60,
}

/*
 * IQ checkout has no limit of its own: `/api/iq/checkout` uses `CHECKOUT_LIMIT` above.
 *
 * The limit exists to protect PayOS's order-code quota, which is per merchant account and
 * shared by both products - so one bucket covering both is the accurate model. Two separate
 * buckets would let an abuser spend twice the quota by alternating between them.
 */
