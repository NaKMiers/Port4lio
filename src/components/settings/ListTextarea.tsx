'use client'

import React, { useState } from 'react'

/**
 * The two parse/join pairs these list fields use: one entry per line, or entries
 * separated by commas as well as newlines.
 *
 * Both parses are lossy - they trim each entry and drop empty ones - which is exactly why
 * they belong to this component rather than to a plain `value`/`onChange` pair.
 */
export const linesToText = (lines: string[]) => lines.join('\n')
export const textToLines = (text: string) =>
  text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)

export const itemsToText = (items: string[]) => items.join(', ')
export const textToItems = (text: string) =>
  text
    .split(/[,\n]/)
    .map(item => item.trim())
    .filter(Boolean)

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

/**
 * A textarea that edits a `string[]` while keeping the user's raw text as the source of
 * truth for as long as they are typing.
 *
 * Binding `value={items.join(sep)}` directly is what broke editing here. The parse is
 * lossy - it trims each entry and drops empty ones - so the rejoined string never matches
 * what was just typed. React sees a `value` prop that disagrees with the DOM, overwrites
 * the DOM node, and the caret snaps to the end. Worse, the dropped characters became
 * untypable: the comma that creates a new entry, the newline that creates a new line, and
 * a trailing space all vanished on the same keystroke that produced them.
 *
 * Holding the raw draft locally and parsing only on the way out fixes both. Blank lines
 * and trailing separators now survive in the box and are discarded at save time, where
 * they were always meant to be discarded.
 */
export default function ListTextarea({
  value,
  onChange,
  parse,
  join,
  ...textareaProps
}: {
  value: string[]
  onChange: (next: string[]) => void
  parse: (text: string) => string[]
  join: (value: string[]) => string
} & Omit<React.ComponentProps<'textarea'>, 'value' | 'onChange'>) {
  const joined = join(value)
  const [draft, setDraft] = useState(joined)
  const [lastJoined, setLastJoined] = useState(joined)

  // Adjust state during render rather than in an effect, so no intermediate frame shows
  // the wrong text. See React's "adjusting state when a prop changes" pattern.
  if (joined !== lastJoined) {
    setLastJoined(joined)
    // Only accept a genuine external replacement, such as a Save round-trip.
    // When the incoming list is just our own parse coming back, the draft is the more
    // faithful copy and must win, otherwise it gets clobbered mid-keystroke.
    if (!sameList(parse(draft), value)) setDraft(joined)
  }

  return (
    <textarea
      {...textareaProps}
      value={draft}
      onChange={event => {
        setDraft(event.target.value)
        onChange(parse(event.target.value))
      }}
    />
  )
}
