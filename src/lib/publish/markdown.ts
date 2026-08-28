/**
 * `|` and newlines break GFM table rows; a raw `<` invites the renderer to treat the cell
 * as HTML. Escaping is cheap insurance on text that is regenerated automatically.
 */
export function escapeMarkdownCell(value: string): string {
  return value
    .replace(/\|/g, '\\|')
    .replace(/[\r\n]+/g, ' ')
    .replace(/</g, '&lt;')
    .trim()
}

/**
 * A markdown link, but only for https destinations - a `javascript:` or `data:` URL never
 * reaches the README. Mirrors the https check already used by `projectOutboundLinks`.
 */
export function mdLink(label: string, url: string): string {
  const safeLabel = escapeMarkdownCell(label)
  if (!/^https:\/\//i.test(url.trim())) return safeLabel
  return `[${safeLabel}](${url.trim()})`
}

export function mdTable(headers: string[], rows: string[][]): string {
  const head = `| ${headers.map(escapeMarkdownCell).join(' | ')} |`
  const rule = `| ${headers.map(() => '---').join(' | ')} |`
  const body = rows.map(row => `| ${row.map(escapeMarkdownCell).join(' | ')} |`)
  return [head, rule, ...body].join('\n')
}

/** Joins sections with exactly one blank line and no trailing newline. */
export function joinSections(sections: (string | null | undefined)[]): string {
  return sections
    .map(section => (section ?? '').trim())
    .filter(Boolean)
    .join('\n\n')
}
