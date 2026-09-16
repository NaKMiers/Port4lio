'use client'

import React from 'react'

import { useSectionOpen } from '@/components/settings/SectionOpenContext'

export default function Section({
  id,
  title,
  badge,
  handle,
  defaultOpen = false,
  children,
}: {
  /** Stable key the open/closed preference is stored under. */
  id: string
  title: string
  badge?: string
  /** Drag grip from a `DragList`, shown ahead of the title when the card is reorderable. */
  handle?: React.ReactNode
  /** Applies only until the section has been toggled once - see `SectionOpenProvider`. */
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const { isOpen, setOpen } = useSectionOpen()

  return (
    <details
      open={isOpen(id, defaultOpen)}
      onToggle={event => setOpen(id, event.currentTarget.open)}
      className='group overflow-hidden rounded-[1.75rem] border border-pp-line bg-white/72 shadow-panel backdrop-blur-md'
    >
      <summary className='cursor-pointer list-none px-5 py-5 sm:px-6'>
        <div className='flex flex-wrap items-center gap-3'>
          {handle}
          <div className='flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-pp-line bg-[linear-gradient(135deg,rgba(255,255,255,0.95),rgba(246,240,233,0.84))] shadow-[0_10px_24px_rgba(46,35,28,0.06)]'>
            <span className='h-2.5 w-2.5 rounded-full bg-[linear-gradient(135deg,var(--pp-blue),var(--pp-violet))]' />
          </div>
          <div className='min-w-0'>
            <div className='text-[11px] font-semibold uppercase tracking-[0.18em] text-pp-muted'>
              Portfolio editor
            </div>
            <div className='font-display text-lg font-semibold tracking-tight text-pp-text sm:text-xl'>
              {title}
            </div>
          </div>
          {badge ? (
            <span className='rounded-full border border-pp-line bg-white/78 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-pp-muted'>
              {badge}
            </span>
          ) : null}
          <div className='ml-auto flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-pp-muted'>
            <span className='hidden sm:inline'>Open section</span>
            <span className='relative block h-8 w-8 shrink-0 rounded-full border border-pp-line bg-white/86 shadow-[0_8px_16px_rgba(46,35,28,0.06)]'>
              <span className='absolute left-1/2 top-1/2 h-px w-3 -translate-x-1/2 -translate-y-1/2 bg-pp-text' />
              <span className='absolute left-1/2 top-1/2 h-3 w-px -translate-x-1/2 -translate-y-1/2 bg-pp-text transition-transform duration-200 group-open:scale-y-0' />
            </span>
          </div>
        </div>
      </summary>
      <div className='px-5 pb-5 sm:px-6 sm:pb-6'>
        <div className='mb-6 h-px bg-[linear-gradient(90deg,rgba(31,28,26,0.08),rgba(31,28,26,0.03),transparent)]' />
        {children}
      </div>
    </details>
  )
}

