import { NextResponse, type NextRequest } from 'next/server'

import { jsonError } from '@/lib/api-response'
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n'
import { connectDatabase } from '@/lib/mongodb'
import {
  InvalidAnswersError,
  parseAnswers,
  scoreAttempt,
  type Answer,
  type ScoreResult,
} from '@/lib/mbti/scoring'
import { checkRateLimit, clientIpFrom, SUBMIT_LIMIT } from '@/lib/rate-limit'
import { isEffortWaiverEnabled, mbtiEffortWaived } from '@/lib/test-kit/effort'
import { FUNNEL_EVENTS, recordFunnelDetached } from '@/lib/test-events'
import { mintToken } from '@/lib/tokens'
import { AttemptModel, attemptExpiryFrom } from '@/models/Attempt'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** ~60 single-character answers plus JSON overhead. A megabyte of this is not a test result. */
const MAX_BODY_BYTES = 8 * 1024

/**
 * [POST] /api/mbti/submit
 *
 * Public and unauthenticated by design - the free test is the top of the funnel and
 * putting a login in front of it would kill the loop. That makes this one of only two
 * routes on the site where a stranger can write to the database, so the order below is
 * deliberate: cheap rejections first, database writes last.
 *
 * ```
 *   size cap ──▶ rate limit ──▶ parse JSON ──▶ validate answers ──▶ score ──▶ insert
 *      │             │              │               │                          │
 *     413           429            400             400                        201
 * ```
 */
export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (contentLength > MAX_BODY_BYTES) {
    return jsonError('Payload too large', 413)
  }

  await connectDatabase()

  const limit = await checkRateLimit(clientIpFrom(request), SUBMIT_LIMIT)
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonError('Invalid JSON body', 400)
  }

  const { answers: rawAnswers, locale: rawLocale } = (body ?? {}) as {
    answers?: unknown
    locale?: unknown
  }

  // Narrow through a named binding, not an inline expression: a type guard applied to
  // `isLocale(cond ? x : undefined)` refines the expression, NOT `x`, so `rawLocale` would
  // stay `unknown` and an arbitrary client string would reach the database.
  const localeCandidate = typeof rawLocale === 'string' ? rawLocale : undefined
  const locale: Locale = isLocale(localeCandidate) ? localeCandidate : DEFAULT_LOCALE

  let answers: Answer[]
  let result: ScoreResult
  try {
    answers = parseAnswers(rawAnswers)
    result = scoreAttempt(answers)
  } catch (error) {
    if (error instanceof InvalidAnswersError) {
      // The message names which answer was bad, which is useful to a developer and
      // harmless to a user - it describes their own submitted payload, nothing internal.
      return jsonError(error.message, 400)
    }
    throw error
  }

  const token = mintToken()

  /**
   * Decided here rather than at render, for the same reason IQ decides it at submit: the
   * result page and the checkout route must agree, and a later threshold change must not
   * retroactively charge someone already told their result was free.
   *
   * MBTI has no server-side clock, so this reads the answer pattern itself - which is the
   * signal that cannot be faked without ruining the result being asked for. See
   * `lib/test-kit/effort.ts`.
   *
   * `EFFORT_WAIVER=false` short-circuits the detector entirely, which stores `waived: false`
   * and sends even a held-down button to the paywall.
   */
  const waived = isEffortWaiverEnabled() && mbtiEffortWaived({ answers })

  try {
    await AttemptModel.create({
      _id: token,
      type: result.type,
      scores: result.scores,
      answers,
      waived,
      locale,
      createdAt: new Date(),
      expireAt: attemptExpiryFrom(new Date()),
    })
  } catch (error) {
    console.error('[mbti-submit] failed to persist attempt', error)
    return jsonError('Could not save your result. Please try again.', 500)
  }

  // Counted here rather than at render, because this is where the decision is made. IQ
  // does the same, so the two products' waiver rates are measured the same way - and a
  // waived unlock never touches `paid`, which is the counter revenue is read from.
  if (waived) {
    recordFunnelDetached('mbti', FUNNEL_EVENTS.waived)
  }

  /**
   * The token only - deliberately NOT the type.
   *
   * The result page decides what a taker may see, and it charges for the four letters. This
   * response used to carry `type` as well, which nothing ever read: `TestClient`
   * destructures `{ token }` and redirects. So it bought no behaviour and handed anyone with
   * the network tab open the exact answer the paywall is holding back.
   *
   * Keep it that way. Whatever a client needs about a result, it gets from the result page,
   * which is the one place that knows whether this attempt was paid for.
   */
  return NextResponse.json({ token }, { status: 201 })
}
