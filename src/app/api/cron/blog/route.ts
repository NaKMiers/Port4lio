import { timingSafeEqual } from 'node:crypto'

import { NextResponse, type NextRequest } from 'next/server'

import { jsonError } from '@/lib/api-response'
import { RECENT_TITLE_LIMIT, sampleCronSpec } from '@/lib/blog/cron-spec'
import { GenerationRunError, runGeneration } from '@/lib/blog/generate-run'
import {
  IMAGE_MODEL_OPTIONS,
  normaliseSpec,
} from '@/lib/blog/generation-fields'
import { illustratePost } from '@/lib/blog/illustrate-run'
import { listKinds } from '@/lib/blog/kind-data'
import { listSeries } from '@/lib/blog/series-data'
import { connectDatabase } from '@/lib/mongodb'
import { BLOG_CRON_LIMIT, checkRateLimit } from '@/lib/rate-limit'
import { PostModel } from '@/models/Post'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 300, which is the Vercel Pro ceiling and NOT a number this route would have chosen.
 *
 * The budget it actually wants is about 420s: a generation runs to 180s (`DEFAULT_TIMEOUT_MS`
 * in `llm.ts`) and one image runs to 120s (`DEFAULT_TIMEOUT_MS` in `image-gen.ts`), so a note
 * with a cover and one body image is 420s of worst case before anything has gone wrong.
 *
 * ## Why it is a hardcoded 300 rather than the ceiling of whatever plan this runs on
 *
 * Because the platform REFUSES the build rather than clamping. This said 800 - the Fluid
 * compute ceiling - on the assumption that a smaller plan would cap it silently and the route
 * would degrade into the smaller budget. It does not:
 *
 *   Builder returned invalid maxDuration value for Serverless Function "api/cron/blog".
 *   Serverless Functions must have a maxDuration between 1 and 300 for plan pro.
 *
 * So the value has to be one every target plan accepts, and 300 is the highest that is. Raise
 * it only alongside a plan that takes it, and expect a failed deploy rather than a slow one if
 * the two ever disagree again.
 *
 * ## What the smaller budget actually costs
 *
 * Images, and only images. The deadline below is a fraction of THIS number, and every timeout
 * in `illustratePost` is derived from the time left rather than fixed, so nothing here runs
 * past the wall - it just fits fewer pictures in. A slow generation can leave under a minute
 * of image budget, and a run that draws no cover stays archived, because `publishBlockers`
 * refuses to publish a post with no `og:image`.
 *
 * That is the honest degradation and it was already the design: the post is SAVED before the
 * first image is drawn, `illustratePost` saves again after every one, and `planIllustration`
 * orders the cover first precisely so the picture that survives a short run is the one
 * publishing depends on. A run that runs out of budget leaves an archived post with its
 * prompts and whatever pictures it got, which is the same outcome this route produces when an
 * image simply fails. The morning after is a post on the board with a card to press, not a
 * blank board.
 */
export const maxDuration = 300

/**
 * When to stop STARTING images, as a fraction of the budget above.
 *
 * `illustratePost` needs the tail of the request to decide `published` vs `archived` and to
 * write it. Being killed mid-image loses that decision, so the loop is told to stop well
 * before the wall and let the run finish cleanly.
 */
const IMAGE_DEADLINE_RATIO = 0.85

/**
 * The image model the cron uses, and it is not configurable.
 *
 * The cheaper of the two, deliberately. An unattended job that runs every day for a year is
 * the one place a per-image price difference compounds into real money, and nobody is there
 * to have picked the expensive one on purpose. The editor still offers both.
 */
const CRON_IMAGE_MODEL = IMAGE_MODEL_OPTIONS[0].value

