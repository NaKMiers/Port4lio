import { ITEM_COUNT } from '@/lib/iq/items/generate'

/**
 * Raw correct answers to a score band.
 *
 * ```
 *   answers[] ──▶ count correct ──▶ band lookup ──▶ { raw, score, band, percentile }
 * ```
 *
 * ## This is a band mapping, NOT an ability estimate
 *
 * The honest version of this function is smaller than it could be. A real IQ instrument
 * fits item parameters against a calibration sample and estimates ability from the response
 * pattern. There is no sample here, so any such number would be theatre with a decimal
 * point on it.
 *
 * What the raw total does support is an ordering, because the 26 items sit on a rising
 * ladder: later rungs allow rules that need two or three dimensions tracked at once, so
 * getting item 24 right genuinely is harder than item 2. Mapping that total onto the
 * conventional mean-100 / SD-15 scale is a presentational convention, and `/[lang]/iq/method`
 * says so in those words rather than implying a precision that does not exist.
 *
 * The anchor is published Raven-style difficulty norms, not local data. That is stated as
 * provisional and is the single thing that should change once real takers exist.
 */

export const TEST_DURATION_SECONDS = 24 * 60

/**
 * Grace on the server-side deadline.
 *
 * The clock is authoritative on the server, so a taker whose final answer is in flight
 * when the timer expires would otherwise lose 26 items of work to network latency. Twenty
 * seconds is far more than a request needs and far less than another question takes.
 */
export const SUBMIT_GRACE_SECONDS = 20

export type ScoreBand = {
  /** Inclusive lower bound of raw correct answers. */
  minRaw: number
  score: number
  /** Percentile of the general population this band sits at, per the published anchor. */
  percentile: number
  key: string
}

/**
 * The band table.
 *
 * Deliberately coarse. Twenty-six items cannot distinguish a 128 from a 131, and a table
 * that pretended otherwise would invite exactly the false precision this design set out to
 * avoid. Nine bands over 26 items is roughly three items per band, which is about the
 * resolution the instrument actually has.
 */
export const BANDS: readonly ScoreBand[] = [
  { minRaw: 25, score: 145, percentile: 99.9, key: 'exceptional' },
  { minRaw: 23, score: 135, percentile: 99, key: 'gifted' },
  { minRaw: 21, score: 128, percentile: 97, key: 'superior' },
  { minRaw: 18, score: 120, percentile: 91, key: 'high' },
  { minRaw: 14, score: 110, percentile: 75, key: 'above' },
  { minRaw: 10, score: 100, percentile: 50, key: 'average' },
  { minRaw: 7, score: 90, percentile: 25, key: 'below' },
  { minRaw: 4, score: 80, percentile: 9, key: 'low' },
  { minRaw: 0, score: 70, percentile: 2, key: 'floor' },
]

export type IqResult = {
  raw: number
  total: number
  score: number
  percentile: number
  band: string
}

export class InvalidIqAnswersError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidIqAnswersError'
  }
}

/**
 * Answers arrive as one index per item, or -1 for skipped.
 *
 * Rejecting loudly rather than coercing: a payload whose length does not match the test is
 * either a client bug or someone poking at the endpoint, and silently scoring a truncated
 * array would hand back a real-looking number for a test nobody sat.
 */
export function parseIqAnswers(raw: unknown): number[] {
  if (!Array.isArray(raw)) throw new InvalidIqAnswersError('answers must be an array')
  if (raw.length !== ITEM_COUNT) {
    throw new InvalidIqAnswersError(`expected ${ITEM_COUNT} answers, got ${raw.length}`)
  }
  return raw.map((value, index) => {
    const parsed = Number(value)
    if (!Number.isInteger(parsed) || parsed < -1 || parsed > 5) {
      throw new InvalidIqAnswersError(`answer ${index} is not an option index or -1`)
    }
    return parsed
  })
}

export function bandFor(raw: number): ScoreBand {
  return BANDS.find(band => raw >= band.minRaw) ?? (BANDS[BANDS.length - 1] as ScoreBand)
}

export function scoreIq(answers: readonly number[], answerKey: readonly number[]): IqResult {
  const raw = answers.reduce(
    (total, answer, index) => (answer >= 0 && answer === answerKey[index] ? total + 1 : total),
    0
  )
  const band = bandFor(raw)
  return { raw, total: answerKey.length, score: band.score, percentile: band.percentile, band: band.key }
}

/** Whether a submission arrived inside the clock. Server time only; the client display is a mirror. */
export function withinTimeLimit(startedAt: Date, now: Date): boolean {
  const elapsed = (now.getTime() - startedAt.getTime()) / 1000
  return elapsed <= TEST_DURATION_SECONDS + SUBMIT_GRACE_SECONDS
}
