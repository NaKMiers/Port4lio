import rehypeSanitize from 'rehype-sanitize'
import rehypeStringify from 'rehype-stringify'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'

/**
 * The Export sheet's markdown, as HTML for reading - in the browser, and only for looking at.
 *
 * ```
 *   renderContext ──▶ markdown ──┬──▶ Copy           (always the markdown, never this)
 *                                └──▶ this file ──▶ .blog-prose preview in the sheet
 *   remark-parse + gfm ──▶ remark-rehype { allowDangerousHtml: false } ──▶ rehype-sanitize
 * ```
 *
 * ## Why this is not `lib/blog/markdown.ts`
 *
 * That pipeline is `server-only` on purpose: its output is stored and published, so the
 * sanitizer that decides what is safe must not run on the typing machine, and the blog
 * preview is a round trip to it. Neither reason applies here. Nothing rendered here is
 * stored or sent anywhere - what leaves the sheet is the markdown - and the text is the
 * owner's own cards, rendered on the owner's own screen. Going to the server for it would
 * undo the point of building the export in the browser (see `visible.ts`).
 *
 * It is still sanitized, in the same order the blog uses: raw HTML is dropped at
 * remark-rehype, then `rehype-sanitize` (GitHub's schema) runs over what is left. A card
 * titled `<img onerror=...>` renders as that text, because it never became an element. No
 * Shiki: the export has no fenced code, and it is a large dependency to load for none.
 *
 * Loaded with `import()` by the sheet, so the parser ships only to a session that opens it.
 */

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype, { allowDangerousHtml: false })
  .use(rehypeSanitize)
  .use(rehypeStringify)

export async function renderExportHtml(markdown: string): Promise<string> {
  return String(await processor.process(markdown))
}
