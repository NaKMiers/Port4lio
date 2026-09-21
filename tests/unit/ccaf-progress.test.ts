import { describe, expect, it } from 'vitest'

import {
  daysUntil,
  DEFAULT_EXAM_DATE,
  emptyState,
  estimateScaledScore,
  MAX_CONFIDENCE,
  MAX_MOCKS,
  MOCK_QUESTION_COUNT,
  overallProgress,
  readinessPercent,
  sanitizeState,
  TOTAL_TASKS,
  weekProgress,
} from '@/lib/ccaf/progress'
import { DOMAINS, LINKS, TAG_LABEL, WEEKS } from '@/lib/ccaf/roadmap'
import {
  ANSWER_TRAPS,
  EXAM_DAY_CHECKS,
  FACT_GROUPS,
  JUDGMENT_RULES,
  OUT_OF_SCOPE,
  RESOURCES,
} from '@/lib/ccaf/reference'
import { LOCALES } from '@/lib/i18n'
import { UI, WEEKDAYS, type Localized } from '@/lib/ccaf/copy'

/**
 * What the CCA-F page is allowed to store, and what it must refuse.
 *
 * Two things are being defended here and they fail in opposite directions.
 *
 * `sanitizeState` is the only thing standing between an untrusted body and a document with
 * no TTL, so its job is to bound what gets written. The tests that matter there are the
 * rejections, not the happy path.
 *
 * The roadmap invariants at the bottom defend something subtler: task ids are positional,
 * and the stored progress row keys on them. A reordered task is not a broken build - it is
 * a silent reassignment of finished work to different work, which nothing else in the
 * system would notice.
 */

/**
 * The 18 finished tasks under the current ids, which is what the stored document holds.
 *
 * Written out literally rather than derived from `WEEKS`, so that a future regrouping fails
 * the test below instead of quietly agreeing with itself.
 */
const MIGRATED_TASK_IDS = [
  'w1-0-0',
  'w1-0-1',
  'w1-0-2',
  'w1-1-0',
  'w1-1-1',
  'w1-1-2',
  'w1-1-3',
  'w1-2-0',
  'w1-2-1',
  'w1-3-0',
  'w1-4-0',
  'w1-4-1',
  'w1-5-0',
  'w1-6-0',
  'w1-6-1',
  // 11/09 and 12/09 are week 2 once a week is seven days, so the last three finished
  // tasks live there. Week 1 reads 15/15 and week 2 opens at 3/17.
  'w2-0-0',
  'w2-1-0',
  'w2-1-1',
]

describe('sanitizeState', () => {
  it('rejects a body that is not an object', () => {
    expect(sanitizeState(null)).toBeNull()
    expect(sanitizeState('w1-0-0')).toBeNull()
    expect(sanitizeState(['w1-0-0'])).toBeNull()
  })

  it('drops task ids that are not in the roadmap', () => {
    const state = sanitizeState({
      doneTaskIds: ['w1-0-0', 'w9-9-9', '', 'not-an-id', 42],
    })
    expect(
      state?.doneTaskIds,
      'an unknown id would grow a document that has no TTL to clean it up'
    ).toEqual(['w1-0-0'])
  })

  it('deduplicates and sorts ticks so equal states serialise equally', () => {
    const state = sanitizeState({ doneTaskIds: ['w1-1-0', 'w1-0-0', 'w1-0-0'] })
    expect(state?.doneTaskIds).toEqual(['w1-0-0', 'w1-1-0'])
  })

  it('drops checklist ids that are not on the checklist', () => {
    const state = sanitizeState({ doneCheckIds: ['ck1', 'ck99'] })
    expect(state?.doneCheckIds).toEqual(['ck1'])
  })

  it('always returns one confidence entry per domain, clamped', () => {
    const state = sanitizeState({ confidence: [99, -4, 2.6] })
    expect(state?.confidence).toHaveLength(DOMAINS.length)
    expect(state?.confidence.slice(0, 3)).toEqual([MAX_CONFIDENCE, 0, 3])
    expect(state?.confidence.slice(3)).toEqual([0, 0])
  })

  it('caps how many mocks can be stored', () => {
    const many = Array.from({ length: MAX_MOCKS + 20 }, () => ({ correct: 30 }))
    expect(sanitizeState({ mocks: many })?.mocks).toHaveLength(MAX_MOCKS)
  })

  it('drops a mock with no usable score and clamps the rest', () => {
    const state = sanitizeState({
      mocks: [{ correct: 'lots' }, { correct: 99 }, { correct: -3 }],
    })
    expect(state?.mocks).toHaveLength(2)
    expect(state?.mocks[0]?.correct).toBe(MOCK_QUESTION_COUNT)
    expect(state?.mocks[1]?.correct).toBe(0)
  })

  it('keeps a missing domain percent as a hole rather than a zero', () => {
    // A zero would read as "answered nothing right in that domain" and would drag the
    // weakest-domain view onto a domain the mock never reported.
    const state = sanitizeState({
      mocks: [{ correct: 40, domainPercents: [50, null, '', undefined, 80] }],
    })
    expect(state?.mocks[0]?.domainPercents).toEqual([50, null, null, null, 80])
  })

  it('falls back to the default exam date when the date is unusable', () => {
    expect(sanitizeState({ examDate: '27/09/2026' })?.examDate).toBe(
      DEFAULT_EXAM_DATE
    )
    expect(sanitizeState({ examDate: '2026-13-45' })?.examDate).toBe(
      DEFAULT_EXAM_DATE
    )
    expect(sanitizeState({ examDate: '2026-09-27' })?.examDate).toBe(
      '2026-09-27'
    )
  })

  it('returns a total state from a partial body', () => {
    // The route replaces the document, so every field has to come back populated -
    // otherwise "I unticked everything" and "I sent no tasks" would write the same thing.
    const state = sanitizeState({})
    expect(state).toEqual(emptyState())
  })
})

