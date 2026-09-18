/**
 * The shape of CCA-F progress, and every rule about what counts as valid.
 *
 * ```
 *   browser edit ──▶ PUT /api/ccaf ──▶ sanitizeState ──▶ CcafProgressModel.set
 *                                           │
 *                                      null │ 400, nothing written
 * ```
 *
 * ## Why the wire shape is not the shape the old tracker used
 *
 * The tracker this page replaces kept progress as `{ tasks: { 'w1-0-0': true }, conf: { '1': 2 } }`
 * - objects keyed by id, because `localStorage` holds a blob and nothing ever queried it.
 * Mongo is not a blob store: dynamic keys cannot be indexed, and a key containing a dot is
 * rejected outright. So the document holds arrays (`doneTaskIds`, a fixed-length
 * `confidence`) instead. A `parseLegacySnapshot` used to sit here to read the old files;
 * it went when the paste-a-snapshot panel did, its one import having long since happened.
 *
 * ## Why unknown task ids are dropped rather than stored
 *
 * `sanitizeState` checks every id against the roadmap. Without that, the array is an
 * unbounded write target: a stale tab holding ids from a since-edited roadmap would
 * silently reintroduce them, and the document has no TTL to clean up after it. Dropping is
 * right rather than rejecting the whole request - a stale tab should lose the ticks that
 * no longer mean anything, not fail to save the ones that still do.
 */

import { DOMAINS, WEEKS } from '@/lib/ccaf/roadmap'
import { EXAM_DAY_CHECKS } from '@/lib/ccaf/reference'

/** Questions on the real exam. The mock bank matches it, so a mock is scored out of this. */
export const MOCK_QUESTION_COUNT = 60

/** Scaled score needed to pass, on Anthropic's published 100-1000 range. */
export const PASS_SCALED_SCORE = 720

/** The target this plan is built around - a pass with room, not a pass by one question. */
export const TARGET_SCALED_SCORE = 800

/** Mock results kept. Enough for a trend, few enough that the document stays small. */
export const MAX_MOCKS = 50

/** Highest self-rating on the per-domain confidence sliders. */
export const MAX_CONFIDENCE = 5

/** One logged practice test. */
export type CcafMock = {
  id: string
  /** ISO `YYYY-MM-DD`. */
  date: string
  label: string
  /** Correct answers out of {@link MOCK_QUESTION_COUNT}. */
  correct: number
  /**
   * Percent correct per domain, index 0 = domain 1. `null` where the mock did not report
   * that domain - kept as a hole rather than zero, which would read as "answered nothing
   * right" and drag the weakest-domain view onto the wrong domain.
   */
  domainPercents: (number | null)[]
}

export type CcafState = {
  /** Ids of completed tasks. A set, stored sorted so equal states serialise equally. */
  doneTaskIds: string[]
  /** Self-rated confidence 0-{@link MAX_CONFIDENCE}, one entry per domain, index 0 = domain 1. */
  confidence: number[]
  mocks: CcafMock[]
  /** Ids of ticked exam-day checklist rows. */
  doneCheckIds: string[]
  /** ISO `YYYY-MM-DD` of the booked exam. */
  examDate: string
}

/** The exam date the plan was built around; used until someone sets their own. */
export const DEFAULT_EXAM_DATE = '2026-09-27'

/**
 * The date the certificate has to exist by, set by the employer's partnership milestone
 * rather than by Anthropic. It is the reason the plan is three weeks and not six, so it is
 * shown next to the exam date rather than left as background knowledge.
 */
export const COMPANY_DEADLINE = '2026-10-01'

export function emptyState(): CcafState {
  return {
    doneTaskIds: [],
    confidence: DOMAINS.map(() => 0),
    mocks: [],
    doneCheckIds: [],
    examDate: DEFAULT_EXAM_DATE,
  }
}

const TASK_IDS: ReadonlySet<string> = new Set(
  WEEKS.flatMap(week =>
    week.days.flatMap(day => day.tasks.map(task => task.id))
  )
)

const CHECK_IDS: ReadonlySet<string> = new Set(
  EXAM_DAY_CHECKS.map(check => check.id)
)

/** Total tasks in the plan. Read from the roadmap so it cannot drift out of date. */
export const TOTAL_TASKS = TASK_IDS.size

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime())
}

function clampInt(value: unknown, min: number, max: number): number | null {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return null
  return Math.min(max, Math.max(min, Math.round(n)))
}

function uniqueSorted(ids: string[]): string[] {
  return Array.from(new Set(ids)).sort()
}

function sanitizeMock(raw: unknown, index: number): CcafMock | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const candidate = raw as Record<string, unknown>

  const correct = clampInt(candidate.correct, 0, MOCK_QUESTION_COUNT)
  if (correct === null) return null

  const rawPercents = Array.isArray(candidate.domainPercents)
    ? candidate.domainPercents
    : Array.isArray(candidate.d)
      ? candidate.d
      : []

  const domainPercents = DOMAINS.map((_, i) => {
    const value = rawPercents[i]
    if (value === null || value === undefined || value === '') return null
    return clampInt(value, 0, 100)
  })

  const label =
    typeof candidate.label === 'string' && candidate.label.trim()
      ? candidate.label.trim().slice(0, 24)
      : `Đề ${index + 1}`

  return {
    id:
      typeof candidate.id === 'string' && candidate.id
        ? candidate.id.slice(0, 40)
        : String(candidate.id ?? `mock-${index}`),
    date: isIsoDate(candidate.date) ? candidate.date : DEFAULT_EXAM_DATE,
    label,
    correct,
    domainPercents,
  }
}

