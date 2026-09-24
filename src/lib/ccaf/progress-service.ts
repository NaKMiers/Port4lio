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
import { loadCcafState, stateFromDocument } from '@/lib/ccaf/progress-data'
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
 *   ccaf_update   ──▶ applyCcafUpdate(ops)       read ──▶ apply ops ──▶ sanitizeState
 *                                                └─ write IF updatedAt unchanged, else re-read (x3)
 *                      tick/untick tasks + checks · log a mock (correct out of 60) · confidence
 *                      unknown task or check ids ──▶ refused, nothing written
 *   ccaf_status   ──▶ ccafStatus()               progress, readiness, latest mock's scaled score,
 *                                                days to the exam, weakest domains, next tasks
 * ```
 *
 * ## Why the agent's update is the same whole-state write, made conditional
 *
 * The PUT replaces the document (see its header: "I unticked everything" must be expressible),
 * and `sanitizeState` is the one place that bounds it. An agent update is read, change, and
 * the same sanitised replace - so the bound and the shape cannot drift between the two doors.
 *
 * It is not a blind replace, though. The first version read through `loadCcafState` and
 * `$set` the result: two agent calls in flight lost one's mock, and - worse - that loader
 * answers a database blip with the EMPTY plan, which the update then saved over the real
 * state. So the agent reads the document itself (a blip throws), and writes only if
 * `updatedAt` is still what it read; a lost race re-reads and re-applies. `$addToSet` and
 * friends were the alternative, and would have let the agent's path skip `sanitizeState`.
 *
 * What this does not cover: a tracker tab opened BEFORE the agent's write, saving later. The
 * PUT is a whole-state replace by contract, so that tab's save still wins. Guarding it is a
 * change to the PUT (a baseUpdatedAt 409, as R9 does for posts), which is the owner's call.
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

/** Re-reads when a concurrent write moved `updatedAt`; rare, so a few tries are plenty. */
const UPDATE_ATTEMPTS = 3

/** The ids and domains an update names, checked against the plan. The refusal, or null. */
export function checkCcafUpdate(update: CcafUpdate): string | null {
  const unknownTasks = [
    ...(update.tickTasks ?? []),
    ...(update.untickTasks ?? []),
  ].filter(id => !TASK_IDS.has(id))
  const unknownChecks = [
    ...(update.tickChecks ?? []),
    ...(update.untickChecks ?? []),
  ].filter(id => !CHECK_IDS.has(id))
  if (unknownTasks.length || unknownChecks.length)
    return `Unknown ${[
      unknownTasks.length ? `task ids: ${unknownTasks.join(', ')}` : '',
      unknownChecks.length ? `check ids: ${unknownChecks.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('; ')}. ccaf_status lists the real ones. Nothing was changed.`
  const badDomain = (update.confidence ?? []).find(
    entry => entry.domain < 1 || entry.domain > DOMAINS.length
  )
  if (badDomain)
    return `Domain ${badDomain.domain} does not exist: domains are 1 to ${DOMAINS.length}. Nothing was changed.`

  return null
}

export async function applyCcafUpdate(
  update: CcafUpdate
): Promise<CcafUpdateResult> {
  const refused = checkCcafUpdate(update)
  if (refused) return { ok: false, error: refused }

  await connectDatabase()
  for (let attempt = 0; attempt < UPDATE_ATTEMPTS; attempt += 1) {
    // Read directly, not through `loadCcafState`: that one answers a blip with the empty
    // plan, which this write would then save over the real state.
    const doc = await CcafProgressModel.findById(
      CCAF_PROGRESS_DOCUMENT_ID
    ).lean()
    const state = stateFromDocument(doc)
    // `sanitizeState` keeps the FIRST MAX_MOCKS, so a mock past the cap would be dropped on
    // save while the call reported success. Refused instead, and the owner prunes in the page.
    if (update.logMock && state.mocks.length >= MAX_MOCKS)
      return {
        ok: false,
        error: `The tracker already holds ${MAX_MOCKS} mocks, its limit. Delete an old one in /admin/certificates/ccaf first. Nothing was changed.`,
      }
    const next = applyOps(state, update)
    const sanitised = sanitizeState(next.state)
    if (!sanitised)
      return { ok: false, error: 'The update could not be applied.' }

    const now = new Date()
    let written: boolean
    if (!doc)
      // Never saved: an insert, so two first writes cannot both land - the loser re-reads.
      written = await CcafProgressModel.create({
        _id: CCAF_PROGRESS_DOCUMENT_ID,
        ...sanitised,
        createdAt: now,
        updatedAt: now,
      }).then(
        () => true,
        (error: unknown) => {
          if ((error as { code?: number }).code === 11000) return false
          throw error
        }
      )
    else {
      const saved = await CcafProgressModel.updateOne(
        // `?? null`: an undefined filter value is dropped, which would make this a blind write.
        { _id: CCAF_PROGRESS_DOCUMENT_ID, updatedAt: doc.updatedAt ?? null },
        { $set: { ...sanitised, updatedAt: now } },
        { runValidators: true }
      )
      written = saved.matchedCount === 1
    }
    if (!written) continue

    return {
      ok: true,
      state: sanitised,
      loggedMock: next.loggedMock
        ? (sanitised.mocks.find(mock => mock.id === next.loggedMock!.id) ??
          next.loggedMock)
        : null,
    }
  }
  return {
    ok: false,
    error:
      'The tracker kept changing while this update was being applied (the page or another call saved it). Retry. Nothing was changed.',
  }
}

/** Read, change: the ops over a state, nothing written. */
function applyOps(
  state: CcafState,
  update: CcafUpdate
): { state: CcafState; loggedMock: CcafMock | null } {
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

  return {
    state: {
      doneTaskIds: [...tasks],
      doneCheckIds: [...checks],
      confidence,
      mocks,
      examDate: update.examDate ?? state.examDate,
    },
    loggedMock,
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
