'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import CcafOverview from '@/components/ccaf/CcafOverview'
import CcafPlan from '@/components/ccaf/CcafPlan'
import CcafRail from '@/components/ccaf/CcafRail'
import CcafReference from '@/components/ccaf/CcafReference'
import type { CcafMock, CcafState } from '@/lib/ccaf/progress'
import type { Locale } from '@/lib/i18n'
import { overallProgress } from '@/lib/ccaf/progress'

/**
 * The one stateful component on the page. Everything below it is presentational.
 *
 * ```
 *   server page ──▶ initialState ──▶ useState
 *                                      │  tick / rate / log
 *                                      ▼
 *                              mutate() ──▶ 800ms debounce ──▶ PUT /api/ccaf
 *                                                                    │
 *                                      setState(server's sanitised) ◀┘ (if no newer edit)
 * ```
 *
 * ## Why one owner instead of four islands
 *
 * The exam-day checklist sits visually in the reference section at the bottom of the page,
 * and the task list sits at the top, but both write the same document. Two islands would
 * mean two debounce timers racing to `PUT` the whole state, and the loser would overwrite
 * the winner with a copy that predates it. One owner, one timer, one writer.
 *
 * ## Why edits are still gated on a fetch, now that the page is owner-only
 *
 * `OwnerAuthGate` has already asked `/api/auth/me` by the time this renders, so in practice
 * the answer here is always yes and the read-only mode is unreachable from the route. It is
 * kept because the alternative is a component that assumes its own mounting conditions: the
 * controls describe what the viewer may do, and a component that takes that on faith is one
 * refactor away from offering edits to someone who cannot make them.
 *
 * The gate here only hides the controls. `PUT /api/ccaf` re-checks the cookie server-side;
 * that is the check that matters.
 */

const SAVE_DEBOUNCE_MS = 800

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'readonly'

export default function CcafTracker({
  initialState,
  locale,
}: {
  initialState: CcafState
  locale: Locale
}) {
  const [state, setState] = useState<CcafState>(initialState)
  const [editable, setEditable] = useState<boolean | null>(null)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')

  /**
   * Bumped on every local edit. A save echoes the sanitised state back, and applying that
   * echo is only safe while it is still the newest thing the user did - otherwise a slow
   * response lands on top of a tick made while it was in flight and silently undoes it.
   */
  const revision = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef<CcafState | null>(null)

  useEffect(() => {
    let alive = true
    const run = async () => {
      try {
        const res = await fetch('/api/auth/me')
        const data = await res.json()
        if (alive) setEditable(Boolean(data?.ok))
      } catch {
        if (alive) setEditable(false)
      }
    }
    void run()
    return () => {
      alive = false
    }
  }, [])

  const flush = useCallback(async () => {
    const next = pending.current
    if (!next) return
    pending.current = null
    const sentAt = revision.current
    setSaveStatus('saving')
    try {
      const res = await fetch('/api/ccaf', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: next }),
      })
      if (!res.ok) throw new Error(`PUT /api/ccaf ${res.status}`)
      const data = (await res.json()) as { state?: CcafState }
      if (data.state && revision.current === sentAt) setState(data.state)
      setSaveStatus('saved')
    } catch {
      setSaveStatus('error')
    }
  }, [])

  /**
   * Last-edit insurance. A debounce means the newest 800ms of work is only in memory, and
   * closing the tab on a ticked box that never saved is exactly the kind of loss that
   * makes someone stop trusting the page.
   */
  useEffect(() => {
    const onHide = () => {
      if (!pending.current) return
      if (timer.current) clearTimeout(timer.current)
      void flush()
    }
    window.addEventListener('pagehide', onHide)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      window.removeEventListener('pagehide', onHide)
      document.removeEventListener('visibilitychange', onHide)
    }
  }, [flush])

  const mutate = useCallback(
    (recipe: (current: CcafState) => CcafState) => {
      setState(current => {
        const next = recipe(current)
        if (!editable) return next
        revision.current += 1
        pending.current = next
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS)
        return next
      })
    },
    [editable, flush]
  )

  const toggleTask = useCallback(
    (taskId: string) =>
      mutate(current => {
        const done = new Set(current.doneTaskIds)
        if (done.has(taskId)) done.delete(taskId)
        else done.add(taskId)
        return { ...current, doneTaskIds: Array.from(done).sort() }
      }),
    [mutate]
  )

  const toggleCheck = useCallback(
    (checkId: string) =>
      mutate(current => {
        const done = new Set(current.doneCheckIds)
        if (done.has(checkId)) done.delete(checkId)
        else done.add(checkId)
        return { ...current, doneCheckIds: Array.from(done).sort() }
      }),
    [mutate]
  )

  const setConfidence = useCallback(
    (index: number, level: number) =>
      mutate(current => ({
        ...current,
        confidence: current.confidence.map((value, i) =>
          i === index ? level : value
        ),
      })),
    [mutate]
  )

  const setExamDate = useCallback(
    (examDate: string) => mutate(current => ({ ...current, examDate })),
    [mutate]
  )

  const addMock = useCallback(
    (mock: CcafMock) =>
      mutate(current => ({ ...current, mocks: [...current.mocks, mock] })),
    [mutate]
  )

  const removeMock = useCallback(
    (id: string) =>
      mutate(current => ({
        ...current,
        mocks: current.mocks.filter(mock => mock.id !== id),
      })),
    [mutate]
  )

  const progress = useMemo(
    () => overallProgress(state.doneTaskIds),
    [state.doneTaskIds]
  )

  const status: SaveStatus = editable === false ? 'readonly' : saveStatus

  return (
    <>
      <CcafOverview
        state={state}
        locale={locale}
        progress={progress}
        editable={editable === true}
        status={status}
        onExamDateChange={setExamDate}
      />
      <CcafPlan
        state={state}
        locale={locale}
        editable={editable === true}
        onToggleTask={toggleTask}
        rail={
          <CcafRail
            state={state}
            locale={locale}
            editable={editable === true}
            onConfidenceChange={setConfidence}
            onAddMock={addMock}
            onRemoveMock={removeMock}
          />
        }
      />
      <CcafReference
        locale={locale}
        doneCheckIds={state.doneCheckIds}
        editable={editable === true}
        onToggleCheck={toggleCheck}
      />
    </>
  )
}
