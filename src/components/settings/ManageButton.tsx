'use client'

import { Settings } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * The gear beside a field label that opens the dialog managing that field's list (blog Kind
 * and Series, whiteboard Meaning and Status).
 *
 * Icon-only, so `label` is both its accessible name and its tooltip ("Manage kinds") - the
 * one place left that says what the gear does. The negative margin keeps the 24 px hit area
 * from making the label row taller than the label itself; the row centres it on the label.
 */
export default function ManageButton({
  label,
  onClick,
  className,
}: {
  label: string
  onClick: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        '-my-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-pp-muted transition hover:bg-pp-text/5 hover:text-pp-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pp-blue/30',
        className
      )}
    >
      <Settings
        aria-hidden
        size={14}
      />
    </button>
  )
}
