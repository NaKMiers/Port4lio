import type { ReactNode } from 'react'

import { ghostBtnCls, secondaryBtnCls } from '@/components/settings/settings-utils'

/**
 * A small blocking confirm popup, styled after `IconPickerModal` - the only other overlay in
 * the codebase. Used before Delete on `/admin/blog`, which used to fire straight from the row
 * action with no way back.
 *
 * `message` is a `ReactNode` rather than a string, and it was widened for exactly one caller:
 * the permanent delete, whose warning is a count and a consequence rather than a sentence.
 * The element below is a `div` for the same reason - a `p` cannot legally contain the block
 * content a richer message wants, and an invalid nesting there is the kind of thing React
 * only complains about in development.
 */
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  message: ReactNode
  confirmLabel?: string
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  if (!open) return null

  return (
    <div className='fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(24,20,18,0.46)] p-4 backdrop-blur-sm'>
      <div className='w-full max-w-sm rounded-[1.9rem] border border-pp-line bg-[linear-gradient(180deg,rgba(255,255,255,0.88),rgba(255,250,246,0.8))] p-5 shadow-panel backdrop-blur-md'>
        <h3 className='font-display text-lg font-semibold tracking-tight text-pp-text'>{title}</h3>
        <div className='mt-1.5 text-sm leading-relaxed text-pp-muted'>{message}</div>

        <div className='mt-5 flex justify-end gap-2'>
          <button type='button' className={ghostBtnCls} onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type='button'
            className={`${secondaryBtnCls} border-red-300 bg-red-50 text-red-700 hover:bg-red-100`}
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
