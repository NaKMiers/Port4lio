'use client'

import { Save } from 'lucide-react'
import { memo } from 'react'

import ToggleSwitch from '@/components/blog-admin/ToggleSwitch'
import { cn } from '@/lib/utils'

/**
 * Auto-save on/off, and the Save button that manual save needs (D31).
 *
 * ```
 *   auto-save ON   ┌ Auto-save [ON |off] ┐          the board saves itself, as it always did
 *   auto-save OFF  ┌ Auto-save [off| ON] ┐ [Save 3] every edit waits here until Save is pressed
 * ```
 *
 * ## Why the Save button is only rendered with auto-save off
 *
 * A Save button that does nothing most of the time teaches the owner that saving is their
 * job, which on this board it is not: with auto-save on, pressing it could only ever make
 * a debounced write go out ~600 ms sooner. Showing it exactly when it is the only way to
 * persist an edit keeps it meaning one thing. Cmd/Ctrl+S works in both modes anyway, because
 * that chord is muscle memory and must never fall through to the browser's own save dialog.
 *
 * Below md the switch lives in the top bar's More menu instead (`switchClassName`), and only
 * the Save button stays on the row: the switch is set once, Save is pressed after every edit.
 *
 * The count is the queue's pending jobs, which is writes and not edits: two titles typed on
 * one card coalesce into one queued PATCH, so "Save 1" after two edits is the truth about
 * what is about to be sent.
 */
export interface SaveControlsProps {
  autoSave: boolean
  onAutoSave: (on: boolean) => void
  onSave: () => void
  /** Queued writes waiting for the button. */
  pending: number
  /** The board is not ready (DR4): nothing to save, nothing to set. */
  disabled: boolean
}

function SaveControls({
  autoSave,
  onAutoSave,
  onSave,
  pending,
  disabled,
  switchClassName,
  className,
}: SaveControlsProps & {
  /** On the label and the switch, not the Save button (TopBar hides them below md). */
  switchClassName?: string
  className?: string
}) {
  return (
    <div
      className={cn('flex shrink-0 items-center gap-1.5 sm:gap-2', className)}
    >
      <span className={cn('flex items-center gap-2', switchClassName)}>
        <span
          id="wb-autosave-label"
          // Still in the DOM below xl: it names the switch (`aria-labelledby`).
          className="sr-only font-display text-[10.5px] font-semibold uppercase tracking-[0.13em] text-pp-muted xl:not-sr-only"
        >
          Auto-save
        </span>
        <ToggleSwitch
          id="wb-autosave"
          checked={autoSave}
          onChange={onAutoSave}
          disabled={disabled}
        />
      </span>
      {autoSave ? null : (
        <button
          type="button"
          onClick={onSave}
          disabled={disabled || pending === 0}
          title="Save now (Ctrl/Cmd+S)"
          data-testid="wb-save-now"
          aria-label={`Save${pending > 0 ? ` ${pending}` : ''}`}
          className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-full border border-pp-line bg-white/85 px-3 text-[12px] font-semibold text-pp-text transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Save
            aria-hidden
            size={14}
          />
          {/* Icon and count only on a phone (TopBar's one row). */}
          <span className="hidden md:inline">Save</span>
          {pending > 0 ? <span>{pending}</span> : null}
        </button>
      )}
    </div>
  )
}

export default memo(SaveControls)
