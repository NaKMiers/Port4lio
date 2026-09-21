import { NextResponse, type NextRequest } from 'next/server'

import { jsonError } from '@/lib/api-response'
import { answerKeyFor } from '@/lib/iq/items'
import {
  InvalidIqAnswersError,
  parseIqAnswers,
  scoreIq,
  withinTimeLimit,
} from '@/lib/iq/scoring'
import { connectDatabase } from '@/lib/mongodb'
import { checkRateLimit, clientIpFrom, IQ_SUBMIT_LIMIT } from '@/lib/rate-limit'
import { iqEffortWaived, isEffortWaiverEnabled } from '@/lib/test-kit/effort'
import { FUNNEL_EVENTS, recordFunnelDetached } from '@/lib/test-events'
import { isTokenShaped } from '@/lib/tokens'
import { IqAttemptModel } from '@/models/IqAttempt'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 26 small integers plus JSON overhead. */
const MAX_BODY_BYTES = 4 * 1024

/**
 * [POST] /api/iq/submit
 *
 * ```
 *   size ─▶ rate limit ─▶ token shape ─▶ load ─▶ already submitted? ─▶ clock ─▶ score
 *     │         │              │           │            │               │         │
 *    413       429            400         404          200             403       200
 * ```
 *
 * ## The answer key is recomputed, never stored
 *
 * `answerKeyFor(seed, version)` is deterministic, so the correct answers are derived here
 * from the seed on the attempt row. Nothing in the database is an answer key, which means
 * there is no key to leak - and a taker who somehow read their own row still only has two
 * numbers. The version is the second half of that key: a seed identifies a test only in
 * combination with the generator that built it.
 *
 * ## Idempotent by design
 *
 * A double-tap on submit, or a retry after a flaky connection, must not rescore. The first
 * submission wins and later ones return the same result rather than an error: the taker did
 * nothing wrong, and an error here would look like their work was lost.
 */
export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (contentLength > MAX_BODY_BYTES) return jsonError('Payload too large', 413)

  await connectDatabase()

  const limit = await checkRateLimit(clientIpFrom(request), IQ_SUBMIT_LIMIT)
  if (!limit.ok)
    return NextResponse.json(
      { error: 'Too many requests' },
      {
        status: 429,
        headers: { 'Retry-After': String(limit.retryAfterSeconds) },
      }
    )

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonError('Invalid JSON body', 400)
  }

  const { token, answers: rawAnswers } = (body ?? {}) as {
    token?: unknown
    answers?: unknown
  }

  // Shape check before the query, so a garbage segment never becomes a database round trip.
  if (typeof token !== 'string' || !isTokenShaped(token))
    return jsonError('Invalid token', 400)

  let answers: number[]
  try {
    answers = parseIqAnswers(rawAnswers)
  } catch (error) {
    if (error instanceof InvalidIqAnswersError)
      return jsonError(error.message, 400)
    throw error
  }

  const attempt = await IqAttemptModel.findById(token)
  if (!attempt) return jsonError('Not found', 404)

  // Already scored: return what we have. See the idempotency note above.
  if (attempt.submittedAt)
    return NextResponse.json({
      token,
      raw: attempt.raw,
      score: attempt.score,
      percentile: attempt.percentile,
      band: attempt.band,
      alreadySubmitted: true,
    })

  const now = new Date()
  if (!withinTimeLimit(attempt.startedAt, now))
    // Deliberately not scored. Accepting a late submission would make the clock advisory,
    // and the clock is the only thing that makes scores comparable between takers.
    return jsonError('Time limit exceeded', 403)

  /**
   * Scored with the generator this attempt was BUILT by, not the current one.
   *
   * `?? 1` rather than trusting the schema default: this route also reads documents back
   * through `findOneAndUpdate({ lean: true })`, and `lean` skips Mongoose hydration, so a
   * row written before the field existed comes back with it genuinely absent. Every such
   * row is version 1 by definition, which is why no backfill is needed.
   */
  const answerKey = answerKeyFor(attempt.seed, attempt.generatorVersion ?? 1)
  const result = scoreIq(answers, answerKey)

  /**
   * Decided here, once, and stored.
   *
   * Not recomputed at render: the result page, the checkout route and any later audit have
   * to agree about whether this attempt is free, and a threshold edit must never start
   * charging someone who has already been told theirs was waived.
   *
   * `EFFORT_WAIVER=false` short-circuits the detector entirely, which stores `waived: false`
   * and sends even a ninety-second guess to the paywall.
   */
  const waived =
    isEffortWaiverEnabled() &&
    iqEffortWaived({
      raw: result.raw,
      answers,
      startedAt: attempt.startedAt,
      submittedAt: now,
    })

  /**
   * The claim is atomic, and `submittedAt: null` in the FILTER is what makes it so.
   *
   * The check above is a fast path, not a guard: two submissions in flight together both
   * read a null `submittedAt`, both score, and with a read-then-`save()` both would write -
   * last one wins, and the waived counter would fire twice for one attempt. Putting the
   * condition in the filter means the database decides, and exactly one caller wins.
   *
   * This is the same shape `payos-fulfil.ts` and `iq/fulfil.ts` use to claim a payment, for
   * the same reason. A double-tapped submit is far more common than a double webhook.
   */
  const claimed = await IqAttemptModel.findOneAndUpdate(
    { _id: token, submittedAt: null },
    {
      $set: {
        answers,
        submittedAt: now,
        raw: result.raw,
        score: result.score,
        percentile: result.percentile,
        band: result.band,
        waived,
      },
    },
    { new: true, lean: true }
  )

  if (!claimed) {
    // Lost the race. Whoever won stored a result for these same answers; return theirs
    // rather than an error, because from the taker's side nothing went wrong.
    const settled = await IqAttemptModel.findById(token).lean()
    return NextResponse.json({
      token,
      raw: settled?.raw ?? result.raw,
      total: result.total,
      score: settled?.score ?? result.score,
      percentile: settled?.percentile ?? result.percentile,
      band: settled?.band ?? result.band,
      alreadySubmitted: true,
    })
  }

  // `result-viewed` belongs to the result PAGE, which fires it on render - counting it here
  // as well double-counted every IQ attempt and halved every rate measured against it.
  //
  // Inside the claim, so a lost race counts nothing.
  if (waived) recordFunnelDetached('iq', FUNNEL_EVENTS.waived)

  return NextResponse.json({
    token,
    raw: result.raw,
    total: result.total,
    score: result.score,
    percentile: result.percentile,
    band: result.band,
  })
}
