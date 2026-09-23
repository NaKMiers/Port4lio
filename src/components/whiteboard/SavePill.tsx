'use client'

import { memo } from 'react'

import Spinner from '@/components/settings/Spinner'
import type { QueueStatus } from '@/components/whiteboard/save-queue'
import type { LoadState } from '@/components/whiteboard/useBoard'
import { cn } from '@/lib/utils'

/**
 * The save pill next to the title (DR4): Loading N items / Saving / Saved / N not saved -
 * retry / Offline - changes kept. `aria-live="polite"`, so a screen reader hears the state
 * change without being interrupted by it.
 */
function SavePill({
  load,
  status,
  rejected,
  onRetry,
  className,
}: {
  load: LoadState
  status: QueueStatus
  rejected: number
  onRetry: () => void
  className?: string
}) {
  const base =
    'inline-flex min-h-[26px] items-center gap-1.5 rounded-full border px-2.5 py-1 font-display text-[10.5px] font-semibold uppercase tracking-[0.13em]'

  let content: React.ReactNode
  let tone = 'border-pp-line bg-white/80 text-pp-muted'
  let clickable = false

  if (load.phase === 'loading')
    content = (
      <>
        <Spinner size={12} />
        {load.total ? `Loading ${load.total} items` : 'Loading'}
      </>
    )
  else if (load.phase === 'error') {
    tone = 'border-pp-ink-rose/30 bg-pp-pink/10 text-pp-ink-rose'
    content = 'Not loaded'
  } else if (!status.online) {
    tone = 'border-pp-orange/30 bg-pp-orange/10 text-pp-ink-amber'
    content = 'Offline - changes kept'
  } else if (status.failing + rejected > 0) {
    tone = 'border-pp-ink-rose/30 bg-pp-pink/10 text-pp-ink-rose'
    clickable = true
    content = (
      <>
        <span className="h-[7px] w-[7px] rounded-full bg-pp-ink-rose" />
        {status.failing + rejected} not saved - retry
      </>
    )
  } else if (status.pending > 0)
    content = (
      <>
        <Spinner size={12} />
        Saving
      </>
    )
  else
    content = (
      <>
        <span className="h-[7px] w-[7px] rounded-full bg-pp-green" />
        Saved
      </>
    )

  return (
    <span
      aria-live="polite"
      className={className}
    >
      {clickable ? (
        <button
          type="button"
          onClick={onRetry}
          className={cn(base, tone, 'hover:bg-pp-pink/20')}
          data-testid="wb-save-pill"
        >
          {content}
        </button>
      ) : (
        <span
          className={cn(base, tone)}
          data-testid="wb-save-pill"
        >
          {content}
        </span>
      )}
    </span>
  )
}

export default memo(SavePill)
