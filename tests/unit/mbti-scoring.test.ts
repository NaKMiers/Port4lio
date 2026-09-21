import { describe, expect, it } from 'vitest'

import {
  InvalidAnswersError,
  parseAnswers,
  scoreAttempt,
  type Answer,
} from '@/lib/mbti/scoring'
import { QUESTIONS, QUESTIONS_PER_AXIS } from '@/lib/mbti/questions'
import { AXES, MBTI_TYPES } from '@/lib/mbti/types'

/**
 * Scoring is the one function every other part of the product depends on: the free
 * result, the type page someone lands on, and eventually the paid pair report all trace
 * back to what this returns. It is pure and synchronous, so there is no excuse for it to
 * be untested.
 */

function answersFor(pick: (index: number) => Answer): Answer[] {
  return QUESTIONS.map((_, index) => pick(index))
}

describe('question set invariants', () => {
  it('has an odd number of questions on every axis so ties cannot occur', () => {
    for (const axis of AXES) {
      const count = QUESTIONS.filter(question => question.axis === axis).length
      expect(count).toBe(QUESTIONS_PER_AXIS)
      expect(count % 2).toBe(1)
    }
  })

  it('has unique, contiguous ids', () => {
    const ids = QUESTIONS.map(question => question.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(Math.min(...ids)).toBe(1)
    expect(Math.max(...ids)).toBe(QUESTIONS.length)
  })
})

describe('scoreAttempt', () => {
  it('returns ESTJ when every answer is "a"', () => {
    // 'a' scores the first pole of each axis: E, S, T, J.
    const result = scoreAttempt(answersFor(() => 'a'))
    expect(result.type).toBe('ESTJ')
  })

  it('returns INFP when every answer is "b"', () => {
    const result = scoreAttempt(answersFor(() => 'b'))
    expect(result.type).toBe('INFP')
  })

  it('always produces one of the 16 valid types', () => {
    // Deterministic pseudo-random sweep: no Math.random, so a failure is reproducible.
    for (let seed = 0; seed < 200; seed += 1) {
      const answers = answersFor(index =>
        (index * 7 + seed * 13) % 3 === 0 ? 'a' : 'b'
      )
      expect(MBTI_TYPES).toContain(scoreAttempt(answers).type)
    }
  })

  it('never ties on an axis, whatever the input', () => {
    for (let seed = 0; seed < 200; seed += 1) {
      const answers = answersFor(index =>
        (index * 11 + seed * 5) % 2 === 0 ? 'a' : 'b'
      )
      const { scores } = scoreAttempt(answers)
      for (const axis of AXES) expect(scores[axis].a).not.toBe(scores[axis].b)
    }
  })

  it('counts every answer exactly once', () => {
    const { scores } = scoreAttempt(
      answersFor(index => (index % 2 === 0 ? 'a' : 'b'))
    )
    const counted = AXES.reduce(
      (sum, axis) => sum + scores[axis].a + scores[axis].b,
      0
    )
    expect(counted).toBe(QUESTIONS.length)
  })

  it('flips a single axis when only that axis flips', () => {
    // All 'a' is ESTJ. Flip only the E/I questions and the type must become ISTJ, with
    // every other letter unchanged - this catches an axis-mapping mixup in a content file.
    const answers = answersFor(index =>
      QUESTIONS[index].axis === 'EI' ? 'b' : 'a'
    )
    expect(scoreAttempt(answers).type).toBe('ISTJ')
  })

  it('is deterministic: the same answers always give the same type', () => {
    const answers = answersFor(index => (index % 3 === 0 ? 'a' : 'b'))
    expect(scoreAttempt(answers).type).toBe(scoreAttempt(answers).type)
  })
})

describe('parseAnswers', () => {
  it('accepts a well-formed answer vector', () => {
    expect(parseAnswers(answersFor(() => 'a'))).toHaveLength(QUESTIONS.length)
  })

  it('rejects a non-array', () => {
    expect(() => parseAnswers('aaaa')).toThrow(InvalidAnswersError)
    expect(() => parseAnswers(null)).toThrow(InvalidAnswersError)
    expect(() => parseAnswers({ 0: 'a' })).toThrow(InvalidAnswersError)
  })

  it('rejects the wrong length in both directions', () => {
    expect(() => parseAnswers(['a'])).toThrow(/Expected 60 answers/)
    expect(() => parseAnswers(Array(61).fill('a'))).toThrow(
      /Expected 60 answers/
    )
  })

  it('rejects values that are not "a" or "b"', () => {
    const withBadValue = answersFor(() => 'a') as unknown[]
    withBadValue[17] = 'c'
    expect(() => parseAnswers(withBadValue)).toThrow(/Answer 17/)
  })

  it('rejects non-string values that would otherwise coerce', () => {
    const withNumber = answersFor(() => 'a') as unknown[]
    withNumber[0] = 1
    expect(() => parseAnswers(withNumber)).toThrow(InvalidAnswersError)
  })
})
