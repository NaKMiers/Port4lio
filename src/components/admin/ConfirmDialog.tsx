'use client'

import { useId, useRef, type ReactNode } from 'react'

import { useDialogFocus } from '@/components/admin/useDialogFocus'
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
 * it closes. The mechanics are `useDialogFocus`, including the busy case where every button
 * is disabled and the dialog itself holds focus.
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
  useDialogFocus(dialogRef, open, () => {
    if (!busy) onCancel()
  })

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(24,20,18,0.46)] p-4 backdrop-blur-sm">
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={busy || undefined}
        tabIndex={-1}
        className={cn(
          'w-full max-w-sm rounded-[1.9rem] border border-pp-line bg-[linear-gradient(180deg,rgba(255,255,255,0.88),rgba(255,250,246,0.8))] p-5 shadow-panel outline-none backdrop-blur-md',
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
