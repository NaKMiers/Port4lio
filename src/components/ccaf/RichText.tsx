import { Fragment, type ReactNode } from 'react'

import { LINKS } from '@/lib/ccaf/roadmap'

/**
 * Renders the tiny inline vocabulary used by the CCA-F content modules.
 *
 * Supports exactly four things, none of them nestable: `<strong>`, `<em>`, `<code>`, and
 * `{linkKey|label}` resolved against `LINKS`. Everything else is literal text.
 *
 * ## Why this is parsed and not `dangerouslySetInnerHTML`
 *
 * Two reasons, and the second is the one that actually forces it.
 *
 * The safety argument is the familiar one: the strings come from `lib/ccaf/*.ts` today,
 * and parsing means they still cannot carry markup the day somebody wires this component
 * to a field the profile editor writes.
 *
 * The load-bearing reason is that Tailwind has no base styles for bare elements. Injected
 * `<code>` and `<strong>` would arrive completely unstyled - browser-default monospace at
 * the wrong size, sitting on the wrong background - because no class ever touches them.
 * Producing the elements here is what lets each one carry `bg-pp-bg`, `text-pp-text` and
 * the rest of the editorial tokens.
 *
 * An unknown link key renders as its label alone rather than a dead `<a>`: a typo in a
 * content file should read as plain text, not as something clickable that goes nowhere.
 */

const TOKEN = /\{(\w+)\|([^}]+)\}|<(strong|em|code)>([\s\S]*?)<\/\3>/g

const CODE_CLASS =
  'rounded border border-pp-line bg-pp-bg/70 px-1 py-px font-mono text-[0.85em] text-pp-text'

const LINK_CLASS =
  'font-semibold text-pp-text underline decoration-pp-blue/40 underline-offset-[0.2em] hover:decoration-pp-blue'

/**
 * `&lt;` and `&gt;` are the only entities the content uses - they appear where a literal
 * angle bracket would otherwise look like one of the four tags above (`--resume &lt;name&gt;`).
 * A bare `&` is common and left alone.
 */
function decode(text: string): string {
  return text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}

export function renderRichText(source: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let cursor = 0
  let key = 0

  for (const match of Array.from(source.matchAll(TOKEN))) {
    const start = match.index ?? 0
    if (start > cursor) nodes.push(decode(source.slice(cursor, start)))
    cursor = start + match[0].length

    const [, linkKey, linkLabel, tag, inner] = match

    if (linkKey && linkLabel) {
      const href = LINKS[linkKey]
      if (!href) {
        nodes.push(decode(linkLabel))
        continue
      }
      nodes.push(
        <a
          key={key++}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={LINK_CLASS}
        >
          {decode(linkLabel)}
          <span className="sr-only"> (mở tab mới)</span>
        </a>
      )
      continue
    }

    const text = decode(inner ?? '')
    if (tag === 'code')
      nodes.push(
        <code
          key={key++}
          className={CODE_CLASS}
        >
          {text}
        </code>
      )
    else if (tag === 'em') nodes.push(<em key={key++}>{text}</em>)
    else
      nodes.push(
        <strong
          key={key++}
          className="font-semibold text-pp-text"
        >
          {text}
        </strong>
      )
  }

  if (cursor < source.length) nodes.push(decode(source.slice(cursor)))
  return nodes
}

export default function RichText({ children }: { children: string }) {
  return <Fragment>{renderRichText(children)}</Fragment>
}
