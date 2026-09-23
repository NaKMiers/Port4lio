'use client'

import { useEffect, useId, useRef, type ReactNode } from 'react'

import {
  ghostBtnCls,
  secondaryBtnCls,
} from '@/components/settings/settings-utils'
import { cn } from '@/lib/utils'

/**
 * A small blocking confirm popup, styled after `IconPickerModal` - the only other overlay in
 * the codebase. Used before Delete on `/admin/blog`, which used to fire straight from the row
 * action with no way back, and by every destructive or privacy-changing step on
 * `/admin/whiteboard`.
 *
 * `message` is a `ReactNode` rather than a string, and it was widened for exactly one caller:
 * the permanent delete, whose warning is a count and a consequence rather than a sentence.
 * The element below is a `div` for the same reason - a `p` cannot legally contain the block
 * content a richer message wants, and an invalid nesting there is the kind of thing React
 * only complains about in development.
 *
 * ## The optional second action (DR6)
 *
 * Un-hiding a whiteboard frame is not a yes/no question: "N items inside become
 * agent-readable" has two real answers - [Make all readable] and [Keep items private] - plus
 * Cancel. `secondaryLabel` / `onSecondary` add that middle button without making every caller
 * think about it.
 *
 * ## Focus (DR9)
 *
 * It moved here from `blog-admin/` when the whiteboard needed it, and gained what a modal
 * owes a keyboard user on the way: focus moves into the dialog when it opens, Tab and
 * Shift+Tab stay inside it, Escape cancels, and focus goes back to whatever opened it when
 * it closes.
 */
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  secondaryLabel,
  onSecondary,
  busy = false,
  destructive = true,
  onConfirm,
  onCancel,
  className,
}: {
  open: boolean
  title: string
  message: ReactNode
  confirmLabel?: string
  secondaryLabel?: string
  onSecondary?: () => void
  busy?: boolean
  /** The confirm button is red by default. False for a non-destructive confirm. */
  destructive?: boolean
  onConfirm: () => void
  onCancel: () => void
  className?: string
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const titleId = useId()
  // Callers pass inline handlers; reading them through a ref keeps the focus effect tied to
  // open/close only, instead of re-running (and re-grabbing focus) on every parent render.
  const latest = useRef({ busy, onCancel })
  useEffect(() => {
    latest.current = { busy, onCancel }
  })

  useEffect(() => {
    if (!open) return
    const opener = document.activeElement as HTMLElement | null
    const dialog = dialogRef.current
    const focusables = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ) ?? []
      )
    // The last button is the confirm; start on Cancel so Enter is never destructive by accident.
    focusables()[0]?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        if (!latest.current.busy) latest.current.onCancel()
        return
      }
      if (event.key !== 'Tab') return
      const list = focusables()
      if (list.length === 0) return
      const first = list[0]
      const last = list[list.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      opener?.focus?.()
    }
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(24,20,18,0.46)] p-4 backdrop-blur-sm">
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          'w-full max-w-sm rounded-[1.9rem] border border-pp-line bg-[linear-gradient(180deg,rgba(255,255,255,0.88),rgba(255,250,246,0.8))] p-5 shadow-panel backdrop-blur-md',
          className
        )}
      >
        <h3
          id={titleId}
          className="font-display text-lg font-semibold tracking-tight text-pp-text"
        >
          {title}
        </h3>
        <div className="mt-1.5 text-sm leading-relaxed text-pp-muted">
          {message}
        </div>

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className={ghostBtnCls}
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
          {secondaryLabel && onSecondary ? (
            <button
              type="button"
              className={secondaryBtnCls}
              onClick={onSecondary}
              disabled={busy}
            >
              {secondaryLabel}
            </button>
          ) : null}
          <button
            type="button"
            className={cn(
              secondaryBtnCls,
              destructive &&
                'border-red-300 bg-red-50 text-red-700 hover:bg-red-100'
            )}
            onClick={onConfirm}
            disabled={busy}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
