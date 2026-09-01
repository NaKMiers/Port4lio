const cx = (...parts: (string | undefined | false)[]) => parts.filter(Boolean).join(' ')

/**
 * Directional chevron for links and buttons.
 *
 * An SVG rather than the `&rarr;` / `&larr;` characters it replaces: those render in
 * whatever the font offers, so their weight and baseline drift between Montserrat, the
 * fallback face, and whatever a given platform substitutes - noticeably heavier than the
 * text beside them on some machines. This draws at `currentColor` and 1.75px, so it
 * inherits the link colour on hover and keeps one weight everywhere.
 *
 * `aria-hidden` always: the chevron repeats what the adjacent label already says, and a
 * screen reader announcing "right-pointing arrow" after "Take the test" is noise.
 */
export default function Chevron({
  direction = 'right',
  className,
}: {
  direction?: 'left' | 'right'
  className?: string
}) {
  return (
    <svg
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth={1.75}
      strokeLinecap='round'
      strokeLinejoin='round'
      className={cx('h-4 w-4 shrink-0', className)}
      aria-hidden
      focusable='false'
    >
      <path d={direction === 'right' ? 'M9 6l6 6-6 6' : 'M15 6l-6 6 6 6'} />
    </svg>
  )
}
