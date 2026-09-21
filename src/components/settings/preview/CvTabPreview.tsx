'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import CvSheets from '@/components/cv/CvSheets'
import {
  CV_PREVIEW_PRINT_CSS,
  SHEET_WIDTH_PX,
} from '@/components/cv/cv-sheet-css'
import { arimo } from '@/lib/cv-font'
import { deriveResume } from '@/lib/resume-view-model'
import type { Profile, Resume } from '@/types/profile'

/**
 * The printed CV, live, at whatever width the rail gives us.
 *
 * A summary would be useless here: the CV's whole difficulty is that it has fixed A4
 * geometry and `overflow: hidden`, so the only question worth answering while editing is
 * "does it still fit, and where does the page break land". That means rendering the real
 * sheets - the same {@link CvSheets} the public route uses - against unsaved state.
 *
 * Scaling uses `zoom` rather than `transform: scale` because zoom shrinks the layout box,
 * so the surrounding column collapses to the scaled height with no compensating maths. It
 * is also what `/cv` already does at narrow viewports.
 */

/** Floor, for the moment before the container has been measured. */
const MIN_SCALE = 0.2

/**
 * Never scale past true A4. Below `xl` the rail stacks full width, which is wider than a
 * sheet - blowing the page up past its printed size would misrepresent the one thing this
 * preview exists to show.
 */
const MAX_SCALE = 1

export default function CvTabPreview({
  profile,
  printing,
  startPrint,
  expanded,
  onCloseExpand,
}: {
  profile: Profile
  printing: boolean
  startPrint: () => void
  expanded: boolean
  onCloseExpand: () => void
}) {
  // Keyed on `resume` alone so typing in another tab cannot re-plan the sheets. `deriveResume`
  // returns the same reference when the photo is unchanged, so this stays stable.
  const resume = useMemo(
    () => deriveResume({ resume: profile.resume }, profile.avatar),
    [profile.resume, profile.avatar]
  )

  return (
    <div className="space-y-3">
      <ScaledSheets resume={resume} />

      <CvExpandOverlay
        resume={resume}
        open={expanded}
        onClose={onCloseExpand}
        onDownload={startPrint}
      />

      {/* Mounted only while printing, parked offscreen, and portaled to `document.body`.
          The sheets have to exist at true A4 with no zoom for the print stylesheet to hand
          the browser two exact pages, which the scaled preview above cannot provide. The
          portal matters too: nested under the settings page's ~8000px-tall layout, a merely
          hidden copy still occupies that height in the print flow, padding the PDF with
          blank pages. As a `document.body` sibling, `body.cv-printing` can `display: none`
          everything else outright instead of only hiding it. */}
      {printing
        ? createPortal(
            <div
              className={`cv-print-root cv ${arimo.variable}`}
              aria-hidden
              style={{
                position: 'fixed',
                left: -99999,
                top: 0,
                width: SHEET_WIDTH_PX,
              }}
            >
              <CvSheets resume={resume} />
            </div>,
            document.body
          )
        : null}
    </div>
  )
}

/**
 * Drives the browser's own print-to-PDF over the live sheets.
 *
 * There is no server-side PDF renderer in this project - `/cv` has always been "print this
 * page" - so this is the same mechanism, aimed at the editor's unsaved state instead of the
 * saved document. Both the stylesheet and the body class are added for the duration of one
 * print and then removed, so Ctrl+P on the rest of `/settings` behaves exactly as before.
 */
export function useCvPrint() {
  const [printing, setPrinting] = useState(false)

  useEffect(() => {
    if (!printing) return

    const style = document.createElement('style')
    style.textContent = CV_PREVIEW_PRINT_CSS
    document.head.appendChild(style)
    document.body.classList.add('cv-printing')

    let done = false
    const finish = () => {
      if (done) return
      done = true
      document.body.classList.remove('cv-printing')
      style.remove()
      setPrinting(false)
    }

    window.addEventListener('afterprint', finish)
    // One tick so the offscreen sheets are laid out before the dialog snapshots them.
    const timer = window.setTimeout(() => {
      try {
        window.print()
      } finally {
        // Chrome fires `afterprint`; browsers that do not would otherwise leave the class on.
        window.setTimeout(finish, 0)
      }
    }, 60)

    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('afterprint', finish)
      finish()
    }
  }, [printing])

  return { printing, startPrint: () => setPrinting(true) }
}

/**
 * Renders the sheets scaled to the container width, and reports any sheet whose content
 * has outgrown the page.
 *
 * The overflow check exists because clipping is silent: `.sheet` is a fixed 297mm with
 * `overflow: hidden`, so a line too many simply disappears off the bottom edge with nothing
 * on the public route to complain. The source comments point at an e2e spec for this, but
 * that file is not in the tree.
 */
