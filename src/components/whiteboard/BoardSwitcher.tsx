'use client'

import { Check, ChevronDown, EyeOff, LayoutGrid, Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'

import ToggleSwitch from '@/components/blog-admin/ToggleSwitch'
import Spinner from '@/components/settings/Spinner'
import { inputCls } from '@/components/settings/settings-utils'
import type { ClientBoard } from '@/lib/whiteboard/data'
import { cn } from '@/lib/utils'

/**
 * The board name in the top bar, the board's own settings, and the way to another board (D32).
 *
 * ```
 *   [ 2026 planning ▾ ]
 *      ├ [ 2026 planning      ]  rename in place: Enter or leaving the field saves it
 *      │ Agents can read  [ON ]  the same switch as the index card
 *      ├ ✓ 2026 planning         the one on screen
 *      │   Scratch      EyeOff   hidden from agents, said here rather than only on the index
 *      ├ + New board             lands on it straight away
 *      └ All boards              the index, where deleting lives
 * ```
 *
 * The name and the switch are plain PATCHes through `useBoards`, not the canvas save queue:
 * they are about the board, not anything on it, so auto-save being off (D31) does not hold
 * them and undo does not take them back. The switch is one click to reverse, which is why it
 * can live next to the canvas; the delete is not, which is why it stays on the index.
 *
 * ## Closing the panel with a rename half-typed
 *
 * An outside click or Esc closes the panel on `pointerdown`/`keydown`, and the input is
 * unmounted in the same event - before the browser moves focus, so `onBlur` never runs. Every
 * way of closing therefore goes through `close()`, which commits the draft first. Esc inside
 * the field is the exception: it puts the old name back, and a second Esc closes.
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
  onRename,
  onIncludeInAi,
  onLeave,
  className,
}: {
  boards: ClientBoard[]
  currentId: string
  title: string
  onCreate: () => Promise<string | null>
  onRename: (title: string) => Promise<void>
  onIncludeInAi: (on: boolean) => Promise<void>
  /** Runs a navigation off this board, asking first if anything would be lost by it. */
  onLeave: (go: () => void) => void
  className?: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const current = boards.find(board => board._id === currentId) ?? null

  // A ref as well as state: Esc reverts and then blurs in one handler, and the blur must see
  // the reverted draft, not the one captured by the render before it.
  const [draft, setDraftState] = useState('')
  const draftRef = useRef('')
  const setDraft = (value: string) => {
    draftRef.current = value
    setDraftState(value)
  }
  // The last name sent. Clicking a board in the list blurs the field and closes the panel,
  // and both commit - this is what makes the second one a no-op rather than a second PATCH.
  const sentRef = useRef('')
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)

  const commit = useCallback(async () => {
    if (!current) return
    const next = draftRef.current
    if (next === sentRef.current) return
    sentRef.current = next
    setSaving(true)
    setFailed(null)
    try {
      await onRename(next)
    } catch (e) {
      sentRef.current = current.title
      draftRef.current = current.title
      setDraftState(current.title)
      setFailed(e instanceof Error ? e.message : 'Could not rename it.')
    } finally {
      setSaving(false)
    }
  }, [current, onRename])

  const close = useCallback(() => {
    void commit()
    setOpen(false)
  }, [commit])

  const toggle = () => {
    if (open) return close()
    setDraft(current?.title ?? '')
    sentRef.current = current?.title ?? ''
    setFailed(null)
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    const onDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      // Esc peels one layer (DR9): this menu, and not also the canvas's next layer (an open
      // Export sheet, the selection), which listens on `window` - after `document`.
      event.stopPropagation()
      close()
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [close, open])

  const item =
    'flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-[13px] text-pp-text hover:bg-pp-text/5'

  return (
    <div
      ref={rootRef}
      // Below md the popover anchors to the header (TopBar), not to this button: on a phone the
      // title starts past the grid link, and a 20rem panel hung off it ran past the right edge.
      className={cn('min-w-0 md:relative', className)}
    >
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Board: ${title}. Rename or switch board`}
        onClick={toggle}
        data-testid="wb-board-switcher"
        className="flex min-w-0 max-w-full items-center gap-1.5 rounded-xl px-1.5 py-1 font-display text-[15px] font-semibold tracking-[-0.01em] text-pp-text hover:bg-pp-text/5 md:text-[17px]"
      >
        {/*
          `min-w-0` is what lets this give way as the bar narrows (TopBar's header). The cap
          from md only keeps a long name from pushing the save pill away from it.
        */}
        <span className="min-w-0 truncate md:max-w-[14rem] xl:max-w-[20rem]">
          {title}
        </span>
        {saving ? <Spinner size={12} /> : null}
        <ChevronDown
          aria-hidden
          size={14}
          className="shrink-0 text-pp-muted"
        />
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Board"
          data-testid="wb-board-panel"
          className="absolute left-0 top-[calc(100%+8px)] z-40 max-h-[70dvh] w-[min(20rem,calc(100vw-24px))] overflow-y-auto rounded-2xl border border-pp-line bg-pp-panel-strong p-1.5 shadow-panel max-md:left-2 max-md:right-2 max-md:w-auto"
        >
          {current ? (
            <div className="space-y-2 p-1.5 pb-2.5">
              <input
                value={draft}
                aria-label="Board name"
                placeholder="Untitled board"
                maxLength={200}
                onChange={event => setDraft(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') event.currentTarget.blur()
                  if (event.key === 'Escape') {
                    // Only the edit is undone; the panel and the canvas hear nothing.
                    event.stopPropagation()
                    setDraft(current.title)
                    event.currentTarget.blur()
                  }
                }}
                onBlur={() => void commit()}
                className={cn(inputCls, 'py-2 font-display font-semibold')}
              />
              {failed ? (
                <p className="px-1 text-[12px] text-pp-ink-rose">{failed}</p>
              ) : null}
              <div className="flex items-center justify-between gap-3 rounded-xl border border-pp-line bg-white/80 px-3 py-2.5">
                <div className="min-w-0">
                  <p
                    id="wb-switcher-ai-label"
                    className="text-[13px] font-semibold text-pp-text"
                  >
                    Agents can read this board
                  </p>
                  <p className="text-[11.5px] text-pp-muted">
                    {current.includeInAi
                      ? 'Its cards follow their own privacy switches.'
                      : 'Nothing on it reaches an export or an MCP call.'}
                  </p>
                </div>
                <ToggleSwitch
                  id="wb-switcher-ai"
                  checked={current.includeInAi}
                  onChange={on =>
                    void onIncludeInAi(on).catch((e: unknown) =>
                      setFailed(
                        e instanceof Error ? e.message : 'Could not change it.'
                      )
                    )
                  }
                />
              </div>
            </div>
          ) : null}

          <div
            role="menu"
            aria-label="Boards"
            className={cn(current && 'border-t border-pp-line pt-1.5')}
          >
            {boards.map(board => (
              <button
                key={board._id}
                type="button"
                role="menuitemradio"
                aria-checked={board._id === currentId}
                onClick={() => {
                  close()
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
                close()
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
                close()
                onLeave(() => router.push('/admin/whiteboard'))
              }}
              className={item}
            >
              <LayoutGrid size={14} />
              All boards
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
