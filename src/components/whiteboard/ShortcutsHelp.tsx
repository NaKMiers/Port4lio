'use client'

import { X } from 'lucide-react'
import { useEffect, useRef } from 'react'

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

/** `?` opens this (DR9). Esc or the close button returns focus to the canvas. */
export default function ShortcutsHelp({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (open) ref.current?.focus()
  }, [open])
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-[rgba(24,20,18,0.3)] p-4"
      onClick={onClose}
    >
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        onClick={event => event.stopPropagation()}
        onKeyDown={event => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            onClose()
          }
        }}
        className="w-full max-w-sm rounded-[1.4rem] border border-pp-line bg-pp-panel-strong p-5 shadow-panel outline-none"
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-base font-semibold">Shortcuts</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="text-pp-muted hover:text-pp-text"
          >
            <X size={16} />
          </button>
        </div>
        <ShortcutList className="mt-3" />
      </div>
    </div>
  )
}
