'use client'

import { EyeOff, LayoutGrid, Sparkles } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { memo, type ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * The top bar (DR2): the way back to the hub, the title, the save pill and the auto-save
 * controls, then the hidden chip, Backup and the one primary action, Export to AI.
 *
 * ## Responsive: two rows on a phone, one 56px row from md
 *
 * ```
 *   < md     [grid] [Title that truncates.......▾] [• SAVED]
 *            [OFF|ON] [Save 3]              [Archive] [Sparkles]
 *
 *   md-lg    [grid] [Title....▾] [• SAVED] [OFF|ON] [Save 3]  [Eye 3] [Archive] [Spark]
 *   lg       ...same, and "Export to AI" gets its label back (the primary action)
 *   xl       ...every label: AUTO-SAVE, "3 hidden", BACKUP ▾
 * ```
 *
 * Eight controls do not fit one row at 360px - nine were measured at 146px over with auto-save
 * off, and the icon-only Agents link that has left since was a fraction of that - and every one
 * is used on a phone, so the bar folds into two rows there rather than hiding any of them.
 * The two row wrappers are `md:contents`: from md they stop being boxes and their children
 * become the header's own flex items, so one DOM order serves both layouts and the spacer
 * does the same job in either.
 *
 * The title is the ONLY thing that shrinks: `flex-1` on its row below md, `min-w-0` inside
 * the switcher, and `shrink-0` + `whitespace-nowrap` on everything else. It used to carry a
 * fixed `max-w-[16rem]` with no `min-w-0`, so as the bar narrowed it could not give way and
 * was painted over by the pill - and on top of the Auto-save switch, whose clicks it then
 * swallowed. Labels step in by breakpoint (CSS, not the JS tier) so each width has one
 * source of truth.
 *
 * There is no Agents button. It was a link to `/admin/agents` once MCP tokens went site-wide,
 * and the admin hub already links there, so on the board it was a slot spent on a page that
 * has nothing to do with the canvas.
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
  exportDisabled,
  exportOpen,
  onExport,
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
  exportDisabled: boolean
  exportOpen: boolean
  onExport: () => void
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
        'relative z-20 flex flex-col gap-2 border-b border-pp-line bg-white/70 px-3 py-2 md:h-14 md:flex-row md:items-center md:gap-2 md:px-4 md:py-0 lg:gap-3',
        className
      )}
    >
      <div className="flex min-w-0 items-center gap-2 md:contents">
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
        <div className="flex min-w-0 flex-1 md:flex-initial">
          {boardSwitcher}
        </div>
        <div className="shrink-0">{pill}</div>
      </div>
      <div className="flex items-center gap-1.5 sm:gap-2 md:contents">
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
            className="hidden shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-pp-line bg-white/80 px-2.5 py-1 font-display text-[10.5px] font-semibold uppercase tracking-[0.13em] text-pp-muted hover:text-pp-text md:inline-flex"
          >
            <EyeOff
              aria-hidden
              size={13}
            />
            {boardHidden ? (
              <span className="hidden xl:inline">Board hidden</span>
            ) : (
              <>
                {hiddenCount}
                <span className="hidden xl:inline">hidden</span>
              </>
            )}
          </button>
        ) : null}
        {backup}
        <button
          type="button"
          disabled={exportDisabled}
          aria-expanded={exportOpen}
          onClick={onExport}
          title="Export to AI (Ctrl/Cmd+E)"
          aria-label="Export to AI"
          className="inline-flex min-h-[40px] shrink-0 items-center gap-2 whitespace-nowrap rounded-full bg-pp-text px-3 text-[12.5px] font-semibold text-white shadow-[0_18px_34px_rgba(17,17,17,0.18)] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 motion-reduce:transition-none motion-reduce:hover:translate-y-0 sm:px-4"
        >
          <Sparkles
            aria-hidden
            size={15}
          />
          <span className="hidden lg:inline">Export to AI</span>
        </button>
      </div>
    </header>
  )
}

export default memo(TopBar)
