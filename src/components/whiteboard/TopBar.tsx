'use client'

import {
  Archive,
  EyeOff,
  LayoutGrid,
  Link2,
  MoreHorizontal,
  Sparkles,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { memo, useEffect, useRef, useState, type ReactNode } from 'react'

import ToggleSwitch from '@/components/blog-admin/ToggleSwitch'
import SaveControls, {
  type SaveControlsProps,
} from '@/components/whiteboard/SaveControls'
import { cn } from '@/lib/utils'

/**
 * The top bar (DR2): the way back to the hub, the title, the save pill and the auto-save
 * controls, then the hidden chip, Backup and the one primary action, Export to AI.
 *
 * ## Responsive: one 48px row at every width
 *
 * ```
 *   < md     [grid] [Title that truncates.......▾] [•] [Save 3] [...]
 *                                                                ├ Export to AI
 *                                                                ├ Auto-save [OFF|ON]
 *                                                                ├ Share
 *                                                                ├ Backup
 *                                                                └ 3 hidden from AI
 *   md-lg    [grid] [Title....▾] [• SAVED] [OFF|ON] [Save 3]  [Eye 3] [Link] [Archive] [Spark]
 *   lg       ...same, and "Export to AI" gets its label back (the primary action)
 *   xl       ...every label: AUTO-SAVE, "3 hidden", SHARE, BACKUP ▾
 * ```
 *
 * A phone used to get two rows (~100px) so that none of the eight controls had to hide: they
 * do not fit one row at 360px - nine were measured at 146px over with auto-save off. The
 * canvas is the thing a phone is short of, so the bar is one row now and the controls that
 * are not pressed after every edit (Export to AI, the auto-save switch, Share, Backup, the
 * hidden chip) fold into the "More" menu below md, Export first. Save and the pill stay on
 * the row: they are what an edit is followed by. (Export stayed on the row at first; the
 * owner moved it into the menu on 2026-09-25.) From the menu it opens the same full-canvas
 * sheet the button did, and Cmd/Ctrl+E still works. Share and Backup keep their own panels -
 * the More item only opens them, and below md those panels already anchor to the header
 * (their roots are not positioned there), so they land where they always did.
 *
 * The title is the ONLY thing that shrinks: `flex-1` on its wrapper, `min-w-0` inside the
 * switcher, and `shrink-0` + `whitespace-nowrap` on everything else. It used to carry a
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
  save,
  hiddenCount,
  boardHidden,
  onHiddenClick,
  backup,
  onOpenBackup,
  share,
  onOpenShare,
  exportDisabled,
  exportOpen,
  onExport,
  onLeave,
  className,
}: {
  pill: ReactNode
  /** The board's name, and the way to another one (D32). */
  boardSwitcher: ReactNode
  /** Auto-save and the manual Save (SaveControls). None on a view link. */
  save?: SaveControlsProps
  hiddenCount: number
  /** The whole board is hidden from agents, which the chip says instead of a count. */
  boardHidden: boolean
  onHiddenClick: () => void
  /** Owner only. Its trigger hides below md, where the More menu opens it (`onOpenBackup`). */
  backup?: ReactNode
  onOpenBackup?: () => void
  /** The owner's Share menu, or a visitor's Copy link. */
  share: ReactNode
  /** The owner's Share from the More menu below md. A visitor's Copy link stays on the row. */
  onOpenShare?: () => void
  exportDisabled?: boolean
  exportOpen?: boolean
  /** Owner only: no button without it. */
  onExport?: () => void
  /**
   * Runs a navigation off the board, asking first if anything would be lost by it (see the
   * header). Every exit goes through it, here and in the switcher. Owner only: without it
   * there is no way back to the hub, because a visitor has no hub.
   */
  onLeave?: (go: () => void) => void
  className?: string
}) {
  const router = useRouter()
  const hiddenLabel = boardHidden
    ? 'Board hidden from AI'
    : `${hiddenCount} hidden from AI`
  return (
    <header
      className={cn(
        'relative z-20 flex h-12 items-center gap-1.5 border-b border-pp-line bg-white/70 px-2 sm:gap-2 md:px-3 lg:gap-2.5',
        className
      )}
    >
      {onLeave ? (
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
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-pp-line bg-white/85 text-pp-muted no-underline hover:text-pp-text"
        >
          <LayoutGrid
            aria-hidden
            size={16}
          />
        </Link>
      ) : null}
      <div className="flex min-w-0 flex-1 md:flex-initial">{boardSwitcher}</div>
      <div className="shrink-0">{pill}</div>
      {save ? (
        <SaveControls
          {...save}
          switchClassName="max-md:hidden"
          // With the switch gone the box would be empty and still take a gap.
          className="max-md:contents"
        />
      ) : null}
      <div className="hidden flex-1 md:block" />
      {hiddenCount > 0 ? (
        <button
          type="button"
          onClick={onHiddenClick}
          title={
            boardHidden
              ? 'This whole board is hidden from agents. Click to show what is on it.'
              : 'Items agents cannot read. Click to show them.'
          }
          aria-label={hiddenLabel}
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
      {share}
      {backup}
      {onExport ? (
        <button
          type="button"
          disabled={exportDisabled}
          aria-expanded={exportOpen}
          onClick={onExport}
          title="Export to AI (Ctrl/Cmd+E)"
          aria-label="Export to AI"
          className="inline-flex h-9 min-w-9 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full bg-pp-text px-2.5 text-[12.5px] font-semibold text-white shadow-[0_12px_26px_rgba(17,17,17,0.16)] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 motion-reduce:transition-none motion-reduce:hover:translate-y-0 max-md:hidden lg:px-4"
        >
          <Sparkles
            aria-hidden
            size={15}
          />
          <span className="hidden lg:inline">Export to AI</span>
        </button>
      ) : null}
      <MoreMenu
        onExport={onExport}
        exportDisabled={exportDisabled}
        save={save}
        onOpenShare={onOpenShare}
        onOpenBackup={onOpenBackup}
        hidden={
          hiddenCount > 0
            ? { label: hiddenLabel, onClick: onHiddenClick }
            : null
        }
      />
    </header>
  )
}

/**
 * Below md only: the controls a phone's one row has no room for (see the header). Renders
 * nothing when it would be empty - a view link has no export, auto-save, Share or Backup.
 */
function MoreMenu({
  onExport,
  exportDisabled,
  save,
  onOpenShare,
  onOpenBackup,
  hidden,
}: {
  onExport?: () => void
  exportDisabled?: boolean
  save?: SaveControlsProps
  onOpenShare?: () => void
  onOpenBackup?: () => void
  hidden: { label: string; onClick: () => void } | null
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as HTMLElement))
        setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!onExport && !save && !onOpenShare && !onOpenBackup && !hidden)
    return null

  const item =
    'flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[13px] text-pp-text hover:bg-pp-text/5'
  const pick = (run: () => void) => () => {
    setOpen(false)
    run()
  }

  return (
    // Not positioned: the panel anchors to the header, like Share's and Backup's below md.
    <div
      ref={rootRef}
      className="md:hidden"
    >
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More"
        title="More"
        onClick={() => setOpen(value => !value)}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-pp-line bg-white/85 text-pp-text"
      >
        <MoreHorizontal
          aria-hidden
          size={16}
        />
      </button>
      {open ? (
        <div
          role="menu"
          aria-label="More"
          className="absolute right-2 top-[calc(100%+8px)] z-40 w-64 rounded-2xl border border-pp-line bg-pp-panel-strong p-1.5 shadow-panel"
        >
          {onExport ? (
            <button
              type="button"
              role="menuitem"
              disabled={exportDisabled}
              onClick={pick(onExport)}
              className={cn(
                item,
                'font-semibold disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent'
              )}
            >
              <Sparkles
                aria-hidden
                size={15}
              />
              Export to AI
            </button>
          ) : null}
          {save ? (
            <div className="flex items-center justify-between gap-3 px-3 py-2">
              <span
                id="wb-autosave-menu-label"
                className="text-[13px] text-pp-text"
              >
                Auto-save
              </span>
              <ToggleSwitch
                id="wb-autosave-menu"
                checked={save.autoSave}
                onChange={save.onAutoSave}
                disabled={save.disabled}
              />
            </div>
          ) : null}
          {onOpenShare ? (
            <button
              type="button"
              role="menuitem"
              onClick={pick(onOpenShare)}
              className={item}
            >
              <Link2
                aria-hidden
                size={15}
              />
              Share
            </button>
          ) : null}
          {onOpenBackup ? (
            <button
              type="button"
              role="menuitem"
              onClick={pick(onOpenBackup)}
              className={item}
            >
              <Archive
                aria-hidden
                size={15}
              />
              Backup
            </button>
          ) : null}
          {hidden ? (
            <button
              type="button"
              role="menuitem"
              onClick={pick(hidden.onClick)}
              className={item}
            >
              <EyeOff
                aria-hidden
                size={15}
              />
              {hidden.label}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export default memo(TopBar)
