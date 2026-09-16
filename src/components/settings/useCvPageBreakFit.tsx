'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { CvFlowSheet } from '@/components/cv/CvSheets'
import { SHEET_WIDTH_PX } from '@/components/cv/cv-sheet-css'
import { updateResume } from '@/components/settings/resume-utils'
import { arimo } from '@/lib/cv-font'
import { fitResumePageBreak, resumeBreakOverflows } from '@/lib/resume-page-fit'
import { deriveResume, locateResumeItems } from '@/lib/resume-view-model'
import type { Profile, ResumePageBreak } from '@/types/profile'

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
 */
export function useCvPageBreakFit(
  profile: Profile,
  setProfile: React.Dispatch<React.SetStateAction<Profile>>
) {
  // `null` when idle. `onlyIfClipped` is how the on-open pass avoids touching a break the
  // owner chose deliberately - it repairs a clipping page and leaves a fitting one alone.
  const [pending, setPending] = useState<{ onlyIfClipped: boolean } | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const probeRef = useRef<HTMLDivElement | null>(null)

  // Matches what the preview and `/cv` render, so the measurement is of the real thing.
  const resume = useMemo(
    () => deriveResume({ resume: profile.resume }, profile.avatar),
    [profile.resume, profile.avatar]
  )

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

      if (pending.onlyIfClipped && !resumeBreakOverflows(sheet, limitPx, resume)) return

      const next = fitResumePageBreak(sheet, limitPx, locateResumeItems(resume))
      if (!next) return

      updateResume(setProfile, r =>
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
    } else {
      measure()
    }

    return () => {
      done = true
    }
  }, [pending, resume, setProfile])

  const portal =
    pending !== null && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={containerRef}
            className={`cv ${arimo.variable}`}
            aria-hidden
            style={{ position: 'fixed', left: -99999, top: 0, width: SHEET_WIDTH_PX }}
          >
            {/* Outside the sheet so it cannot affect the flow being measured. */}
            <div ref={probeRef} style={{ height: '297mm' }} />
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
