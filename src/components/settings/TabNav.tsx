'use client'

import React from 'react'

export type TabItem = {
  id: string
  label: string
  /** Small count shown after the label, e.g. number of sections in the group. */
  count?: number
  /** Renders an attention dot on the pill - used by /publish for out-of-date targets. */
  flagged?: boolean
}

const baseCls =
  'relative rounded-full px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] transition'
const idleCls =
  'border border-pp-line bg-white/82 text-pp-muted shadow-[0_10px_24px_rgba(46,35,28,0.05)] hover:-translate-y-0.5 hover:bg-white hover:text-pp-text'
const activeCls =
  'bg-pp-text text-white shadow-[0_16px_30px_rgba(17,17,17,0.16)]'

/**
 * Pill tab bar in the same vocabulary as the toolbar badges, so the page keeps its look
 * while trading one very long column for a few short ones.
 */
export default function TabNav({
  tabs,
  activeId,
  onChange,
  ariaLabel,
}: {
  tabs: TabItem[]
  activeId: string
  onChange: (id: string) => void
  ariaLabel: string
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="bg-white/62 mb-6 flex flex-wrap items-center gap-2.5 rounded-[1.6rem] border border-pp-line p-2.5 shadow-[0_14px_30px_rgba(46,35,28,0.05)] backdrop-blur-md"
    >
      {tabs.map(tab => {
        const active = tab.id === activeId
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            className={`${baseCls} ${active ? activeCls : idleCls}`}
            onClick={() => onChange(tab.id)}
          >
            {tab.label}
            {typeof tab.count === 'number' ? (
              <span
                className={
                  active ? 'ml-2 text-white/60' : 'ml-2 text-pp-muted/60'
                }
              >
                {tab.count}
              </span>
            ) : null}
            {tab.flagged ? (
              <span
                aria-hidden="true"
                className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-pp-orange shadow-[0_0_0_2px_rgba(255,255,255,0.9)]"
              />
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
