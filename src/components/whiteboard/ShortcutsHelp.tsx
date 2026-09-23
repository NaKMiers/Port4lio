'use client'

import { X } from 'lucide-react'
import { useRef } from 'react'

import { useDialogFocus } from '@/components/admin/useDialogFocus'
import { cn } from '@/lib/utils'

export const SHORTCUT_LINES = [
  'V select \u00b7 T text \u00b7 L to-do \u00b7 R O D shapes',
  'F frame \u00b7 A arrow \u00b7 P pen \u00b7 E eraser',
  'Del delete \u00b7 Space+drag pan \u00b7 \u2318E export',
  'Enter edit \u00b7 arrows move 10px (Shift 50px) \u00b7 Esc back out',
]

/** The shortcut list, as the nothing-selected inspector shows it. */
export function ShortcutList({ className }: { className?: string }) {
  return (
    <ul className={cn('space-y-1.5 text-[12px] text-pp-muted', className)}>
      {SHORTCUT_LINES.map(line => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  )
}

/**
 * `?` opens this (DR9). Focus is held inside while it is open, and Esc or the close button
 * returns it to whatever opened it (`useDialogFocus`).
 */
export default function ShortcutsHelp({
  open,
  onClose,
  className,
}: {
  open: boolean
  onClose: () => void
  className?: string
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  useDialogFocus(ref, open, onClose)
  if (!open) return null
  return (
    <div
      className={cn(
        'fixed inset-0 z-[60] grid place-items-center bg-[rgba(24,20,18,0.3)] p-4',
        className
      )}
      onClick={onClose}
    >
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        onClick={event => event.stopPropagation()}
        className="w-full max-w-sm rounded-[1.4rem] border border-pp-line bg-pp-panel-strong p-5 shadow-panel outline-none"
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-base font-semibold">Shortcuts</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="grid h-11 w-11 place-items-center rounded-full text-pp-muted hover:text-pp-text lg:h-8 lg:w-8"
          >
            <X size={16} />
          </button>
        </div>
        <ShortcutList className="mt-3" />
      </div>
    </div>
  )
}
