'use client'

import { EyeOff, LayoutGrid, Sparkles } from 'lucide-react'
import Link from 'next/link'
import { memo, type ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * The 56px top bar (DR2): the way back to the hub, the title and save pill, then the hidden
 * chip, Backup, Agents and the one primary action, Export to AI.
 */
function TopBar({
  pill,
  hiddenCount,
  onHiddenClick,
  backup,
  agents,
  exportDisabled,
  exportOpen,
  onExport,
  compact,
  className,
}: {
  pill: ReactNode
  hiddenCount: number
  onHiddenClick: () => void
  backup: ReactNode
  agents: ReactNode
  exportDisabled: boolean
  exportOpen: boolean
  onExport: () => void
  /** Below md: icons only for the secondary buttons. */
  compact: boolean
  className?: string
}) {
  return (
    <header
      className={cn(
        'relative z-20 flex h-14 items-center gap-2 border-b border-pp-line bg-white/70 px-3 sm:gap-3 sm:px-4',
        className
      )}
    >
      <Link
        href="/admin"
        aria-label="All boards"
        title="All boards"
        className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-pp-line bg-white/85 text-pp-muted no-underline hover:text-pp-text"
      >
        <LayoutGrid
          aria-hidden
          size={16}
        />
      </Link>
      <h1 className="shrink-0 font-display text-[17px] font-semibold tracking-[-0.01em] text-pp-text">
        Whiteboard
      </h1>
      {pill}
      <div className="flex-1" />
      {hiddenCount > 0 ? (
        <button
          type="button"
          onClick={onHiddenClick}
          title="Items agents cannot read. Click to show them."
          aria-label={`${hiddenCount} hidden from AI`}
          className="hidden items-center gap-1.5 rounded-full border border-pp-line bg-white/80 px-2.5 py-1 font-display text-[10.5px] font-semibold uppercase tracking-[0.13em] text-pp-muted hover:text-pp-text md:inline-flex"
        >
          <EyeOff
            aria-hidden
            size={13}
          />
          {hiddenCount} hidden
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
