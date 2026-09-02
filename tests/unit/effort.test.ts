import { describe, expect, it } from 'vitest'

import { QUESTION_COUNT, QUESTIONS } from '@/lib/mbti/questions'
import {
  IQ_CHANCE_CEILING,
  IQ_RUSH_SECONDS,
  iqEffortWaived,
  mbtiEffortWaived,
} from '@/lib/test-kit/effort'

/**
 * Who gets a free result, and - more importantly - who does not.
 *
 * Both directions matter here and they fail differently. A false positive gives away one
 * sale. A false negative charges someone for a score that measures nothing, which is the
 * failure the rule exists to prevent. The cases below pin the boundary from both sides.
 */

const AXIS_OF = QUESTIONS.map(question => question.axis)
const SLOTS = Array.from({ length: QUESTION_COUNT }, (_, index) => index)
const START = new Date('2026-09-02T10:00:00.000Z')
const after = (seconds: number) => new Date(START.getTime() + seconds * 1000)

/** 26 answers, all option 0 - what a masher submits. */
const MASHED = Array.from({ length: 26 }, () => 0)

describe('iqEffortWaived', () => {
  it('waives a chance-level score reached in under five minutes', () => {
    expect(
      iqEffortWaived({ raw: 4, answers: MASHED, startedAt: START, submittedAt: after(90) })
    ).toBe(true)
  })

  it('waives a chance-level score when most of the test was skipped', () => {
    // Twenty minutes on the page, but nothing answered. Time spent is not effort.
    const mostlySkipped = MASHED.map((_, index) => (index < 13 ? 0 : -1))
    expect(
      iqEffortWaived({
        raw: 3,
        answers: mostlySkipped,
        startedAt: START,
        submittedAt: after(20 * 60),
      })
    ).toBe(true)
  })

  it('CHARGES a fast attempt that scored well', () => {
    // The case a stopwatch-only rule gets wrong, and the expensive one: able takers finish
    // early and are exactly the people who want a certificate.
    expect(
      iqEffortWaived({ raw: 22, answers: MASHED, startedAt: START, submittedAt: after(120) })
    ).toBe(false)
  })

  it('CHARGES a slow attempt that scored at chance', () => {
    // Twenty careful minutes for four correct IS a measurement - a low one, honestly
    // obtained. Waiving it would be charging by outcome, which is a different rule.
    expect(
      iqEffortWaived({ raw: 4, answers: MASHED, startedAt: START, submittedAt: after(20 * 60) })
    ).toBe(false)
  })

  it('puts the accuracy boundary one answer above the ceiling', () => {
    const fast = { answers: MASHED, startedAt: START, submittedAt: after(60) }
    expect(iqEffortWaived({ raw: IQ_CHANCE_CEILING, ...fast })).toBe(true)
    expect(iqEffortWaived({ raw: IQ_CHANCE_CEILING + 1, ...fast })).toBe(false)
  })

  it('puts the time boundary exactly at the rush threshold', () => {
    const guessing = { raw: 4, answers: MASHED, startedAt: START }
    expect(
      iqEffortWaived({ ...guessing, submittedAt: after(IQ_RUSH_SECONDS - 1) })
    ).toBe(true)
    expect(iqEffortWaived({ ...guessing, submittedAt: after(IQ_RUSH_SECONDS) })).toBe(false)
  })
})

describe('mbtiEffortWaived', () => {
  it('waives an all-one-side submission', () => {
    expect(mbtiEffortWaived({ answers: SLOTS.map(() => 'a') })).toBe(true)
  })

  it('waives an alternating submission, which the totals alone call balanced', () => {
    /**
     * The case a share threshold cannot see. Questions cycle EI/SN/TF/JP, so alternating
     * a-b-a-b hands each axis a single letter - 15-0 on all four - while the overall split
     * is a perfectly innocent 30/30.
     */
    const answers = SLOTS.map(index => (index % 2 === 0 ? 'a' : 'b'))
    expect(answers.filter(answer => answer === 'a').length).toBe(answers.length / 2)
    expect(mbtiEffortWaived({ answers })).toBe(true)
  })

  it('CHARGES a lopsided but irregular profile', () => {
    /**
     * A very decisive person: 48 of 60 one way, but arriving there unevenly.
     *
     * Written out rather than generated, because every modulo rule is periodic by
     * construction - which is exactly what the detector flags. That is the trap the first
     * version of this test fell into: a case meant to represent "lopsided but human" was a
     * perfect `aaab` cycle, indistinguishable from a drumming finger by any rule that reads
     * only the answers.
     */
    const b = new Set([3, 7, 8, 14, 22, 23, 31, 37, 44, 45, 52, 58])
    const answers = SLOTS.map(index => (b.has(index) ? 'b' : 'a'))

    expect(answers.filter(answer => answer === 'a').length).toBe(48)
    expect(mbtiEffortWaived({ answers })).toBe(false)
  })

  it('waives a four-long drum roll, which is a unanimous axis by another name', () => {
    // `aaab aaab …` - and with four interleaved axes, a period-4 sequence IS "every axis
    // answered one way". The two readings of this pattern are the same condition.
    const answers = SLOTS.map(index => (index % 4 === 3 ? 'b' : 'a'))
    expect(AXIS_OF[3]).toBe('JP')
    expect(mbtiEffortWaived({ answers })).toBe(true)
  })

  it('CHARGES an ordinary mixed profile', () => {
    // Deliberately not periodic: a 5-long cycle is longer than any drumming finger.
    const answers = SLOTS.map(index => (index % 5 === 0 || index % 7 === 3 ? 'b' : 'a'))
    expect(mbtiEffortWaived({ answers })).toBe(false)
  })

  it('waives a two-on two-off roll as well', () => {
    const answers = SLOTS.map(index => (index % 4 < 2 ? 'a' : 'b'))
    expect(mbtiEffortWaived({ answers })).toBe(true)
  })

  it('treats an empty submission as chargeable rather than crashing', () => {
    // Cannot happen - `parseAnswers` rejects a short array before this runs - but a
    // detector that divides by a length must not be the thing that decides that.
    expect(mbtiEffortWaived({ answers: [] })).toBe(false)
  })
})
