import type { Element, ElementContent, Root } from 'hast'
import { visit } from 'unist-util-visit'

/**
 * Give every `h2`/`h3`/`h4` in a post body a stable `id`, derived from its own text.
 *
 * ## What this is for
 *
 * Three things, in descending order of how much they matter:
 *
 * 1. **Anchor links in search results.** Google will link directly into a section of a page
 *    when the section has an addressable id and the page has a visible table of contents
 *    pointing at it. That is one result occupying several lines with several entry points,
 *    on queries that match a heading rather than the title - which is most of how a
 *    technical post gets found ("next.js revalidatepath pattern", not the post's name).
 * 2. **A table of contents at all.** `lib/blog/toc.ts` reads these ids back out of the
 *    stored HTML; without them there is nothing to link to and no list to build.
 * 3. **Linkable sections.** A reader answering someone else's question can send the
 *    paragraph rather than the post.
 *
 * ## Why it is safe to run AFTER the sanitize node
 *
 * `lib/blog/markdown.ts` declares its plugin order load-bearing and requires the argument to
 * be re-derived for anything appended past `rehype-sanitize`. Here it is.
 *
 * The sanitizer's job is to stop author-controlled strings reaching the browser as markup or
 * as a URL. This visitor writes exactly one attribute, `id`, and the value it writes is
 * **not** an author string: it is the output of {@link slugifyHeading}, which is a whitelist
 * transform - every character not in `[a-z0-9]` becomes a hyphen, and the result is trimmed
 * and truncated. There is no input that produces a quote, an angle bracket, a colon, or a
 * space, so there is no input that escapes the attribute, and `id` carries no scheme for a
 * `javascript:` payload to hide in. The transform is total: it cannot throw and cannot
 * return anything outside that charset.
 *
 * The one genuinely author-influenced thing that survives is the *choice* of slug, which is
 * the point - `#why-the-order-is-this` has to come from the heading to be worth anything.
 *
 * ## Collisions are resolved, not ignored
 *
 * Two sections called "Why" in one post is normal and produces one id twice. Duplicate ids
 * are invalid HTML, and the concrete symptom is the table of contents linking every "Why"
 * entry to the first one - so the second and later occurrences get `-2`, `-3` suffixes.
 * Numbering is per-document and depends on order, which is stable because the body is
 * rendered once at save time.
 *
 * ## `h1` is deliberately untouched
 *
 * The post's `h1` is the title, rendered by the page outside this HTML. A heading at that
 * level inside a body is an authoring mistake - and giving it an id would put it in the
 * table of contents as a sibling of the real sections.
 */

const MAX_SLUG_LENGTH = 64

/**
 * The text content of a heading node.
 *
 * `hast-util-to-string` does exactly this and is already on disk - but as a *transitive*
 * dependency of the rehype stack, not one this project declares. Importing it would make a
 * package we never chose part of our build, removable by any upstream refactor, and the
 * failure would be a build error on a deploy nobody connected to a dependency bump. Six
 * lines of our own is the cheaper side of that trade.
 *
 * Inline markup inside a heading - `code`, `em`, a link - contributes its own text, which is
 * what a reader sees and therefore what the anchor should be named after.
 */
function headingText(nodes: ElementContent[]): string {
  return nodes
    .map(node => {
      if (node.type === 'text') return node.value
      if (node.type === 'element') return headingText(node.children)
      return ''
    })
    .join('')
}

/** Headings that become anchors. `h5`/`h6` are too deep to be useful navigation. */
const ANCHORED = new Set(['h2', 'h3', 'h4'])

/**
 * Text to `id`.
 *
 * Unicode is normalised and stripped rather than transliterated: `Đo lường` becomes
 * `do-luong`, which is the form a Vietnamese reader would type and the form the rest of this
 * codebase uses for slugs (see `SLUG_PATTERN` in `lib/blog/constants.ts`). NFD splits an
 * accented letter into base plus combining mark, and the combining marks are then in the
 * range this drops - so the base letter survives on its own.
 *
 * `đ`/`Đ` are the exception: they are single code points with no combining form, so NFD
 * leaves them intact and the charset filter would delete them outright, turning `đo` into
 * `o`. They are mapped explicitly, before the filter.
 *
 * Returns `''` for a heading with no alphanumeric content at all (an image, an emoji). The
 * caller treats that as "no id", which keeps it out of the table of contents rather than
 * giving it the id `-`.
 */
export function slugifyHeading(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, '')
}

export default function rehypeHeadingIds() {
  return (tree: Root) => {
    const used = new Map<string, number>()

    visit(tree, 'element', (node: Element) => {
      if (!ANCHORED.has(node.tagName)) return

      // An author-written `{#custom-id}` is not a thing this pipeline supports, but a future
      // plugin could set one - so an existing id is left alone rather than overwritten.
      if (
        typeof node.properties?.id === 'string' &&
        node.properties.id.length > 0
      )
        return

      const base = slugifyHeading(headingText(node.children))
      if (!base) return

      const seen = used.get(base) ?? 0
      used.set(base, seen + 1)

      node.properties = node.properties ?? {}
      node.properties.id = seen === 0 ? base : `${base}-${seen + 1}`
    })
  }
}
