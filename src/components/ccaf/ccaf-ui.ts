import type { TaskTag } from '@/lib/ccaf/roadmap'

/**
 * Class strings shared across the CCA-F page.
 *
 * Collected here for the same reason `settings-utils.ts` exists: five components draw the
 * same chip and the same progress bar, and a page whose chips disagree by two pixels reads
 * as unfinished. Nothing here is a component - these are strings, so callers can still
 * append to them.
 */

export const cx = (...parts: (string | undefined | false)[]) =>
  parts.filter(Boolean).join(' ')

export const eyebrowCls =
  'text-[11px] font-semibold uppercase tracking-[0.16em] text-pp-muted'

export const chipCls =
  'inline-flex items-center gap-1.5 rounded-full border border-pp-line bg-pp-panel-strong px-2.5 py-1 text-[11px] font-semibold text-pp-muted'

export const mutedMonoCls = 'font-mono text-[11px] text-pp-muted'

export const primaryBtnCls =
  'inline-flex min-h-[44px] items-center justify-center rounded-full bg-pp-text px-5 py-2.5 text-sm font-semibold text-[var(--pp-bg)] shadow-[0_16px_34px_rgba(17,17,17,0.18)] motion-safe:transition-[transform,box-shadow] motion-safe:duration-200 motion-safe:hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pp-blue disabled:cursor-not-allowed disabled:opacity-60 disabled:motion-safe:hover:translate-y-0'

export const secondaryBtnCls =
  'inline-flex min-h-[40px] items-center justify-center rounded-full border border-pp-line bg-pp-panel-strong px-4 py-2 text-sm font-semibold text-pp-text shadow-[0_8px_18px_rgba(46,35,28,0.05)] motion-safe:transition-transform motion-safe:duration-200 motion-safe:hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pp-blue disabled:cursor-not-allowed disabled:opacity-60 disabled:motion-safe:hover:translate-y-0'

export const fieldCls =
  'w-full rounded-xl border border-pp-line bg-pp-panel-strong/90 px-3 py-2 text-sm normal-case text-pp-text shadow-[0_1px_0_rgba(31,28,26,0.04)] outline-none transition-[border-color,box-shadow] placeholder:text-pp-muted/75 focus:border-pp-blue/35 focus:shadow-[0_0_0_3px_rgba(51,152,255,0.12)] disabled:cursor-not-allowed disabled:opacity-60'

export const fieldLabelCls =
  'block text-[11px] font-semibold uppercase tracking-[0.14em] text-pp-muted'

/**
 * Accent per domain, 1-indexed.
 *
 * The same five hues the portfolio already cycles through, pinned to a domain each rather
 * than rotating by position - a chip's colour has to mean "Agentic" everywhere on the page,
 * or the timeline and the readiness panel would disagree about what blue is.
 */
const DOMAIN_ACCENT = [
  'bg-pp-blue',
  'bg-pp-green',
  'bg-pp-violet',
  'bg-pp-pink',
  'bg-pp-orange',
] as const

export function domainAccentClass(domainKey: number): string {
  return DOMAIN_ACCENT[(domainKey - 1) % DOMAIN_ACCENT.length] ?? 'bg-pp-blue'
}

const DOMAIN_ACCENT_VAR = [
  'var(--pp-blue)',
  'var(--pp-green)',
  'var(--pp-violet)',
  'var(--pp-pink)',
  'var(--pp-orange)',
] as const

/** The same accent as a raw colour value, for inline gradients and SVG fills. */
export function domainAccentVar(domainKey: number): string {
  return (
    DOMAIN_ACCENT_VAR[(domainKey - 1) % DOMAIN_ACCENT_VAR.length] ??
    'var(--pp-blue)'
  )
}

/**
 * A range input that looks like it belongs to this page.
 *
 * An unstyled `<input type="range">` paints a browser-default track - dark grey on this
 * platform - which read as a third bar in a row that already had two, and put a control
 * chrome nobody chose next to hand-tuned panels. Styling it needs the vendor pseudo
 * elements: there is no standard selector for a range track or thumb.
 *
 * The caller supplies two custom properties on the element itself, because neither can be
 * expressed as a utility class:
 *
 *   --fill    how far along the track the filled portion runs, as a percentage
 *   --accent  the colour of that portion, so a row matches its segment in the strip above
 *
 * The thumb is a ring in the accent colour on the panel's own background rather than a
 * solid dark disc: at 5 rows it is the most repeated mark in the rail, and a filled dark
 * circle outweighed the track it is supposed to sit on. Its negative margin centres it on
 * a 6px track in WebKit, which measures the thumb against the track box, not the input.
 */
export const rangeCls = cx(
  'h-4 w-full cursor-pointer appearance-none bg-transparent',
  'disabled:cursor-not-allowed disabled:opacity-45',
  '[&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:rounded-full',
  '[&::-webkit-slider-runnable-track]:bg-[linear-gradient(to_right,var(--accent)_0_var(--fill),var(--pp-line)_var(--fill)_100%)]',
  '[&::-moz-range-track]:h-1.5 [&::-moz-range-track]:rounded-full',
  '[&::-moz-range-track]:bg-[linear-gradient(to_right,var(--accent)_0_var(--fill),var(--pp-line)_var(--fill)_100%)]',
  '[&::-webkit-slider-thumb]:-mt-[4px] [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5',
  '[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full',
  // `border-solid` is not optional here: preflight sets `border-style: solid` on `*`, and
  // `*` does not match a vendor pseudo-element - so a bare border-width renders nothing.
  '[&::-webkit-slider-thumb]:border-[3px] [&::-webkit-slider-thumb]:border-solid',
  '[&::-webkit-slider-thumb]:border-[color:var(--accent)]',
  '[&::-webkit-slider-thumb]:bg-pp-panel-strong [&::-webkit-slider-thumb]:shadow-[0_1px_3px_rgba(46,35,28,0.22)]',
  '[&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:appearance-none',
  '[&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-[3px]',
  '[&::-moz-range-thumb]:border-solid [&::-moz-range-thumb]:border-[color:var(--accent)]',
  '[&::-moz-range-thumb]:bg-pp-panel-strong',
  'focus-visible:outline-none',
  '[&:focus-visible::-webkit-slider-thumb]:ring-2 [&:focus-visible::-webkit-slider-thumb]:ring-pp-blue',
  '[&:focus-visible::-webkit-slider-thumb]:ring-offset-1',
  '[&:focus-visible::-moz-range-thumb]:ring-2 [&:focus-visible::-moz-range-thumb]:ring-pp-blue'
)

/** Tag chips borrow the domain accent; the two non-domain tags stay deliberately grey. */
export function tagAccentClass(tag: TaskTag): string {
  if (tag === 'm' || tag === 'a') return 'bg-pp-muted/50'
  return domainAccentClass(Number(tag.slice(1)))
}

/**
 * Where a percentage sits against the plan's gates: 80% to book the exam, 70% per domain.
 * Returned as a token rather than a class so callers can map it to text, dot or border.
 */
export type Band = 'good' | 'near' | 'low'

export function bandFor(percent: number): Band {
  if (percent >= 80) return 'good'
  if (percent >= 70) return 'near'
  return 'low'
}

export const BAND_TEXT: Record<Band, string> = {
  good: 'text-pp-green',
  near: 'text-pp-orange',
  low: 'text-pp-pink',
}

export const BAND_DOT: Record<Band, string> = {
  good: 'bg-pp-green',
  near: 'bg-pp-orange',
  low: 'bg-pp-pink',
}