describe('readinessPercent', () => {
  it('is null until something has been rated', () => {
    expect(readinessPercent([0, 0, 0, 0, 0])).toBeNull()
  })

  it('is 100 when every domain is maxed', () => {
    expect(readinessPercent(DOMAINS.map(() => MAX_CONFIDENCE))).toBe(100)
  })

  it('weights by exam share, so the heaviest domain moves it most', () => {
    // Domain 1 is 27% of the exam and domain 5 is 15%. Rating only one of them full must
    // therefore produce different readiness - a flat mean would call these equal.
    const onlyFirst = readinessPercent([MAX_CONFIDENCE, 0, 0, 0, 0])
    const onlyLast = readinessPercent([0, 0, 0, 0, MAX_CONFIDENCE])
    expect(onlyFirst).toBe(27)
    expect(onlyLast).toBe(15)
  })
})

describe('progress counting', () => {
  it('counts only ids that exist in the plan', () => {
    expect(overallProgress(['w1-0-0', 'made-up']).done).toBe(1)
    expect(overallProgress([]).total).toBe(TOTAL_TASKS)
  })

  it('reports 0% for an unknown week rather than throwing', () => {
    expect(weekProgress('w9', ['w1-0-0'])).toEqual({
      done: 0,
      total: 0,
      percent: 0,
    })
  })

  it('reaches 100% for a week when all of its tasks are ticked', () => {
    const week = WEEKS[0]
    const ids = week!.days.flatMap(day => day.tasks.map(task => task.id))
    expect(weekProgress(week!.id, ids).percent).toBe(100)
  })
})

describe('estimateScaledScore', () => {
  it('spans the published 100-1000 range', () => {
    expect(estimateScaledScore(0)).toBe(100)
    expect(estimateScaledScore(MOCK_QUESTION_COUNT)).toBe(1000)
  })

  it('clamps a score that should not exist', () => {
    expect(estimateScaledScore(-5)).toBe(100)
    expect(estimateScaledScore(MOCK_QUESTION_COUNT + 5)).toBe(1000)
  })
})

describe('daysUntil', () => {
  // Local components, not an ISO string with a Z: the function reads the reader's calendar
  // day, so a fixture pinned to UTC would make these assertions depend on the runner's TZ.
  const from = new Date(2026, 8, 13, 23, 30)

  it('counts whole days forward', () => {
    expect(daysUntil(from, '2026-09-27')).toBe(14)
  })

  it('is 0 on the day itself and negative afterwards', () => {
    expect(daysUntil(from, '2026-09-13')).toBe(0)
    expect(daysUntil(from, '2026-09-01')).toBe(-12)
  })

  it('uses the local calendar day, not the UTC one', () => {
    // 00:30 and 23:30 on the same local date are the same number of days from the exam.
    // Reading UTC parts instead broke this for every reader east of Greenwich during their
    // morning - which is the whole intended audience of this page.
    const earlyMorning = new Date(2026, 8, 13, 0, 30)
    expect(daysUntil(earlyMorning, '2026-09-27')).toBe(14)
    expect(daysUntil(earlyMorning, '2026-09-13')).toBe(0)
  })

  it('is null for a date it cannot read', () => {
    expect(daysUntil(from, 'tomorrow')).toBeNull()
  })
})