/**
 * [POST] /api/cron/blog - write one post a day, illustrate it, and publish it if it is whole.
 *
 * ```
 *   Authorization: Bearer $CRON_SECRET  ──▶ 401       timing-safe, no owner cookie involved
 *        ▼
 *   checkRateLimit(BLOG_CRON_LIMIT)     ──▶ 429       1 per UTC day: this is "1 blog/day"
 *        ▼
 *   sampleCronSpec(kinds, series, recent titles)      a different post every morning
 *        ▼
 *   runGeneration       ──▶ post SAVED as archived, with its image prompts written
 *        ▼
 *   illustratePost      ──▶ cover + body images, one save each, on a deadline
 *        │                     any failure ──▶ skip it, keep the prompt, keep going
 *        ▼
 *   whole?  yes ──▶ published        no ──▶ stays archived, reasons in the response
 * ```
 *
 * ## Why this is not under `/api/admin`
 *
 * Everything there starts with `requireOwner`, which checks an HMAC-signed cookie set by an
 * OTP emailed to the owner. A cron has no mailbox. Rather than teach the owner gate a second
 * credential type - which would mean every admin route silently gaining a machine-usable key -
 * this route lives outside it and carries the one secret that opens the one thing it does.
 *
 * ## Why the post is saved before a single image is drawn
 *
 * It is what makes every failure below survivable. `runGeneration` returns a document that is
 * already in the database, so a refused image, an expired budget or a platform timeout all
 * land on a post that exists, is archived, and carries the prompts needed to finish it by
 * hand. The alternative - hold the draft in memory until it is complete - turns one failed
 * image into a lost model call and a morning with nothing on the board.
 *
 * ## Why it publishes at all
 *
 * Because the alternative, for a daily job, is a board that grows by one archived post a day
 * and a blog that never updates. The bar it has to clear is `publishBlockers`: a title, a
 * body, a cover, and no placeholder left over. Nothing half-made goes public - and on the days
 * it does not clear, the post is waiting in the editor with exactly the tasks it needs.
 */
/**
 * Both verbs, one handler, because the two schedulers disagree about which to send.
 *
 * Vercel Cron issues a GET and offers no way to change that; GitHub Actions sends whatever the
 * `curl` line says. Exporting one and not the other means the job silently 405s on one of the
 * two platforms - a scheduled task that never runs and never complains, which is the failure
 * that goes unnoticed longest.
 *
 * A GET that writes to the database is the thing this would normally be worth refusing over.
 * It is safe here for reasons that are specific and worth naming rather than assumed: the
 * route is `force-dynamic` so nothing caches it, it 404s without a bearer token so no
 * prefetcher or crawler can reach the work, and the once-a-day limiter means even a caller
 * holding the secret cannot make it run twice.
 */
export const GET = handle
export const POST = handle

