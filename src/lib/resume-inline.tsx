import type { ReactNode } from 'react'

const BOLD_RUN = /\*\*([\s\S]+?)\*\*/g

/**
 * Renders `**bold**` runs inside otherwise literal CV copy.
 *
 * Deliberately not markdown: the source only ever needs `<b>`, and the A4 grid is width
 * sensitive down to a tenth of a percent, so anything that could rewrite characters
 * (smart quotes, entity decoding, ligature substitution) is out of scope. An unmatched
 * `**` prints literally.
 *
 * Returns React nodes - never `dangerouslySetInnerHTML` - so owner-editable profile copy
 * is escaped by React's text path and cannot inject markup into this public route.
 *
 * The lazy `+?` quantifier is what preserves `**Description: **body` as
 * `<b>Description: </b>body`, trailing space included, matching the original PDF's runs.
 */
export function renderInlineBold(text: string): ReactNode[] {
  const out: ReactNode[] = []
  let cursor = 0
  let key = 0
  let match: RegExpExecArray | null

  BOLD_RUN.lastIndex = 0
  while ((match = BOLD_RUN.exec(text)) !== null) {
    if (match.index > cursor) out.push(text.slice(cursor, match.index))
    out.push(<b key={key++}>{match[1]}</b>)
    cursor = match.index + match[0].length
  }

  if (cursor < text.length) out.push(text.slice(cursor))
  return out
}

/** Same copy with the `**` markers removed. For length budgeting and plain-text output. */
export function stripInlineBold(text: string): string {
  return text.replace(BOLD_RUN, '$1')
}
