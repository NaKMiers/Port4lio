import { randomInt } from 'node:crypto'

import { NextResponse, type NextRequest } from 'next/server'

import { jsonError } from '@/lib/api-response'
import { DEFAULT_LOCALE, isLocale } from '@/lib/i18n'
import { generateTest, optionsFor } from '@/lib/iq/items/generate'
import { renderMatrix, renderOption } from '@/lib/iq/items/render'
import { TEST_DURATION_SECONDS } from '@/lib/iq/scoring'
import { connectDatabase } from '@/lib/mongodb'
import { checkRateLimit, clientIpFrom, IQ_START_LIMIT } from '@/lib/rate-limit'
import { mintToken } from '@/lib/tokens'
import { IqAttemptModel, iqAttemptExpiryFrom } from '@/models/IqAttempt'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * [POST] /api/iq/start
 *
 * Issues a test and starts the clock.
 *
 * ```
 *   rate limit ──▶ mint token + seed ──▶ insert { startedAt: SERVER now } ──▶ 201
 *        │                                        │
 *       429                          the clock the client cannot touch
 * ```
 *
 * ## Why the row exists before any answer does
 *
 * A 24-minute limit enforced by a client countdown is not a limit - anyone can pause it,
 * reload without it, or edit it. So the server writes `startedAt` when it hands out the
 * test, and `/api/iq/submit` compares against that. The client's timer becomes a display of
 * server truth rather than the source of it.
 *
 * MBTI does not need this and creates its row at submit instead; that asymmetry is the
 * timer, not an inconsistency.
 *
 * ## The seed is not returned
 *
 * The response carries the token and the rendered items, never the seed. The seed
 * regenerates the answer key (`lib/iq/items/generate.ts` is deterministic), so handing it
 * to the client would hand over the answers - the one thing the whole generated-item design
 * exists to keep server-side.
 */
export async function POST(request: NextRequest) {
  await connectDatabase()

  const limit = await checkRateLimit(clientIpFrom(request), IQ_START_LIMIT)
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
    )
  }

  let body: unknown = {}
  try {
    body = await request.json()
  } catch {
    // An empty body is fine here - locale is the only input and it has a default.
  }

  const rawLocale = (body as { locale?: unknown })?.locale
  const candidate = typeof rawLocale === 'string' ? rawLocale : undefined
  const locale = isLocale(candidate) ? candidate : DEFAULT_LOCALE

  const token = mintToken()
  /**
   * `randomInt`, not `Math.random()`.
   *
   * The seed regenerates the answer key, so it is a secret with the same job as the token
   * next to it - and `mintToken` has always used `crypto`. `Math.random()` is a
   * seeded PRNG whose internal state is recoverable from its outputs, which put the one
   * value this design keeps server-side on a weaker footing than the credential beside it.
   * Nothing observable changes; 2^31 still keeps the seed in the range mulberry32 mixes
   * well and inside a Mongo int.
   */
  const seed = randomInt(2 ** 31)
  const startedAt = new Date()

  try {
    await IqAttemptModel.create({
      _id: token,
      seed,
      locale,
      startedAt,
      createdAt: startedAt,
      expireAt: iqAttemptExpiryFrom(startedAt),
    })
  } catch (error) {
    console.error('[iq-start] failed to create attempt', error)
    return jsonError('Could not start the test', 500)
  }

  /**
   * The items are rendered HERE, from the seed that was just stored.
   *
   * This is the whole reason `/api/iq/start` returns questions instead of the page
   * rendering its own: the answer key at submit is derived from `attempt.seed`, so anything
   * the taker actually sees must come from that same seed. An earlier version had the page
   * generate its own display seed and the API mint a separate scoring seed - the taker
   * would have answered one test and been scored against another, producing a number that
   * looked plausible and meant nothing.
   *
   * Rendered to SVG strings rather than sent as specs, so the response never contains
   * enough to recompute the answer.
   */
  const items = generateTest(seed)
  const questions = items.map((item, index) => ({
    matrix: renderMatrix(item, `${index + 1} / ${items.length}`),
    options: optionsFor(item, seed, index).map((option, optionIndex) =>
      renderOption(option, `q${index}o${optionIndex}`)
    ),
  }))

  return NextResponse.json(
    {
      token,
      startedAt: startedAt.toISOString(),
      durationSeconds: TEST_DURATION_SECONDS,
      questions,
    },
    { status: 201 }
  )
}