function ScaledSheets({ resume }: { resume: Resume }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [scale, setScale] = useState(0)
  const [overflow, setOverflow] = useState<number[]>([])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // Measured straight away rather than waiting on the observer's first callback.
    // ResizeObserver delivers at the end of a frame, and a page that is not compositing -
    // `/settings` opened in a background tab, say - produces no frames, which would leave
    // the sheets hidden until something happened to resize them.
    const applyWidth = (width: number) => {
      if (width > 0)
        setScale(
          Math.min(MAX_SCALE, Math.max(MIN_SCALE, width / SHEET_WIDTH_PX))
        )
    }
    applyWidth(container.getBoundingClientRect().width)

    const observer = new ResizeObserver(entries => {
      applyWidth(entries[0]?.contentRect.width ?? 0)
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  const measureOverflow = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    const sheets = Array.from(container.querySelectorAll<HTMLElement>('.sheet'))
    // scrollHeight/clientHeight are layout values, so the comparison is zoom-invariant.
    // One pixel of tolerance keeps sub-pixel rounding from crying wolf.
    setOverflow(
      sheets.map(sheet =>
        Math.max(0, sheet.scrollHeight - sheet.clientHeight - 1)
      )
    )
  }, [])

  useEffect(() => {
    // Reading `scrollHeight` here forces layout, so this needs no frame either.
    measureOverflow()
    // The CV faces load async and change every line height, so measure again once they land.
    void document.fonts?.ready.then(measureOverflow).catch(() => {})
  }, [resume, scale, measureOverflow])

  const overflowing = overflow
    .map((amount, index) => ({ amount, sheet: index + 1 }))
    .filter(entry => entry.amount > 0)

  return (
    <div className="space-y-2.5">
      {overflowing.length > 0 ? (
        <div className="rounded-[1rem] border border-[rgba(163,49,47,0.2)] bg-[rgba(211,108,105,0.1)] px-3 py-2 text-[11px] leading-relaxed text-[#7f2f2f]">
          <span className="font-semibold">Content is being clipped.</span>{' '}
          {overflowing
            .map(
              entry =>
                `Sheet ${entry.sheet} overflows by about ${Math.round(entry.amount)}px`
            )
            .join('; ')}
          . The page is a fixed 297mm, so the excess is cut off rather than
          moved to a third sheet.
        </div>
      ) : null}

      <div
        ref={containerRef}
        className="overflow-hidden rounded-[0.6rem]"
      >
        {/* Explicit A4 width plus `zoom` gives a deterministic visual width of
            SHEET_WIDTH_PX * scale - a percentage width under zoom would resolve against the
            unscaled parent and shrink twice. Hidden until measured, so the unscaled sheets
            never flash at full size. */}
        <div
          className={`cv ${arimo.variable} mx-auto`}
          style={{
            width: SHEET_WIDTH_PX,
            zoom: scale || MIN_SCALE,
            visibility: scale ? 'visible' : 'hidden',
          }}
        >
          <CvSheets resume={resume} />
        </div>
      </div>

      <p className="text-center text-[10px] font-semibold uppercase tracking-[0.14em] text-pp-muted">
        2 sheets · A4 · {Math.round((scale || 0) * 100)}%
      </p>
    </div>
  )
}

/** Full-size, scrollable, on top of everything. Same sheets, just room to read them. */
function CvExpandOverlay({
  resume,
  open,
  onClose,
  onDownload,
}: {
  resume: Resume
  open: boolean
  onClose: () => void
  onDownload: () => void
}) {
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  // `overflow-auto`, not just vertical: the sheet is a fixed 210mm, so a viewport narrower
  // than that needs to pan sideways rather than clip the right margin.
  return (
    <div
      className="fixed inset-0 z-[300] overflow-auto bg-black/70 p-4 backdrop-blur-sm sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-label="Curriculum vitae preview"
      onClick={onClose}
    >
      <div className="mx-auto flex w-full max-w-[calc(210mm+2rem)] flex-col items-center gap-4">
        <div
          className="flex w-full justify-end gap-2"
          onClick={event => event.stopPropagation()}
        >
          <button
            type="button"
            className="rounded-full bg-white px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-pp-text shadow-[0_12px_28px_rgba(0,0,0,0.24)]"
            onClick={onDownload}
          >
            Download PDF
          </button>
          <button
            type="button"
            className="rounded-full bg-white px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-pp-text shadow-[0_12px_28px_rgba(0,0,0,0.24)]"
            onClick={onClose}
          >
            Close (Esc)
          </button>
        </div>

        {/* Stops a click on the sheets from reaching the backdrop's close handler. */}
        <div
          className={`cv ${arimo.variable} w-full`}
          onClick={event => event.stopPropagation()}
          style={{ maxWidth: SHEET_WIDTH_PX }}
        >
          <CvSheets resume={resume} />
        </div>
      </div>
    </div>
  )
}
