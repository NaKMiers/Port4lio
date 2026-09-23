'use client'

import { Check, ChevronDown, EyeOff, LayoutGrid, Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import type { ClientBoard } from '@/lib/whiteboard/data'
import { cn } from '@/lib/utils'

/**
 * The board name in the top bar, and the way to another board (D32).
 *
 * ```
 *   [ 2026 planning ▾ ]
 *      ├ ✓ 2026 planning        the one on screen
 *      │   Scratch      EyeOff  hidden from agents, said here rather than only on the index
 *      ├ + New board            lands on it straight away
 *      └ All boards             the index, where renaming and deleting live
 * ```
 *
 * Switching is a navigation, not a state change: each board is its own URL, so the back
 * button works, a board can be bookmarked, and the canvas remounts - which is what keeps one
 * board's save queue, undo history and unsaved writes from ever reaching another board.
 *
 * That remount is also why all three exits here go through `onLeave` rather than pushing
 * straight away: unmounting the canvas stops its queue, and with auto-save off (D31) it
 * sends nothing on the way out, so a held write would be gone without a word. "New board"
 * asks BEFORE creating, so cancelling does not leave an empty board behind.
 */
export default function BoardSwitcher({
  boards,
  currentId,
  title,
  onCreate,
  onLeave,
  className,
}: {
  boards: ClientBoard[]
  currentId: string
  title: string
  onCreate: () => Promise<string | null>
  /** Runs a navigation off this board, asking first if anything would be lost by it. */
  onLeave: (go: () => void) => void
  className?: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
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

  const item =
    'flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-[13px] text-pp-text hover:bg-pp-text/5'

  return (
    <div
      ref={rootRef}
      className={cn('relative min-w-0', className)}
    >
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Board: ${title}. Switch board`}
        onClick={() => setOpen(!open)}
        data-testid="wb-board-switcher"
        className="flex min-w-0 items-center gap-1.5 rounded-xl px-1.5 py-1 font-display text-[17px] font-semibold tracking-[-0.01em] text-pp-text hover:bg-pp-text/5"
      >
        <span className="max-w-[9rem] truncate sm:max-w-[16rem]">{title}</span>
        <ChevronDown
          aria-hidden
          size={14}
          className="shrink-0 text-pp-muted"
        />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute left-0 top-[calc(100%+8px)] z-40 max-h-[60dvh] w-72 overflow-y-auto rounded-2xl border border-pp-line bg-pp-panel-strong p-1.5 shadow-panel"
        >
          {boards.map(board => (
            <button
              key={board._id}
              type="button"
              role="menuitemradio"
              aria-checked={board._id === currentId}
              onClick={() => {
                setOpen(false)
                if (board._id !== currentId)
                  onLeave(() => router.push(`/admin/whiteboard/${board._id}`))
              }}
              className={item}
            >
              <Check
                aria-hidden
                size={14}
                className={cn(
                  'shrink-0',
                  board._id === currentId ? 'text-pp-green' : 'opacity-0'
                )}
              />
              <span className="min-w-0 flex-1 truncate">
                {board.title || 'Untitled board'}
              </span>
              {board.includeInAi ? null : (
                <EyeOff
                  aria-label="Hidden from agents"
                  size={13}
                  className="shrink-0 text-pp-muted"
                />
              )}
              <span className="shrink-0 text-[11px] text-pp-muted">
                {board.items}
              </span>
            </button>
          ))}

          <div className="my-1 h-px bg-pp-line" />
          {/*
            The menu closes on the click, before the create runs, so there is no spinner to
            show and no second click to guard against - what follows is either the leaving
            dialog or a navigation to the new board.
          */}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              onLeave(async () => {
                const id = await onCreate()
                if (id) router.push(`/admin/whiteboard/${id}`)
              })
            }}
            className={item}
          >
            <Plus size={14} />
            New board
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              onLeave(() => router.push('/admin/whiteboard'))
            }}
            className={item}
          >
            <LayoutGrid size={14} />
            All boards
          </button>
        </div>
      ) : null}
    </div>
  )
}
