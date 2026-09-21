import { AXES, AXIS_POLES, type Axis, type MbtiType } from '@/lib/mbti/types'
import { QUESTIONS, QUESTIONS_PER_AXIS } from '@/lib/mbti/questions'

/**
 * Scoring: 60 binary answers in, one four-letter type out.
 *
 * ```
 *   answers[]  ──▶ validate ──▶ tally per axis ──▶ pick pole ──▶ "ENFJ"
 *      │              │              │                 │
 *      ▼              ▼              ▼                 ▼
 *   [wrong len]  [not 'a'/'b']   [15 per axis]    [no tie possible]
 *   → throw       → throw        (odd, by design)
 * ```
 *
 * There is no tie-break rule because there can be no ties: every axis carries an ODD
 * number of questions (`QUESTIONS_PER_AXIS`, asserted below), so one pole always wins
 * outright. That is a deliberate design choice over defining a tie-break constant. A
 * documented rule is a rule someone can change by accident three months from now, and the
 * failure mode is nasty - the same answers would start producing a different type, which
 * breaks the promise that a paid pair report still says what it said when it was bought.
 *
 * Scoring is pure and synchronous. It does not touch the database, the clock, or the
 * network, so it is fully testable and its output depends on nothing but its input.
 */

export type Answer = 'a' | 'b'

export class InvalidAnswersError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidAnswersError'
  }
}

/** Per-axis counts, kept alongside the type so the result page can show how decisive each axis was. */
export type AxisScores = Record<Axis, { a: number; b: number }>

export type ScoreResult = {
  type: MbtiType
  scores: AxisScores
}

/**
 * Guards the no-ties invariant at module load rather than at call time.
 *
 * If someone adds a 16th question to an axis, the app fails to boot instead of quietly
 * producing ties that the scorer has no rule for. Loud and early beats subtle and later.
 */
for (const axis of AXES) {
  const count = QUESTIONS.filter(question => question.axis === axis).length
  if (count !== QUESTIONS_PER_AXIS)
    throw new Error(
      `Axis ${axis} has ${count} questions, expected ${QUESTIONS_PER_AXIS}`
    )

  if (count % 2 === 0)
    throw new Error(
      `Axis ${axis} has an even question count (${count}); ties would be possible`
    )
}

export function isAnswer(value: unknown): value is Answer {
  return value === 'a' || value === 'b'
}

/**
 * Validates a raw answer array from an untrusted request body.
 *
 * Separate from `scoreAttempt` so the route handler can return a 400 with a useful message
 * instead of catching an exception thrown from deep inside scoring.
 */
export function parseAnswers(input: unknown): Answer[] {
  if (!Array.isArray(input))
    throw new InvalidAnswersError('Answers must be an array')

  if (input.length !== QUESTIONS.length)
    throw new InvalidAnswersError(
      `Expected ${QUESTIONS.length} answers, received ${input.length}`
    )

  const answers: Answer[] = []
  for (let index = 0; index < input.length; index += 1) {
    const value = input[index]
    if (!isAnswer(value))
      throw new InvalidAnswersError(`Answer ${index} must be "a" or "b"`)

    answers.push(value)
  }

  return answers
}

/**
 * Tallies answers into a four-letter type.
 *
 * `answers[i]` corresponds to `QUESTIONS[i]` positionally. The questionnaire always
 * presents questions in `QUESTIONS` order, so index alignment is the contract; the array
 * carries no question ids of its own to keep the stored answer vector small.
 */
export function scoreAttempt(answers: Answer[]): ScoreResult {
  const scores = Object.fromEntries(
    AXES.map(axis => [axis, { a: 0, b: 0 }])
  ) as AxisScores

  answers.forEach((answer, index) => {
    scores[QUESTIONS[index].axis][answer] += 1
  })

  const type = AXES.map(axis => {
    const { a, b } = scores[axis]
    // Odd counts make `a === b` unreachable; the module-load guard above enforces it.
    return a > b ? AXIS_POLES[axis].a : AXIS_POLES[axis].b
  }).join('') as MbtiType

  return { type, scores }
}
