import 'server-only'

import {
  daysUntil,
  DEFAULT_EXAM_DATE,
  estimateScaledScore,
  MAX_CONFIDENCE,
  MAX_MOCKS,
  MOCK_QUESTION_COUNT,
  overallProgress,
  PASS_SCALED_SCORE,
  readinessPercent,
  sanitizeState,
  TARGET_SCALED_SCORE,
  weekProgress,
  type CcafMock,
  type CcafState,
} from '@/lib/ccaf/progress'
import { loadCcafState } from '@/lib/ccaf/progress-data'
import { EXAM_DAY_CHECKS } from '@/lib/ccaf/reference'
import { DOMAINS, WEEKS } from '@/lib/ccaf/roadmap'
import { connectDatabase } from '@/lib/mongodb'
import {
  CCAF_PROGRESS_DOCUMENT_ID,
  CcafProgressModel,
} from '@/models/CcafProgress'

/**
 * CCA-F progress writes and the status summary - one write path for the tracker page
 * (`PUT /api/ccaf`) and the site MCP (`ccaf_update`, `ccaf_status`), premise 2.
 *
 * ```
 *   PUT /api/ccaf ──▶ saveCcafState(body)        sanitizeState ──▶ null ──▶ 400 (caller)
 *                                                └─ upsert the WHOLE state (replace, never merge)
 *   ccaf_update   ──▶ applyCcafUpdate(ops)       loadCcafState ──▶ apply ops ──▶ saveCcafState
 *                      tick/untick tasks + checks · log a mock (correct out of 60) · confidence
 *                      unknown task or check ids ──▶ refused, nothing written
 *   ccaf_status   ──▶ ccafStatus()               progress, readiness, latest mock's scaled score,
 *                                                days to the exam, weakest domains, next tasks
 * ```
 *
 * ## Why the agent's update goes through the same whole-state save
 *
 * The PUT replaces the document (see its header: "I unticked everything" must be expressible),
 * and `sanitizeState` is the one place that bounds it. An agent update is read, change, and
 * the same replace - so the bound and the shape cannot drift between the two doors. Last write
 * wins, as it always has for this one-owner document.
 *
 * ## Why a mock is logged as `correct`, not as a scaled score (acceptance.md D3)
 *
 * The tracker stores correct answers out of 60 and derives the scaled score with
 * `estimateScaledScore`, which Anthropic does not publish and which is linear here. A scaled
 * score does not convert back to a whole number of answers (720 falls between 41 and 42), so
 * `ccaf_update` takes `correct` only and its description tells the agent to ask for it.
 */

/** Upsert a sanitised state. `null` when the body is not a usable state (the route's 400). */
export async function saveCcafState(body: unknown): Promise<CcafState | null> {
  const state = sanitizeState(body)
  if (!state) return null

  await connectDatabase()
  const now = new Date()
  await CcafProgressModel.findOneAndUpdate(
    { _id: CCAF_PROGRESS_DOCUMENT_ID },
    {
      $set: { ...state, updatedAt: now },
      $setOnInsert: { _id: CCAF_PROGRESS_DOCUMENT_ID, createdAt: now },
    },
    { upsert: true, returnDocument: 'after', lean: true, runValidators: true }
  )
  return state
}

const TASKS = WEEKS.flatMap(week =>
  week.days.flatMap(day =>
    day.tasks.map(task => ({
      weekId: week.id,
      id: task.id,
      title: task.title.en,
    }))
  )
)
const TASK_IDS = new Set(TASKS.map(task => task.id))
const CHECK_IDS = new Set(EXAM_DAY_CHECKS.map(check => check.id))

/** The owner's calendar day, for a mock logged without a date. */
function todayInVietnam(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(now)
}

export interface CcafUpdate {
  tickTasks?: string[]
  untickTasks?: string[]
  tickChecks?: string[]
  untickChecks?: string[]
  logMock?: {
    correct: number
    date?: string
    label?: string
    domainPercents?: (number | null)[]
  }
  confidence?: { domain: number; level: number }[]
  examDate?: string
}

export type CcafUpdateResult =
  | { ok: true; state: CcafState; loggedMock: CcafMock | null }
  | { ok: false; error: string }

