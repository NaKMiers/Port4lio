import React from 'react'

/**
 * A second "add" affordance at the foot of a list, so a long list can be extended without
 * scrolling back up to the header button.
 *
 * Deliberately styled as a dashed full-width strip rather than a copy of the header's pill:
 * it reads as "the list continues here" instead of looking like a duplicate control. Callers
 * render it only when the list already has entries - next to an empty state it would just be
 * a second button with nothing between them.
 */
export default function AddMoreButton({
  label,
  onClick,
}: {
  label: string
  onClick: () => void
}) {
  return (
    <button
      type='button'
      onClick={onClick}
      className='w-full rounded-[1rem] border border-dashed border-pp-line bg-white/50 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-pp-muted transition hover:bg-white hover:text-pp-text'
    >
      {label}
    </button>
  )
}
