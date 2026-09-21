/**
 * Read a table of contents back out of a post's stored HTML.
 *
 * ## Why a regex over HTML, which is normally the wrong tool
 *
 * The usual objection - HTML is not regular, an arbitrary document will defeat you - is about
 * *arbitrary* HTML. This input is not arbitrary. It is `rehype-stringify` output from our own
 * pipeline, produced minutes earlier by `renderMarkdown`, over a tree that `rehype-sanitize`
 * had already reduced to the tags in `blogSanitizeSchema`. The heading elements this matches
 * were written by `rehypeHeadingIds`, so their shape is known exactly: `<h2 id="...">`, with
 * the id a `[a-z0-9-]` slug that cannot contain a quote.
 *
 * The alternative is re-parsing every post body into a hast tree on every render of every
 * post page, to find between three and ten elements. That is a parser and a tree walk in the
 * request path of the page whose whole reason for existing (D9) is that it does no parsing at
 * all - the same argument that moved Shiki to save time, one level smaller.
 *
 * ## The failure mode is "no contents", never a broken page
 *
 * Every branch here degrades to dropping a heading. A post rendered before `blog-md-2` has no
 * ids at all, matches nothing, and gets no table of contents - which is correct, because
 * there is nothing on the page for it to link to.
 *
 * ## Why headings are not stored on the document instead
 *
 * They could be, computed at save time next to `bodyHtml`. That is a schema field, a
 * migration, and a fourth thing the save path keeps in step - bought for a regex that runs in
 * microseconds over a string already in memory. If the TOC ever needs to be queryable (a
 * site-wide "jump to the section about X"), that is when it earns a column.
 */

export type TocEntry = {
  id: string
  /** 2, 3 or 4 - the heading level, used for indentation only. */
  level: number
  text: string
}

/**
 * `<h2 id="slug">…</h2>`, capturing the level, the id and the inner markup.
 *
 * The backreference on the closing tag is what keeps an `h3` nested inside nothing from
 * closing an `h2`. Headings cannot nest in HTML, so the first matching close is the right one.
 */
const HEADING = /<h([234])\b[^>]*\bid="([a-z0-9-]+)"[^>]*>([\s\S]*?)<\/h\1>/gi

const TAG = /<[^>]+>/g

/** Only the entities the pipeline can actually emit into heading text. */
const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#x27;': "'",
  '&#39;': "'",
  '&nbsp;': ' ',
}

function headingLabel(inner: string): string {
  return inner
    .replace(TAG, '')
    .replace(
      /&(?:amp|lt|gt|quot|nbsp|#x27|#39);/gi,
      match => ENTITIES[match.toLowerCase()] ?? match
    )
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * How many headings a post needs before a contents list is worth showing.
 *
 * Two is a post with an introduction and a conclusion, and a two-item contents list above it
 * is furniture - it costs a reader a scroll and tells them nothing they could not see. Three
 * is where a post has a structure worth previewing, and it is also roughly where Google
 * starts treating a contents list as navigation worth surfacing as anchor links.
 */
export const TOC_MIN_ENTRIES = 3

/** Long enough to be a heading nobody wrote. Guards a runaway match on malformed input. */
const MAX_LABEL = 160

export function extractToc(html: string): TocEntry[] {
  if (!html) return []

  const entries: TocEntry[] = []
  const seen = new Set<string>()

  // `matchAll` rather than a `while (exec())` loop: the regex is module-level and therefore
  // shared, and `exec` on a `/g` regex carries `lastIndex` between calls. Two posts rendering
  // concurrently would otherwise each resume from where the other stopped.
  for (const match of Array.from(html.matchAll(HEADING))) {
    const [, levelRaw, id, inner] = match
    if (!id || seen.has(id)) continue

    const text = headingLabel(inner ?? '')
    if (!text || text.length > MAX_LABEL) continue

    seen.add(id)
    entries.push({ id, level: Number(levelRaw), text })
  }

  return entries
}
