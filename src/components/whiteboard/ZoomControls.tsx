'use client'

import { useReactFlow, useViewport } from '@xyflow/react'
import { LocateFixed, Minus, Plus } from 'lucide-react'
import { memo } from 'react'

import { useReducedMotion } from '@/components/whiteboard/useTier'
import { cn } from '@/lib/utils'

/** Bottom-left zoom: -, the level (click for 100%), +, fit. Instant under reduced motion. */
function ZoomControls({ className }: { className?: string }) {
  const flow = useReactFlow()
  const { zoom } = useViewport()
  const reduced = useReducedMotion()
  const duration = reduced ? 0 : 200
  const btn =
    'grid h-8 min-w-8 place-items-center rounded-lg px-1 font-display text-[11px] font-semibold text-pp-muted hover:bg-pp-text/5 hover:text-pp-text'

  return (
    <div
      className={cn(
        'absolute bottom-3.5 left-3.5 z-10 flex gap-1 rounded-[14px] border border-pp-line bg-white/90 p-1',
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
    </div>
  )
}

export default memo(ZoomControls)
