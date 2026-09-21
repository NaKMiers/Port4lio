'use client'

import React, { useRef, useState } from 'react'

import {
  MAX_RAIL_WIDTH,
  MIN_RAIL_WIDTH,
} from '@/components/settings/useRailWidth'

/** One arrow press. Coarse enough to get somewhere, fine enough to land on a width. */
const KEYBOARD_STEP = 24

/**
 * The grab bar between the editor column and the preview rail.
 *
 * Pointer events rather than mouse events, with capture taken on the handle: the pointer
 * regularly leaves this 12px strip mid-drag, and capture is what keeps the moves coming
 * instead of the drag dying the moment the cursor crosses into the preview.
 *
 * Width is measured from the container's right edge rather than accumulated from a delta,
 * so a drag that runs past a clamp and comes back tracks the cursor exactly instead of
 * drifting by however far it was clamped.
 *
 * Exposed as a `separator`, which is the role a resizer of a pane has, and driven by arrow
 * keys as well - dragging is not the only way anyone sizes a panel.
 */
export default function RailResizeHandle({
  width,
  onResize,
  onReset,
  containerRef,
}: {
  width: number
  onResize: (width: number, containerWidth: number) => void
  onReset: () => void
  /** The grid both columns live in. Its box is what the new width is measured against. */
  containerRef: React.RefObject<HTMLElement | null>
}) {
  const [dragging, setDragging] = useState(false)
  const handleRef = useRef<HTMLDivElement | null>(null)

  const containerBox = () =>
    containerRef.current?.getBoundingClientRect() ?? null

  /**
   * Capture is an optimisation, not a requirement - the drag still works from the handle
   * without it. `setPointerCapture` throws when the id is not an active pointer, and a
   * throw inside the handler would abandon the drag entirely, so it is never fatal here.
   */
  const capture = (pointerId: number, take: boolean) => {
    try {
      if (take) handleRef.current?.setPointerCapture(pointerId)
      else handleRef.current?.releasePointerCapture(pointerId)
    } catch {
      // No capture: pointermove still arrives while the cursor is over the handle.
    }
  }

  const applyFromPointer = (clientX: number) => {
    const box = containerBox()
    if (!box) return
    onResize(box.right - clientX, box.width)
  }

  const nudge = (delta: number) => {
    const box = containerBox()
    onResize(width + delta, box?.width ?? 0)
  }

  return (
    <div
      ref={handleRef}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the preview rail"
      aria-valuenow={Math.round(width)}
      aria-valuemin={MIN_RAIL_WIDTH}
      aria-valuemax={MAX_RAIL_WIDTH}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onPointerDown={event => {
        if (event.button !== 0) return
        event.preventDefault()
        capture(event.pointerId, true)
        setDragging(true)
      }}
      onPointerMove={event => {
        if (!dragging) return
        applyFromPointer(event.clientX)
      }}
      onPointerUp={event => {
        if (!dragging) return
        capture(event.pointerId, false)
        setDragging(false)
      }}
      onPointerCancel={() => setDragging(false)}
      onDoubleClick={onReset}
      onKeyDown={event => {
        // Left widens the rail: the rail is on the right, so its edge moves left.
        if (event.key === 'ArrowLeft') {
          event.preventDefault()
          nudge(KEYBOARD_STEP)
        } else if (event.key === 'ArrowRight') {
          event.preventDefault()
          nudge(-KEYBOARD_STEP)
        } else if (event.key === 'Home' || event.key === 'End') {
          event.preventDefault()
          onReset()
        }
      }}
      // `touch-none` stops the browser claiming the drag as a scroll gesture on a trackpad
      // or touchscreen, which would end the resize on the first move.
      className={`group absolute -left-4 top-0 hidden h-full w-4 cursor-col-resize touch-none select-none items-center justify-center xl:flex ${
        dragging ? 'cursor-col-resize' : ''
      }`}
    >
      <span
        className={`h-16 w-1.5 rounded-full transition ${
          dragging
            ? 'bg-pp-blue/70'
            : 'bg-pp-line group-hover:bg-pp-blue/45 group-focus-visible:bg-pp-blue/60'
        }`}
      />
      {/* While dragging, a full-screen overlay keeps the cursor from flickering to a text
          caret over the form fields the pointer is sweeping across. */}
      {dragging ? (
        <span className="fixed inset-0 z-[80] cursor-col-resize" />
      ) : null}
    </div>
  )
}
