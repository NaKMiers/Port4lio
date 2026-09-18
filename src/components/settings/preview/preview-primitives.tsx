import React from 'react'

/**
 * The shared vocabulary for the preview rail.
 *
 * The rail is a 380px column showing four different previews, so the pieces have to read
 * as one surface rather than four. Keeping the class strings here - instead of inline in
 * each panel, which is how the panel this replaces was written - is what stops them
 * drifting apart the next time one gets edited.
 */

export const previewEyebrowCls =
  'text-[10px] font-semibold uppercase tracking-[0.16em] text-pp-muted'

/** A titled run of preview content, with the count the public surface will render. */
export function PreviewBlock({
  title,
  count,
  children,
}: {
  title: string
  /** Rendered as a badge. Shown even at 0, so an empty section is visibly empty. */
  count?: number
  children: React.ReactNode
}) {
  return (
    <section className='space-y-2.5'>
      <div className='flex items-center gap-2'>
        <h3 className={previewEyebrowCls}>{title}</h3>
        {count !== undefined ? (
          <span className='rounded-full border border-pp-line bg-white/78 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-pp-muted'>
            {count}
          </span>
        ) : null}
        <span className='h-px flex-1 bg-[linear-gradient(90deg,rgba(31,28,26,0.1),transparent)]' />
      </div>
      {children}
    </section>
  )
}

export function PreviewCard({
  children,
  className = '',
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={`rounded-[1.1rem] border border-pp-line bg-white/74 p-3 shadow-[0_10px_20px_rgba(46,35,28,0.04)] ${className}`}
    >
      {children}
    </div>
  )
}

export function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className='inline-flex max-w-full break-words rounded-full border border-pp-line bg-white/82 px-2.5 py-1 text-[11px] font-medium leading-snug text-pp-text'>
      {children}
    </span>
  )
}

/** Shown where a section has nothing to render, so blank never reads as broken. */
export function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <p className='rounded-[0.9rem] border border-dashed border-pp-line bg-white/42 px-3 py-2 text-[11px] font-medium text-pp-muted'>
      {children}
    </p>
  )
}

/**
 * Says what the live site is holding back.
 *
 * The public page silently caps and drops things - the hero prints three stats, only the
 * first four projects are featured, a row missing every field is discarded. Without a note
 * saying so, a preview that mirrors the site faithfully looks like it lost your edit.
 */
export function CutoffNote({ children }: { children: React.ReactNode }) {
  return (
    <p className='flex gap-1.5 text-[11px] leading-relaxed text-pp-muted'>
      <span aria-hidden className='mt-[0.15rem] text-pp-orange'>
        ▲
      </span>
      <span>{children}</span>
    </p>
  )
}

/** `n` of `total` shown, when the public surface caps the list. */
export function limitNote(total: number, shown: number, where: string): string | null {
  if (total <= shown) return null
  return `${shown} of ${total} shown - ${where}`
}

/** How many rows the sanitizers dropped between the raw form and the live site. */
export function dropNote(rawCount: number, keptCount: number, needs: string): string | null {
  const dropped = rawCount - keptCount
  if (dropped <= 0) return null
  return `${dropped} row${dropped > 1 ? 's' : ''} hidden from the live site - each needs ${needs}.`
}
