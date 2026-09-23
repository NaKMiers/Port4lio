'use client'

import { EyeOff, LayoutGrid, Sparkles } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { memo, type ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * The 56px top bar (DR2): the way back to the hub, the title, the save pill and the
 * auto-save controls, then the hidden chip, Backup, Agents and the one primary action,
 * Export to AI.
 *
 * ## Leaving with work that has not been written
 *
 * `beforeunload` (useSaveQueue) covers a reload or a closed tab, and a client-side
 * navigation never fires it - so every way out of the board asks first instead. That is not
 * only this link: the board switcher beside it offers three more (another board, a new one,
 * the index), so the dialog lives in `WhiteboardApp` and both controls hand it the
 * navigation to run. It used to be `window.confirm` here, which was fine while the only
 * thing it guarded was a failed write; manual save (D31) makes "unsaved" an ordinary state
 * the owner chooses, so the question earns the app's own dialog, with the count in it and
 * Cancel as the safe way out.
 */
function TopBar({
  pill,
  boardSwitcher,
  saveControls,
  hiddenCount,
  boardHidden,
  onHiddenClick,
  backup,
  agents,
  exportDisabled,
  exportOpen,
  onExport,
  compact,
  onLeave,
  className,
}: {
  pill: ReactNode
  /** The board's name, and the way to another one (D32). */
  boardSwitcher: ReactNode
  hiddenCount: number
  /** The whole board is hidden from agents, which the chip says instead of a count. */
  boardHidden: boolean
  onHiddenClick: () => void
  backup: ReactNode
  agents: ReactNode
  exportDisabled: boolean
  exportOpen: boolean
  onExport: () => void
  /** Below md: icons only for the secondary buttons. */
  compact: boolean
  /**
   * Runs a navigation off the board, asking first if anything would be lost by it (see the
   * header). Every exit goes through it, here and in the switcher.
   */
  onLeave: (go: () => void) => void
  saveControls: ReactNode
  className?: string
}) {
  const router = useRouter()
  return (
    <header
      className={cn(
        'relative z-20 flex h-14 items-center gap-2 border-b border-pp-line bg-white/70 px-3 sm:gap-3 sm:px-4',
        className
      )}
    >
      <Link
        href="/admin/whiteboard"
        aria-label="All boards"
        title="All boards"
        onClick={event => {
          // Still a Link, so it can be opened in a new tab or copied; the guard only takes
          // over the plain click, which is the one that unmounts this canvas.
          event.preventDefault()
          onLeave(() => router.push('/admin/whiteboard'))
        }}
        className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-pp-line bg-white/85 text-pp-muted no-underline hover:text-pp-text lg:h-9 lg:w-9"
      >
        <LayoutGrid
          aria-hidden
          size={16}
        />
      </Link>
      {boardSwitcher}
      {pill}
      {saveControls}
      <div className="flex-1" />
      {hiddenCount > 0 ? (
        <button
          type="button"
          onClick={onHiddenClick}
          title={
            boardHidden
              ? 'This whole board is hidden from agents. Click to show what is on it.'
              : 'Items agents cannot read. Click to show them.'
          }
          aria-label={
            boardHidden
              ? 'Board hidden from AI'
              : `${hiddenCount} hidden from AI`
          }
          className="hidden items-center gap-1.5 rounded-full border border-pp-line bg-white/80 px-2.5 py-1 font-display text-[10.5px] font-semibold uppercase tracking-[0.13em] text-pp-muted hover:text-pp-text md:inline-flex"
        >
          <EyeOff
            aria-hidden
            size={13}
          />
          {boardHidden ? 'Board hidden' : `${hiddenCount} hidden`}
        </button>
      ) : null}
      {backup}
      {agents}
      <button
        type="button"
        disabled={exportDisabled}
        aria-expanded={exportOpen}
        onClick={onExport}
        title="Export to AI (Ctrl/Cmd+E)"
        className="inline-flex min-h-[40px] items-center gap-2 rounded-full bg-pp-text px-3 text-[12.5px] font-semibold text-white shadow-[0_18px_34px_rgba(17,17,17,0.18)] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 motion-reduce:transition-none motion-reduce:hover:translate-y-0 sm:px-4"
      >
        <Sparkles
          aria-hidden
          size={15}
        />
        <span className={cn(compact && 'sr-only')}>Export to AI</span>
      </button>
    </header>
  )
}

export default memo(TopBar)