async function handle(request: NextRequest) {
  const denied = requireCronSecret(request)
  if (denied) return denied

  // connectDatabase before the limiter, because `checkRateLimit` writes its counter to Mongo
  // and fails OPEN on error - a limiter above the connect waves everything through on a cold
  // invocation while looking like it is throttling. Same ordering as every other route.
  try {
    await connectDatabase()
  } catch (error) {
    console.error('[api/cron/blog] database unreachable', error)
    return jsonError('Unable to reach the database right now.', 503)
  }

  /*
    A constant bucket key, not the caller's IP.

    `clientIpFrom` is right everywhere else in this repo, where the question is "is this
    visitor abusing us" and a per-visitor bucket is the answer. Here the question is "has today
    already had its post", which is a property of the BLOG - and an IP-keyed bucket answers it
    wrong in exactly the way that matters, because a scheduler's egress IP changes between
    retries and each new address arrives with a fresh allowance.
  */
  const limit = await checkRateLimit('daily', BLOG_CRON_LIMIT)
  if (!limit.ok)
    return NextResponse.json(
      {
        skipped: 'already-ran',
        error: 'A post has already been generated in this window.',
      },
      {
        status: 429,
        headers: { 'Retry-After': String(limit.retryAfterSeconds) },
      }
    )

  const startedAt = Date.now()

  let sample
  try {
    const [kinds, series, recent] = await Promise.all([
      listKinds(),
      listSeries(),
      /*
        EVERY status, not `published` - which is the whole reason this list is gathered here
        rather than reused from the generation context.

        `runGeneration` already sends the model up to forty published posts as
        `relatedCandidates`. A cron post is archived until the owner reads it, so on day two
        that list does not contain day one, and by day thirty it contains nothing this job has
        ever written. The model would then be avoiding repetition against a set its own output
        never joins.
      */
      PostModel.find({ status: { $ne: 'deleted' } })
        .select('title')
        .sort({ createdAt: -1 })
        .limit(RECENT_TITLE_LIMIT)
        .lean(),
    ])

    if (kinds.length === 0)
      return jsonError('No post kinds exist. Nothing can be generated.', 409)

    sample = sampleCronSpec({
      kinds: kinds.map(kind => kind.slug),
      series: series.map(entry => entry.slug),
      recentTitles: recent.map(post => post.title),
    })
  } catch (error) {
    console.error('[api/cron/blog] could not build a brief', error)
    return jsonError('Could not read the taxonomies.', 500)
  }

  /*
    Through `normaliseSpec`, even though this process just built the spec itself.

    It looks redundant and it is the cheapest possible regression test for the sampler. Every
    value in `CRON_ANGLES` is a string that has to exist in an option list in
    `generation-fields.ts`, and nothing about `structure: 'claim-first'` - a value that was in
    an early draft of that table and has never existed in `STRUCTURE_OPTIONS` - is a type
    error. Normalising drops it and puts it in `dropped`, so a stale angle shows up in the
    response as a named warning instead of as a post that quietly ignored its own brief.
  */
  const { spec, dropped } = normaliseSpec(sample.spec)
  const warnings = [...dropped]

  let run
  try {
    run = await runGeneration({ spec, warnings })
  } catch (error) {
    if (error instanceof GenerationRunError) {
      console.error(`[api/cron/blog] generation failed: ${error.message}`)
      return jsonError(error.message, error.status)
    }

    console.error('[api/cron/blog] unexpected generation failure', error)
    return jsonError('The post could not be generated.', 500)
  }

  const post = run.post

  const illustration = await illustratePost(post, {
    model: CRON_IMAGE_MODEL,
    deadlineAt: startedAt + maxDuration * 1000 * IMAGE_DEADLINE_RATIO,
  })

  const result = {
    id: String(post._id),
    slug: post.slug,
    title: post.title,
    status: post.status,
    published: illustration.published,
    angle: sample.angle,
    model: run.model,
    imagesMade: illustration.imagesMade,
    imagesSkipped: illustration.imagesSkipped,
    blockers: illustration.blockers,
    warnings: [...run.warnings, ...illustration.warnings],
    seconds: Math.round((Date.now() - startedAt) / 1000),
  }

  // One structured line per run. This endpoint answers to a scheduler that keeps nothing but
  // a status code, so the log is the only place the outcome is legible afterwards - which
  // angle was drawn matters most, because "the variety broke" is otherwise invisible for weeks.
  console.info('[api/cron/blog]', JSON.stringify(result))

  return NextResponse.json(result, { status: 201 })
}

/**
 * The gate, and a `!==` here would be a real vulnerability rather than a style note.
 *
 * String comparison in JS short-circuits at the first differing byte, so how long it takes to
 * fail leaks how many leading bytes were right - and this endpoint can be called as often as
 * an attacker likes, which is exactly the condition that turns a few nanoseconds into a
 * recoverable secret. `timingSafeEqual` compares every byte whatever happens.
 *
 * It needs equal lengths, so the length check comes first - and that check leaks the length,
 * which is not a secret worth protecting and cannot be hidden without hashing both sides.
 *
 * `Authorization: Bearer <secret>` is the shape Vercel Cron sends `CRON_SECRET` in, so a
 * Vercel-scheduled invocation authenticates with no extra configuration.
 */
function requireCronSecret(request: NextRequest): NextResponse | null {
  const expected = process.env.CRON_SECRET?.trim()

  /*
    A missing secret is a REFUSAL, never a wave-through.

    The opposite default is the classic version of this bug: an unset variable on a fresh
    deployment leaves a public endpoint that writes to the database and publishes to the live
    site, and it looks completely healthy until somebody finds it.
  */
  if (!expected) {
    console.error('[api/cron/blog] CRON_SECRET is not set - refusing')
    return jsonError('Not found.', 404)
  }

  const header = request.headers.get('authorization') ?? ''
  const offered = header.startsWith('Bearer ') ? header.slice(7).trim() : ''

  const a = Buffer.from(offered)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b))
    // 404 rather than 401, so an unauthenticated caller cannot confirm the route exists.
    return jsonError('Not found.', 404)

  return null
}
