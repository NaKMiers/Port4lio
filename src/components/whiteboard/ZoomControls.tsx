'use client'

import { useReactFlow, useViewport } from '@xyflow/react'
import { LocateFixed, Lock, LockOpen, Minus, Plus } from 'lucide-react'
import { memo } from 'react'

import { useReducedMotion } from '@/components/whiteboard/useTier'
import { cn } from '@/lib/utils'

/**
 * Bottom-right view controls: -, the level (click for 100%), +, fit, and the board lock.
 * Instant under reduced motion.
 *
 * ```
 *   [-] [100%] [+] [fit] | [lock]
 * ```
 *
 * It sat bottom-left until the owner moved it (2026-09-25). The undo toast sits above it
 * rather than beside it (WhiteboardApp): on a phone the two are wider together than the board.
 *
 * The lock is a view setting, like the zoom beside it, not a property of any card: while it
 * is on the board only pans and zooms - nothing selects, moves, resizes, links or edits, and
 * no inspector opens - so a board can be looked over on a phone without a stray finger
 * dragging a card or throwing a sheet over it. `WhiteboardApp` owns what it switches off.
 * It is this tab's state only: no other viewer sees it and a reload drops it, so a board is
 * never found locked by someone who did not lock it.
 */
function ZoomControls({
  lock,
  className,
}: {
  /** No lock button without it (a view link is read-only already). */
  lock?: { on: boolean; onToggle: () => void; disabled?: boolean }
  className?: string
}) {
  const flow = useReactFlow()
  const { zoom } = useViewport()
  const reduced = useReducedMotion()
  const duration = reduced ? 0 : 200
  const btn =
    'grid h-11 min-w-11 place-items-center lg:h-8 lg:min-w-8 rounded-lg px-1 font-display text-[11px] font-semibold text-pp-muted hover:bg-pp-text/5 hover:text-pp-text disabled:cursor-not-allowed disabled:opacity-40'

  return (
    <div
      className={cn(
        'absolute bottom-3.5 right-3.5 z-10 flex gap-1 rounded-[14px] border border-pp-line bg-white/90 p-1',
        className
      )}
    >
      <button
        type="button"
        aria-label="Zoom out"
        className={btn}
        onClick={() => flow.zoomOut({ duration })}
      >
        <Minus size={14} />
      </button>
      <button
        type="button"
        aria-label="Reset zoom to 100%"
        className={cn(btn, 'w-12')}
        onClick={() => flow.zoomTo(1, { duration })}
      >
        {Math.round(zoom * 100)}%
      </button>
      <button
        type="button"
        aria-label="Zoom in"
        className={btn}
        onClick={() => flow.zoomIn({ duration })}
      >
        <Plus size={14} />
      </button>
      <button
        type="button"
        aria-label="Fit the board"
        className={btn}
        onClick={() => flow.fitView({ duration, padding: 0.15 })}
      >
        <LocateFixed size={14} />
      </button>
      {lock ? (
        <>
          <span
            aria-hidden
            className="my-1 w-px shrink-0 bg-pp-line"
          />
          <button
            type="button"
            aria-label="Lock the board"
            aria-pressed={lock.on}
            title={
              lock.on
                ? 'Unlock: select, move and edit again'
                : 'Lock: pan and zoom only, nothing selects or edits'
            }
            disabled={lock.disabled}
            data-testid="wb-lock"
            className={cn(
              btn,
              lock.on &&
                'bg-pp-text text-white hover:bg-pp-text hover:text-white'
            )}
            onClick={lock.onToggle}
          >
            {lock.on ? <Lock size={14} /> : <LockOpen size={14} />}
          </button>
        </>
      ) : null}
    </div>
  )
}

export default memo(ZoomControls)
