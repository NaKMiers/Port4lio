'use client'

import { memo } from 'react'

import Spinner from '@/components/settings/Spinner'
import type { QueueStatus } from '@/components/whiteboard/save-queue'
import type { LoadState } from '@/components/whiteboard/useBoard'
import { cn } from '@/lib/utils'

/**
 * The save pill next to the title (DR4): Loading N items / Saving / Saved / N not saved -
 * retry / Offline - changes kept / N unsaved. `aria-live="polite"`, so a screen reader hears
 * the state change without being interrupted by it.
 *
 * "N unsaved" is manual save (D31), and it is deliberately not the "Saving" spinner: with
 * auto-save off those writes are not on their way anywhere, and a spinner would say they
 * were. It is amber rather than rose because nothing has failed - the queue is doing exactly
 * what it was told - and the Save button beside it is the way out.
 *
 * Below sm the words go (screen-reader only) and the dot or spinner stays, with a count for
 * the two states that have one: the phone's top bar is one row (TopBar), and "Offline -
 * changes kept" alone was a third of it. Every state carries its own coloured dot so the
 * short form still says which one it is; the full words are the pill's `title`.
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

  // `label` is the words; `short` is what a phone keeps of them (see the header).
  let icon: React.ReactNode
  let label: string
  let short: string | null = null
  let tone = 'border-pp-line bg-white/80 text-pp-muted'
  let clickable = false
  const dot = (cls: string) => (
    <span className={cn('h-[7px] w-[7px] shrink-0 rounded-full', cls)} />
  )

  if (load.phase === 'loading') {
    icon = <Spinner size={12} />
    label = load.total ? `Loading ${load.total} items` : 'Loading'
  } else if (load.phase === 'error') {
    tone = 'border-pp-ink-rose/30 bg-pp-pink/10 text-pp-ink-rose'
    icon = dot('bg-pp-ink-rose')
    label = 'Not loaded'
  } else if (!status.online) {
    tone = 'border-pp-orange/30 bg-pp-orange/10 text-pp-ink-amber'
    icon = dot('bg-pp-ink-amber')
    label = 'Offline - changes kept'
  } else if (status.failing + rejected > 0) {
    tone = 'border-pp-ink-rose/30 bg-pp-pink/10 text-pp-ink-rose'
    clickable = true
    icon = dot('bg-pp-ink-rose')
    label = `${status.failing + rejected} not saved - retry`
    short = String(status.failing + rejected)
  } else if (status.holding) {
    // After the error branch on purpose: a refused write is the more urgent thing to say,
    // and it is not what the Save button next to this pill can fix.
    tone = 'border-pp-orange/30 bg-pp-orange/10 text-pp-ink-amber'
    icon = dot('bg-pp-ink-amber')
    label = `${status.pending} unsaved`
    short = String(status.pending)
  } else if (status.pending > 0) {
    icon = <Spinner size={12} />
    label = 'Saving'
  } else {
    icon = dot('bg-pp-green')
    label = 'Saved'
  }

  const content = (
    <>
      {icon}
      {/* sr-only rather than gone on a phone: still read out, and still the pill's text. */}
      <span className="max-sm:sr-only">{label}</span>
      {short ? (
        <span
          aria-hidden
          className="sm:hidden"
        >
          {short}
        </span>
      ) : null}
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
          title={label}
          data-testid="wb-save-pill"
        >
          {content}
        </button>
      ) : (
        <span
          className={cn(base, tone)}
          title={label}
          data-testid="wb-save-pill"
        >
          {content}
        </span>
      )}
    </span>
  )
}

export default memo(SavePill)
