'use client'

/**
 * An on/off switch, for a setting that is genuinely a boolean.
 *
 * ```
 *   ┌────────┬────────┐
 *   │  OFF   │   ON   │        the pill is `AutoManualSwitch`'s, deliberately
 *   └────────┴────────┘
 * ```
 *
 * ## Why this is not `AutoManualSwitch` with different labels
 *
 * That component is a `role='radiogroup'`, and its own header explains why: "auto" and
 * "manual" are two NAMED states, neither of which is the absence of the other, so a screen
 * reader saying "auto, 1 of 2" is the honest reading.
 *
 * This is the other case. "Make every image and publish" is one thing that is either
 * happening or not, and `role='switch'` is the role built for exactly that - it announces
 * "make every image and publish, off", which is the setting and its state in one phrase. A
 * radiogroup here would announce a choice between two options where there is really one
 * question, and would put arrow-key navigation on a control that has nothing to navigate.
 *
 * The pill is copied from `AutoManualSwitch` on purpose rather than abstracted into a shared
 * one. They sit in the same dialog and must look like siblings; they are two different
 * controls and must behave like different controls. Sharing the markup would be one component
 * with a role prop, which is the shape that makes the accessibility decision above invisible
 * to whoever changes it next.
 */
export default function ToggleSwitch({
  id,
  checked,
  onChange,
  disabled = false,
}: {
  /** Used for `aria-labelledby`, pointing at the label element the caller renders. */
  id: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-labelledby={`${id}-label`}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={[
        'inline-flex shrink-0 items-center rounded-full border border-pp-line bg-white/70 p-0.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]',
        disabled ? 'cursor-not-allowed opacity-60' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {/*
        Both labels are always rendered, with the inactive one greyed - same as the pill next
        to it. A switch that shows only its current state reads as a button labelled with the
        thing that already happened, and "ON" alone is ambiguous about whether pressing it
        turns the setting on or reports that it is.

        `aria-hidden` on both: the `role='switch'` above already carries the label and the
        state, so leaving these readable would have a screen reader announce
        "make every image and publish, off, OFF ON".
      */}
      {(['off', 'on'] as const).map(value => {
        const active = checked === (value === 'on')
        return (
          <span
            key={value}
            aria-hidden
            className={[
              'rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] transition',
              active
                ? 'bg-pp-text text-white shadow-[0_6px_14px_rgba(17,17,17,0.18)]'
                : 'text-pp-muted',
            ].join(' ')}
          >
            {value}
          </span>
        )
      })}
    </button>
  )
}
