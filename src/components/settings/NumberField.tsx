'use client'

import React, { useState } from 'react'

/**
 * An integer input that lets you finish typing before it coerces.
 *
 * `value={n}` with `onChange={e => set(Number(e.target.value) || 0)}` reads harmlessly but
 * fights the user: clearing the box snaps it straight back to `0` so the old number can
 * never be replaced, and a leading `0` or `-` is normalised away mid-entry, which moves
 * the caret. Keeping the typed text local and committing a number alongside it means the
 * box shows what was typed while the profile still only ever holds a number.
 *
 * An empty box commits `0` - the schema has no concept of an absent stat value - but the
 * draft stays empty so it can be typed into.
 */
export default function NumberField({
  value,
  onChange,
  ...inputProps
}: {
  value: number
  onChange: (next: number) => void
} & Omit<React.ComponentProps<'input'>, 'value' | 'onChange' | 'type'>) {
  const [draft, setDraft] = useState(() => String(value))
  const [lastValue, setLastValue] = useState(value)

  if (value !== lastValue) {
    setLastValue(value)
    // Ignore our own commit echoing back; take anything else (e.g. a Save round-trip).
    if (Number(draft) !== value) {
      setDraft(String(value))
    }
  }

  return (
    <input
      {...inputProps}
      // Deliberately not `type='number'`: the spinner's own value normalisation is the
      // other half of the caret problem, and it rejects the intermediate states this
      // component exists to allow.
      type='text'
      inputMode='numeric'
      value={draft}
      onChange={event => {
        const text = event.target.value
        setDraft(text)
        const parsed = Number(text)
        onChange(text.trim() === '' || !Number.isFinite(parsed) ? 0 : parsed)
      }}
      onBlur={event => {
        // Settle on the stored value once editing stops, so a half-typed `-` or `1e` does
        // not linger as text that disagrees with the saved number.
        setDraft(String(value))
        inputProps.onBlur?.(event)
      }}
    />
  )
}
