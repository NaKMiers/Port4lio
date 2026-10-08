'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { CvFlowSheet } from '@/components/cv/CvSheets'
import { SHEET_WIDTH_PX } from '@/components/cv/cv-sheet-css'
import { arimo } from '@/lib/cv-font'
import { fitResumePageBreak, resumeBreakOverflows } from '@/lib/resume-page-fit'
import { deriveResume, locateResumeItems } from '@/lib/resume-view-model'
import type { Resume, ResumePageBreak } from '@/types/profile'

function samePageBreak(a: ResumePageBreak, b: ResumePageBreak): boolean {
  return (
    a.sectionIndex === b.sectionIndex &&
    a.projectIndex === b.projectIndex &&
    a.highlightsOnFirstSheet === b.highlightsOnFirstSheet
  )
}

/**
 * Re-picks {@link ResumePageBreak} by measuring the real sheets.
 *
 * Reordering changes how much copy sits above the break, so a coordinate chosen by hand
 * goes stale the moment a section moves. Rather than guess at a new index, this lays the
 * whole stream out offscreen at true A4 and asks where the page actually has to stop.
 *
 * `portal` must be rendered by the caller. It mounts only while a fit is in flight - the
 * measuring copy is a second full render of the CV, and there is no reason to keep it
 * alive between drags.
 *
 * Pass `onlyIfClipped` to repair a page that is overflowing and otherwise leave the stored
 * break exactly as it is. That is what the CV tab does on open, so a break saved before a
 * reorder - or by a build that predates this - stops rendering a clipped sheet.
 *
 * `onClippedRefit` fires when such a repair actually moved the break. The CV editor shows
 * "Page break re-fitted - Save CV to keep it" then (multi-cv-plan.md D9): the draft now
 * differs from the saved CV, and without the notice the owner would find a CV marked
 * unsaved that they never touched.
 */
export function useCvPageBreakFit(
  draft: Resume,
  avatar: string,
  setResume: React.Dispatch<React.SetStateAction<Resume>>,
  { onClippedRefit }: { onClippedRefit?: (next: ResumePageBreak) => void } = {}
) {
  // `null` when idle. `onlyIfClipped` is how the on-open pass avoids touching a break the
  // owner chose deliberately - it repairs a clipping page and leaves a fitting one alone.
  const [pending, setPending] = useState<{ onlyIfClipped: boolean } | null>(
    null
  )
  const containerRef = useRef<HTMLDivElement | null>(null)
  const probeRef = useRef<HTMLDivElement | null>(null)

  // Matches what the preview and `/cv` render, so the measurement is of the real thing.
  const resume = useMemo(
    () => deriveResume({ resume: draft }, avatar),
    [draft, avatar]
  )
  // A ref, so a caller's inline callback does not re-run the measuring effect.
  const refitRef = useRef(onClippedRefit)
  useEffect(() => {
    refitRef.current = onClippedRefit
  })

  useEffect(() => {
    if (!pending) return
    let done = false

    const measure = () => {
      if (done) return
      done = true
      setPending(null)

      const sheet = containerRef.current?.querySelector('section.sheet')
      const probe = probeRef.current
      if (!(sheet instanceof HTMLElement) || !probe) return

      // One page, read off the DOM rather than assumed from 96dpi.
      const limitPx = probe.getBoundingClientRect().height
      if (limitPx <= 0) return

      if (
        pending.onlyIfClipped &&
        !resumeBreakOverflows(sheet, limitPx, resume)
      )
        return

      const next = fitResumePageBreak(sheet, limitPx, locateResumeItems(resume))
      if (!next || samePageBreak(resume.pageBreak, next)) return

      if (pending.onlyIfClipped && refitRef.current) refitRef.current(next)
      else
        setResume(r =>
          samePageBreak(r.pageBreak, next) ? r : { ...r, pageBreak: next }
        )
    }

    // The CV faces change every line height, so measuring before they land measures the
    // wrong document. Nothing here waits on a frame, though: `getBoundingClientRect` forces
    // layout on read, and a page that is not compositing - a background tab, a hidden pane -
    // never produces one, which would leave the fit permanently pending.
    const ready = document.fonts?.ready
    if (ready) {
      const fallback = window.setTimeout(measure, 600)
      void ready
        .then(() => {
          window.clearTimeout(fallback)
          measure()
        })
        .catch(() => {
          window.clearTimeout(fallback)
          measure()
        })
    } else measure()

    return () => {
      done = true
    }
  }, [pending, resume, setResume])

  const portal =
    pending !== null && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={containerRef}
            className={`cv ${arimo.variable}`}
            aria-hidden
            style={{
              position: 'fixed',
              left: -99999,
              top: 0,
              width: SHEET_WIDTH_PX,
            }}
          >
            {/* Outside the sheet so it cannot affect the flow being measured. */}
            <div
              ref={probeRef}
              style={{ height: '297mm' }}
            />
            <CvFlowSheet resume={resume} />
          </div>,
          document.body
        )
      : null

  const requestFit = useCallback(
    (options?: { onlyIfClipped?: boolean }) =>
      setPending({ onlyIfClipped: options?.onlyIfClipped ?? false }),
    []
  )

  return { requestFit, fitting: pending !== null, portal }
}