describe('roadmap invariants', () => {
  const tasks = WEEKS.flatMap((week, weekIndex) =>
    week.days.flatMap((day, dayIndex) =>
      day.tasks.map((task, taskIndex) => ({
        week,
        weekIndex,
        day,
        dayIndex,
        task,
        taskIndex,
      }))
    )
  )

  it('has a unique id for every task', () => {
    const ids = tasks.map(entry => entry.task.id)
    expect(new Set(ids).size, 'two tasks sharing an id share a tick').toBe(
      ids.length
    )
  })

  it('derives every task id from its position', () => {
    // This is the invariant the import path depends on. If a task is ever inserted in the
    // middle of a day, this fails here rather than silently moving someone's progress.
    for (const { week, day, dayIndex, task, taskIndex } of tasks) {
      expect(day.id).toBe(`${week.id}-${dayIndex}`)
      expect(task.id).toBe(`${week.id}-${dayIndex}-${taskIndex}`)
    }
  })

  it('gives every task a completion criterion and at least one step', () => {
    for (const { task } of tasks) {
      expect(task.steps.length, `${task.id} has no steps`).toBeGreaterThan(0)
      for (const locale of LOCALES)
        expect(
          task.doneWhen[locale],
          `${task.id} has no "done when" in ${locale}`
        ).not.toBe('')
    }
  })

  it('matches the task total the progress module reports', () => {
    expect(TOTAL_TASKS).toBe(tasks.length)
  })

  it('has domain weights that sum to a whole exam', () => {
    expect(DOMAINS.reduce((sum, domain) => sum + domain.weight, 0)).toBe(100)
  })

  it('gives the exam-day checklist stable ids', () => {
    const ids = EXAM_DAY_CHECKS.map(check => check.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain('ck1')
  })

  it('dates every day except the one that floats with the exam date', () => {
    const floating = WEEKS.flatMap(week => week.days).filter(
      day => day.floating
    )
    expect(floating).toHaveLength(1)
    expect(floating[0]?.date).toBeNull()

    for (const day of WEEKS.flatMap(week => week.days)) {
      if (day.floating) continue
      expect(day.date, `${day.id} has no date`).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  it('opens each week on seven consecutive days', () => {
    // A week here is a calendar week, not a phase: seven dates from 04/09, and only the
    // last week is short because the plan ends on the 30th. Stretching one to fit a phase
    // makes "week" mean two things on the same page.
    const DAY = 86_400_000
    WEEKS.forEach((week, i) => {
      const dated = week.days
        .filter(day => !day.floating)
        .map(d => d.date as string)
      const first = Date.parse(`${dated[0]}T00:00:00Z`)
      const last = Date.parse(`${dated[dated.length - 1]}T00:00:00Z`)
      expect(
        (last - first) / DAY,
        `${week.id} spans more than a week`
      ).toBeLessThan(7)
      expect(
        week.days.length,
        `${week.id} has too many days`
      ).toBeLessThanOrEqual(7)
      if (i < WEEKS.length - 1) expect(week.days).toHaveLength(7)
    })
  })

  it('starts on 04/09 and puts the finished work first', () => {
    // The catch-up rests on this: the first eighteen tasks in plan order are exactly the
    // finished ones, spread over the nine days they really took, so the plan's own day
    // numbering puts 13/09 at day 10. Reshape that and the stored document needs migrating
    // in the same change - fail here rather than silently moving somebody's ticks.
    const days = WEEKS.flatMap(week => week.days)
    expect(days[0]?.date).toBe('2026-09-04')
    const ids = days.flatMap(day => day.tasks.map(task => task.id))
    expect(ids.slice(0, MIGRATED_TASK_IDS.length)).toEqual(MIGRATED_TASK_IDS)
    expect(days.findIndex(day => day.date === '2026-09-13')).toBe(9)
  })

  it('runs the calendar strictly forward', () => {
    const dates = WEEKS.flatMap(week => week.days)
      .filter(day => !day.floating)
      .map(day => day.date as string)
    expect([...dates].sort()).toEqual(dates)
    expect(new Set(dates).size, 'two days on one date').toBe(dates.length)
  })

  it('keeps weekday evenings inside what a work day leaves', () => {
    // Office hours are 08:30-18:30, so a Monday-to-Friday slot is one evening. Anything
    // above ~3.5h there is a budget that will silently slip into the next day, which is
    // precisely how the previous version accumulated a three-day lag.
    for (const day of WEEKS.flatMap(week => week.days)) {
      if (day.floating) continue
      const weekday = new Date(`${day.date}T00:00:00Z`).getUTCDay()
      if (weekday === 0 || weekday === 6) continue
      expect(
        day.hours,
        `${day.id} (${day.date}) is a work night`
      ).toBeLessThanOrEqual(3.5)
    }
  })

  it('puts every long session on a weekend', () => {
    const long = WEEKS.flatMap(week => week.days).filter(
      day => !day.floating && day.hours >= 5
    )
    expect(long.length, 'the plan needs real blocks somewhere').toBeGreaterThan(
      3
    )
    for (const day of long) {
      const weekday = new Date(`${day.date}T00:00:00Z`).getUTCDay()
      expect(
        weekday === 0 || weekday === 6,
        `${day.id} (${day.date}) budgets ${day.hours}h on a work day`
      ).toBe(true)
    }
  })
})

/**
 * Translation parity.
 *
 * The `Localized` type already forces both languages to exist, so these cover what a type
 * cannot: a translation that is present but empty, one that mangled a code span, and one
 * that broke a link placeholder. The last is the sharpest - `{n1|Domain 1 notes}` renders
 * as plain text rather than a link if the key is altered, which looks like a styling bug
 * and is really a translator typo.
 */
describe('bilingual content', () => {
  const everyLocalized: { where: string; value: Localized }[] = [
    ...Object.entries(UI).map(([key, value]) => ({
      where: `UI.${key}`,
      value,
    })),
    ...Object.entries(TAG_LABEL).map(([key, value]) => ({
      where: `TAG_LABEL.${key}`,
      value,
    })),
    ...WEEKS.flatMap(week => [
      { where: `${week.id}.label`, value: week.label },
      { where: `${week.id}.phase`, value: week.phase },
      { where: `${week.id}.desc`, value: week.desc },
      ...week.days.flatMap(day => [
        { where: `${day.id}.title`, value: day.title },
        ...day.tasks.flatMap(task => [
          { where: `${task.id}.title`, value: task.title },
          { where: `${task.id}.doneWhen`, value: task.doneWhen },
          ...task.steps.map((step, i) => ({
            where: `${task.id}.step.${i}`,
            value: step,
          })),
        ]),
      ]),
    ]),
    ...FACT_GROUPS.flatMap((group, g) => [
      { where: `fact.${g}.title`, value: group.title },
      ...group.items.map((item, i) => ({
        where: `fact.${g}.${i}`,
        value: item,
      })),
    ]),
    ...JUDGMENT_RULES.map((rule, i) => ({ where: `rule.${i}`, value: rule })),
    ...ANSWER_TRAPS.flatMap((trap, i) => [
      { where: `trap.${i}.token`, value: trap.token },
      { where: `trap.${i}.why`, value: trap.why },
    ]),
    ...OUT_OF_SCOPE.map((item, i) => ({ where: `scope.${i}`, value: item })),
    ...EXAM_DAY_CHECKS.map(check => ({
      where: `check.${check.id}`,
      value: check.text,
    })),
    ...RESOURCES.flatMap((resource, i) => [
      { where: `resource.${i}.label`, value: resource.label },
      { where: `resource.${i}.note`, value: resource.note },
    ]),
  ]

  const codeSpans = (value: string) =>
    Array.from(value.matchAll(/<code>([\s\S]*?)<\/code>/g)).map(m => m[1])

  const linkKeys = (value: string) =>
    Array.from(value.matchAll(/\{(\w+)\|/g)).map(m => m[1])

  it('covers a lot of ground, so a shrinking list means something stopped being checked', () => {
    expect(everyLocalized.length).toBeGreaterThan(400)
  })

  it('has a non-empty string in every language', () => {
    for (const { where, value } of everyLocalized)
      for (const locale of LOCALES)
        expect(
          value[locale]?.trim(),
          `${where} is empty in ${locale}`
        ).toBeTruthy()
  })

  it('keeps code spans identical across languages', () => {
    // `stop_reason` is `stop_reason` in every language. A translated identifier is a bug
    // somebody pastes into a terminal.
    for (const { where, value } of everyLocalized)
      expect(codeSpans(value.en), `${where} altered a code span`).toEqual(
        codeSpans(value.vi)
      )
  })

  it('keeps link placeholders pointing at the same targets', () => {
    for (const { where, value } of everyLocalized)
      expect(linkKeys(value.en), `${where} changed a link key`).toEqual(
        linkKeys(value.vi)
      )
  })

  it('only references link keys that exist', () => {
    for (const { where, value } of everyLocalized)
      for (const locale of LOCALES)
        for (const key of linkKeys(value[locale]))
          expect(
            LINKS[key],
            `${where} points at unknown link "${key}"`
          ).toBeTruthy()
  })

  it('balances every inline tag it opens', () => {
    for (const { where, value } of everyLocalized)
      for (const locale of LOCALES)
        for (const tag of ['strong', 'em', 'code']) {
          const open = (value[locale].match(new RegExp(`<${tag}>`, 'g')) ?? [])
            .length
          const close = (
            value[locale].match(new RegExp(`</${tag}>`, 'g')) ?? []
          ).length
          expect(close, `${where} (${locale}) leaves <${tag}> unbalanced`).toBe(
            open
          )
        }
  })

  it('names seven weekdays in each language', () => {
    for (const locale of LOCALES) expect(WEEKDAYS[locale]).toHaveLength(7)
  })
})
