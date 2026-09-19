'use client'

/**
 * The two-state switch on every row of `GenerateBlogDialog`.
 *
 * ```
 *   ┌────────┬────────┐        auto   → the input is not rendered at all
 *   │  AUTO  │ MANUAL │        manual → the input is rendered and focusable
 *   └────────┴────────┘
 * ```
 *
 * ## Why the input is removed rather than disabled
 *
 * "Only allow to edit when manual" has two readable implementations and one of them is a
 * worse form. A `disabled` input keeps a greyed box on screen carrying a value nobody chose,
 * next to a switch that says the value is being decided elsewhere - so the row shows two
 * answers at once and the wrong one is the more visually prominent. Removing it lets the
 * space say what auto actually means, which is what `autoNote` is for.
 *
 * A disabled control is also skipped by keyboard navigation and read inconsistently by
 * screen readers, so it is a row a keyboard user tabs past without learning anything.
 *
 * ## Why a radio group and not a checkbox
 *
 * Two named states, exactly one selected. `role='radiogroup'` gives arrow-key movement and
 * announces "auto, 1 of 2" - a checkbox would announce "manual, not checked", which is the
 * same information phrased as a negative about the option that is not selected.
 */
export default function AutoManualSwitch({
  id,
  mode,
  onChange,
  disabled = false,
}: {
  /** Used for the group's `aria-labelledby`, pointing at the field's own label element. */
  id: string
  mode: 'auto' | 'manual'
  onChange: (mode: 'auto' | 'manual') => void
  disabled?: boolean
}) {
  return (
    <span
      role='radiogroup'
      aria-labelledby={`${id}-label`}
      className='inline-flex shrink-0 items-center rounded-full border border-pp-line bg-white/70 p-0.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]'
    >
      {(['auto', 'manual'] as const).map(value => {
        const active = mode === value
        return (
          <button
            key={value}
            type='button'
            role='radio'
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(value)}
            className={[
              'rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] transition',
              active
                ? 'bg-pp-text text-white shadow-[0_6px_14px_rgba(17,17,17,0.18)]'
                : 'text-pp-muted hover:text-pp-text',
              disabled ? 'cursor-not-allowed opacity-60' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {value}
          </button>
        )
      })}
    </span>
  )
}
