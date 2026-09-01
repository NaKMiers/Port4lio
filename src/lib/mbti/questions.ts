import type { Axis } from '@/lib/mbti/types'

/**
 * Question structure. Wording lives in `content/questions.<locale>.ts`, keyed by `id`.
 *
 * Splitting shape from strings is what makes adding a third language a new file rather
 * than an edit to sixty objects, and it keeps the scorer (which only cares about `axis`)
 * from importing a wall of prose it never reads.
 *
 * ODD count per axis is load-bearing, not incidental - see the invariant comment in
 * `scoring.ts`. Fifteen per axis gives sixty questions total: shorter than mbti.vn's 76
 * and in line with 16personalities' 60. Length matters here because the test is free
 * acquisition rather than the paid product, so completion rate is worth more than a few
 * extra points of precision.
 *
 * Axes are interleaved E/I -> S/N -> T/F -> J/P rather than grouped, so the test does not
 * feel like fifteen rephrasings of the same question in a row.
 */

export type Question = {
  /** Stable across content edits and reorderings. Content files key off this. */
  id: number
  axis: Axis
}

export const QUESTIONS_PER_AXIS = 15

const AXIS_CYCLE: Axis[] = ['EI', 'SN', 'TF', 'JP']

export const QUESTIONS: Question[] = Array.from(
  { length: QUESTIONS_PER_AXIS * AXIS_CYCLE.length },
  (_, index) => ({
    id: index + 1,
    axis: AXIS_CYCLE[index % AXIS_CYCLE.length],
  })
)

export const QUESTION_COUNT = QUESTIONS.length