export async function applyCcafUpdate(
  update: CcafUpdate
): Promise<CcafUpdateResult> {
  const unknownTasks = [
    ...(update.tickTasks ?? []),
    ...(update.untickTasks ?? []),
  ].filter(id => !TASK_IDS.has(id))
  const unknownChecks = [
    ...(update.tickChecks ?? []),
    ...(update.untickChecks ?? []),
  ].filter(id => !CHECK_IDS.has(id))
  if (unknownTasks.length || unknownChecks.length)
    return {
      ok: false,
      error: `Unknown ${[
        unknownTasks.length ? `task ids: ${unknownTasks.join(', ')}` : '',
        unknownChecks.length ? `check ids: ${unknownChecks.join(', ')}` : '',
      ]
        .filter(Boolean)
        .join('; ')}. ccaf_status lists the real ones. Nothing was changed.`,
    }
  const badDomain = (update.confidence ?? []).find(
    entry => entry.domain < 1 || entry.domain > DOMAINS.length
  )
  if (badDomain)
    return {
      ok: false,
      error: `Domain ${badDomain.domain} does not exist: domains are 1 to ${DOMAINS.length}. Nothing was changed.`,
    }

  const state = await loadCcafState()
  // `sanitizeState` keeps the FIRST MAX_MOCKS, so a mock past the cap would be dropped on
  // save while the call reported success. Refused instead, and the owner prunes in the page.
  if (update.logMock && state.mocks.length >= MAX_MOCKS)
    return {
      ok: false,
      error: `The tracker already holds ${MAX_MOCKS} mocks, its limit. Delete an old one in /admin/certificates/ccaf first. Nothing was changed.`,
    }
  const tasks = new Set(state.doneTaskIds)
  update.tickTasks?.forEach(id => tasks.add(id))
  update.untickTasks?.forEach(id => tasks.delete(id))
  const checks = new Set(state.doneCheckIds)
  update.tickChecks?.forEach(id => checks.add(id))
  update.untickChecks?.forEach(id => checks.delete(id))

  const confidence = [...state.confidence]
  for (const { domain, level } of update.confidence ?? [])
    confidence[domain - 1] = level

  let loggedMock: CcafMock | null = null
  const mocks = [...state.mocks]
  if (update.logMock) {
    loggedMock = {
      id: `mock-${Date.now().toString(36)}`,
      date: update.logMock.date ?? todayInVietnam(),
      label: update.logMock.label ?? `Mock ${mocks.length + 1}`,
      correct: update.logMock.correct,
      domainPercents: DOMAINS.map(
        (_, index) => update.logMock?.domainPercents?.[index] ?? null
      ),
    }
    mocks.push(loggedMock)
  }

  const saved = await saveCcafState({
    doneTaskIds: [...tasks],
    doneCheckIds: [...checks],
    confidence,
    mocks,
    examDate: update.examDate ?? state.examDate,
  })
  if (!saved) return { ok: false, error: 'The update could not be applied.' }
  return {
    ok: true,
    state: saved,
    loggedMock: loggedMock
      ? (saved.mocks.find(mock => mock.id === loggedMock!.id) ?? loggedMock)
      : null,
  }
}

export interface CcafStatus {
  examDate: string
  daysToExam: number | null
  progress: { done: number; total: number; percent: number }
  weeks: { id: string; done: number; total: number; percent: number }[]
  readinessPercent: number | null
  passScaledScore: number
  targetScaledScore: number
  latestMock: {
    date: string
    label: string
    correct: number
    outOf: number
    estimatedScaledScore: number
    passes: boolean
  } | null
  confidence: {
    domain: number
    name: string
    weight: number
    level: number
    outOf: number
  }[]
  weakestDomains: { domain: number; name: string; why: string }[]
  nextTasks: { id: string; week: string; title: string }[]
  checks: { id: string; text: string; done: boolean }[]
}

export async function ccafStatus(now = new Date()): Promise<CcafStatus> {
  const state = await loadCcafState()
  const done = new Set(state.doneTaskIds)
  const latest = state.mocks.at(-1) ?? null

  // Weakest first: the latest mock's per-domain percent where it reported one, then the
  // self-rated confidence as a percent. A hole in a mock is not a zero (see progress.ts).
  const scored = DOMAINS.map((domain, index) => {
    const mockPercent = latest?.domainPercents[index] ?? null
    const confidencePercent = Math.round(
      ((state.confidence[index] ?? 0) / MAX_CONFIDENCE) * 100
    )
    return {
      domain: domain.key,
      name: domain.name,
      score: mockPercent ?? confidencePercent,
      why:
        mockPercent !== null
          ? `${mockPercent}% on the latest mock`
          : `self-rated ${state.confidence[index] ?? 0}/${MAX_CONFIDENCE}`,
    }
  }).sort((a, b) => a.score - b.score)

  return {
    examDate: state.examDate || DEFAULT_EXAM_DATE,
    daysToExam: daysUntil(now, state.examDate || DEFAULT_EXAM_DATE),
    progress: overallProgress(state.doneTaskIds),
    weeks: WEEKS.map(week => ({
      id: week.id,
      ...weekProgress(week.id, state.doneTaskIds),
    })),
    readinessPercent: readinessPercent(state.confidence),
    passScaledScore: PASS_SCALED_SCORE,
    targetScaledScore: TARGET_SCALED_SCORE,
    latestMock: latest
      ? {
          date: latest.date,
          label: latest.label,
          correct: latest.correct,
          outOf: MOCK_QUESTION_COUNT,
          estimatedScaledScore: estimateScaledScore(latest.correct),
          passes: estimateScaledScore(latest.correct) >= PASS_SCALED_SCORE,
        }
      : null,
    confidence: DOMAINS.map((domain, index) => ({
      domain: domain.key,
      name: domain.name,
      weight: domain.weight,
      level: state.confidence[index] ?? 0,
      outOf: MAX_CONFIDENCE,
    })),
    weakestDomains: scored
      .slice(0, 2)
      .map(({ domain, name, why }) => ({ domain, name, why })),
    nextTasks: TASKS.filter(task => !done.has(task.id))
      .slice(0, 8)
      .map(task => ({ id: task.id, week: task.weekId, title: task.title })),
    checks: EXAM_DAY_CHECKS.map(check => ({
      id: check.id,
      text: check.text.en,
      done: state.doneCheckIds.includes(check.id),
    })),
  }
}
