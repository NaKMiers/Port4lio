'use client'

import { useId, useRef, useState } from 'react'

import { useDialogFocus } from '@/components/admin/useDialogFocus'
import {
  ghostBtnCls,
  helpTextCls,
  inputCls,
  labelCls,
  secondaryBtnCls,
} from '@/components/settings/settings-utils'
import { cn } from '@/lib/utils'
import { CV_LABEL_MAX } from '@/lib/upload-limits'

interface Props {
  open: boolean
  title: string
  /** Shown under the field, e.g. what a new CV starts from. */
  hint?: string
  confirmLabel: string
  initialLabel?: string
  /** Resolves to an error to show inline (a taken label, D6), or `null` to close. */
  onSubmit: (label: string) => Promise<string | null>
  onCancel: () => void
  className?: string
}

/**
 * Asks for a CV's name: New and Rename on the settings CV tab.
 *
 * Same shell as `ConfirmDialog` (focus trap, Escape, focus returned to the opener) with one
 * field in it. The server is the judge of uniqueness (the `labelKey` index), so a taken name
 * comes back as the 409's message and is shown here, under the field, with the dialog still
 * open and the text still in it - retyping one word must not mean reopening the dialog.
 *
 * The caller mounts it per opening (and keys it), so the field starts from `initialLabel`
 * every time without an effect copying props into state.
 */
export default function CvLabelDialog({
  open,
  title,
  hint,
  confirmLabel,
  initialLabel = '',
  onSubmit,
  onCancel,
  className,
}: Props) {
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const titleId = useId()
  const inputId = useId()
  const [label, setLabel] = useState(initialLabel)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useDialogFocus(dialogRef, open, () => {
    if (!busy) onCancel()
  })

  if (!open) return null

  const trimmed = label.trim()
  const valid = trimmed.length > 0 && trimmed.length <= CV_LABEL_MAX

  async function submit() {
    if (!valid || busy) return
    setBusy(true)
    setError(null)
    const failure = await onSubmit(trimmed)
    setBusy(false)
    if (failure) setError(failure)
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(24,20,18,0.46)] p-4 backdrop-blur-sm">
      <div
        ref={dialogRef}
        role="dialog"
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

        <form
          className="mt-3 space-y-2"
          onSubmit={event => {
            event.preventDefault()
            void submit()
          }}
        >
          <label
            htmlFor={inputId}
            className={labelCls}
          >
            CV name
          </label>
          <input
            id={inputId}
            className={inputCls}
            value={label}
            maxLength={CV_LABEL_MAX}
            placeholder="Frontend CV"
            disabled={busy}
            aria-invalid={error ? true : undefined}
            onChange={event => {
              setLabel(event.target.value)
              setError(null)
            }}
          />
          {error ? (
            <p
              role="alert"
              className="text-xs font-medium text-red-700"
            >
              {error}
            </p>
          ) : hint ? (
            <p className={helpTextCls}>{hint}</p>
          ) : null}

          <div className="flex flex-wrap justify-end gap-2 pt-3">
            <button
              type="button"
              className={ghostBtnCls}
              onClick={onCancel}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={secondaryBtnCls}
              disabled={busy || !valid}
            >
              {busy ? 'Saving...' : confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