/**
 * Narrow an untrusted body into a `CcafState`, or `null` if there is nothing usable.
 *
 * Every field is optional on the way in and total on the way out, so a client that omits
 * a section gets the empty value for it rather than a partial write - this endpoint
 * replaces the document, and a merge would make "I unticked everything" indistinguishable
 * from "I did not send tasks".
 */
export function sanitizeState(raw: unknown): CcafState | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const candidate = raw as Record<string, unknown>

  const doneTaskIds = Array.isArray(candidate.doneTaskIds)
    ? uniqueSorted(
        candidate.doneTaskIds.filter(
          (id): id is string => typeof id === 'string' && TASK_IDS.has(id)
        )
      )
    : []

  const doneCheckIds = Array.isArray(candidate.doneCheckIds)
    ? uniqueSorted(
        candidate.doneCheckIds.filter(
          (id): id is string => typeof id === 'string' && CHECK_IDS.has(id)
        )
      )
    : []

  const rawConfidence = Array.isArray(candidate.confidence)
    ? candidate.confidence
    : []
  const confidence = DOMAINS.map(
    (_, i) => clampInt(rawConfidence[i], 0, MAX_CONFIDENCE) ?? 0
  )

  const mocks = (Array.isArray(candidate.mocks) ? candidate.mocks : [])
    .slice(0, MAX_MOCKS)
    .map((mock, i) => sanitizeMock(mock, i))
    .filter((mock): mock is CcafMock => mock !== null)

  return {
    doneTaskIds,
    doneCheckIds,
    confidence,
    mocks,
    examDate: isIsoDate(candidate.examDate)
      ? candidate.examDate
      : DEFAULT_EXAM_DATE,
  }
}

export type Progress = {
  done: number
  total: number
  percent: number
}

function toProgress(done: number, total: number): Progress {
  return { done, total, percent: total ? Math.round((done / total) * 100) : 0 }
}

export function weekProgress(
  weekId: string,
  doneTaskIds: readonly string[]
): Progress {
  const week = WEEKS.find(candidate => candidate.id === weekId)
  if (!week) return toProgress(0, 0)
  const ids = week.days.flatMap(day => day.tasks.map(task => task.id))
  const done = new Set(doneTaskIds)
  return toProgress(ids.filter(id => done.has(id)).length, ids.length)
}

export function overallProgress(doneTaskIds: readonly string[]): Progress {
  const done = new Set(doneTaskIds)
  return toProgress(
    Array.from(done).filter(id => TASK_IDS.has(id)).length,
    TOTAL_TASKS
  )
}

/**
 * Confidence collapsed into one number, weighted by how much of the exam each domain is.
 *
 * Weighted rather than averaged because the domains are not equal: being shaky on Agentic
 * Architecture (27%) costs nearly twice what the same shakiness costs on Context
 * Management (15%), and a flat mean hides exactly that.
 *
 * Returns `null` when nothing has been rated, so the UI can show "-" rather than a
 * confident-looking 0%.
 */
export function readinessPercent(confidence: readonly number[]): number | null {
  if (!confidence.some(level => level > 0)) return null
  const total = DOMAINS.reduce((sum, domain, i) => {
    const level = confidence[i] ?? 0
    return sum + domain.weight * (level / MAX_CONFIDENCE)
  }, 0)
  return Math.round(total)
}

/**
 * A rough scaled score for a mock result.
 *
 * ANTHROPIC DOES NOT PUBLISH THE SCALING, and the real exam equates across forms of
 * differing difficulty, so this is a linear stand-in over the 100-1000 range and nothing
 * more. It exists to make "68%" legible against a 720 cut score at a glance; it is not a
 * prediction, and the UI says so where it is shown.
 */
export function estimateScaledScore(correct: number): number {
  const percent = Math.min(1, Math.max(0, correct / MOCK_QUESTION_COUNT))
  return Math.round(100 + percent * 900)
}

/**
 * Whole days from `from` to `to`, negative once `to` is in the past.
 *
 * `from` is read in LOCAL time, deliberately. The previous version took its UTC date
 * parts, which is a different calendar day for everyone east of Greenwich during their
 * early morning: at 04:00 in Ho Chi Minh City the UTC date is still yesterday, so the
 * countdown said "15 days" while the plan below it highlighted today's card as day 10 of
 * 24. Two numbers on one screen disagreeing about what day it is reads as a broken page,
 * and the reader is in UTC+7.
 *
 * The target stays UTC midnight and the local parts are re-stamped onto `Date.UTC`, so
 * both sides are the same kind of instant and the subtraction is a plain day count. This
 * matches `toIsoDate` in `CcafPlan`, which decides which card is today.
 */
export function daysUntil(from: Date, to: string): number | null {
  if (!isIsoDate(to)) return null
  const target = new Date(`${to}T00:00:00Z`).getTime()
  const start = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())
  return Math.round((target - start) / 86_400_000)
}
