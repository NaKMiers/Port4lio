import 'server-only'

import rehypeShiki from '@shikijs/rehype'
import type { Element, Root } from 'hast'
import rehypeSanitize from 'rehype-sanitize'
import rehypeStringify from 'rehype-stringify'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'
import { visit } from 'unist-util-visit'

import rehypeHeadingIds from '@/lib/blog/rehype-heading-ids'
import rehypeRestrictImageHosts from '@/lib/blog/rehype-restrict-image-hosts'
import { blogSanitizeSchema } from '@/lib/blog/sanitize-schema'

/**
 * Author markdown to stored HTML. Runs once, at SAVE time. Never in a request.
 *
 * ```
 *   bodyMarkdown (author-controlled)
 *         │
 *         ▼
 *   remark-parse ──▶ remark-gfm
 *         │
 *         ▼
 *   remark-rehype { allowDangerousHtml: false }   ← raw HTML dropped at the door
 *         │
 *         ▼
 *   rehype-sanitize  (blogSanitizeSchema)
 *         │
 *         ▼
 *   rehypeRestrictImageHosts    ← schemes were sanitize's job; HOSTS are this one's
 *         │
 *         ▼
 *   downgradeUnknownFences      ← so Shiki is never handed a grammar it lacks
 *         │
 *         ▼
 *   rehypeHeadingIds            ← id on every h2/h3/h4, for the TOC and anchor results
 *         │
 *         ▼
 *   @shikijs/rehype             input: text of pre > code. output: style on its own spans
 *         │
 *         ▼
 *   rehype-stringify ──▶ Post.bodyHtml
 * ```
 *
 * ## Why the order is this and not the obvious one
 *
 * Highlight-then-sanitize is the intuitive order and it destroys the highlighting: Shiki
 * emits inline `style` attributes on the spans it creates, and no sane sanitize schema
 * admits `style`, so the sanitizer strips every colour Shiki just computed.
 *
 * Sanitize-then-highlight works because of what Shiki actually consumes and produces. Its
 * input is the *text content* of `pre > code`, which by that point has been through the
 * sanitizer; its output is elements it constructs itself. Nothing author-controlled reaches
 * the browser unsanitized, and the styles survive because they are added after the only pass
 * that would have removed them.
 *
 * **This makes the plugin order load-bearing, so treat it as a closed list.** No plugin may
 * be appended after the sanitize node without re-deriving this argument for it. The concrete
 * case: `rehype-external-links`, to add `rel="noopener"` to outbound links, is a reasonable
 * thing to want and MUST run after sanitize, because neither `target` nor `rel` is in the
 * schema and running it before means the sanitizer deletes its work. Adding it is a decision
 * to reopen this ordering, not a one-line import.
 *
 * `rehypeHeadingIds` is the first plugin to take that route, and its own header carries the
 * re-derivation the paragraph above demands: it writes one attribute, `id`, whose value is
 * the output of a whitelist transform to `[a-z0-9-]` rather than any author string. Read it
 * before appending anything else here.
 *
 * ## Why this runs at save time (D9)
 *
 * Measured: Shiki costs a **~5.5 second one-time bootstrap per process** (first call 5469ms,
 * second 10ms). In a request path that is paid by every cold lambda, so the first reader of
 * any uncached post waits ~5.5s of TTFB - and that reader is precisely the one arriving from
 * the cross-post this whole feature exists for. At build time it is paid by every worker: a
 * probe build went 7.8s to 14.75s with 8 workers each bootstrapping.
 *
 * Rendering once at save moves that cost onto the author, who is already waiting for a save,
 * and makes the read path a string lookup. `Post.renderedWith` records which pipeline version
 * produced a given `bodyHtml`, because changing anything in this file means the stored HTML
 * of every existing post is stale and there has to be a way to find them.
 *
 * ## The error contract
 *
 * `renderMarkdown` does not throw for content reasons. A post is a live URL, and the failure
 * mode being avoided is that one unregistered language fence takes a published page to a 500
 * for every reader. Unknown fences are downgraded before Shiki sees them and logged; that is
 * the `test-events.ts` fire-and-forget doctrine applied to rendering, and what a reader gets
 * is uncoloured code rather than an error page.
 */

/**
 * Bump when anything in this pipeline changes. Stored on the document as `renderedWith`.
 *
 * `blog-md-2` added `rehypeHeadingIds`. A post still stored as `blog-md-1` renders exactly as
 * before - its headings simply carry no `id`, so `extractToc` finds nothing and the table of
 * contents is absent rather than broken. Opening and saving the post in the editor re-renders
 * it, because `PATCH /api/admin/blog/[id]` re-runs the pipeline whenever `renderedWith` does
 * not match this constant. That degradation is why no backfill script ships with this.
 */
export const BLOG_PIPELINE_VERSION = 'blog-md-2'

/**
 * The grammars Shiki loads, pinned explicitly rather than letting it resolve on demand.
 *
 * Two reasons. Bundle and bootstrap cost scale with the grammar set, and the whole point of
 * D9 is that this cost is bounded and paid once. And an explicit list is what makes
 * "unknown fence" a decidable question here, in our code, with a log line naming the slug -
 * rather than a rejected promise from inside Shiki that surfaces as a stack trace.
 *
 * Add a language when a post needs it. That is a deliberate one-line change with a build
 * time consequence, which is the right shape for this decision.
 */
export const SHIKI_LANGUAGES = [
  'bash',
  'css',
  'diff',
  'html',
  'ini',
  'js',
  'json',
  'jsx',
  'md',
  'python',
  'sh',
  'sql',
  'ts',
  'tsx',
  'yaml',
] as const

const KNOWN_LANGUAGES = new Set<string>(SHIKI_LANGUAGES)

/** Shiki's own name for "render it, but do not colour it". */
const PLAIN = 'text'

/**
 * Rewrite `language-<unknown>` to `language-text` before Shiki runs.
 *
 * Shiki's failure on an unregistered grammar is a rejected promise, which `unified` turns
 * into a throw out of `renderMarkdown`. Catching that around the whole pipeline would mean
 * one bad fence loses the entire post's HTML - so the fence is fixed on the way in instead,
 * and every other block on the page still highlights.
 *
 * `slug` is only here for the log line. A message saying a highlight failed is close to
 * useless without the post it failed on, since the author is looking at a list of thirty.
 */
function downgradeUnknownFences(slug: string) {
  return (tree: Root) => {
    visit(tree, 'element', (node: Element, _index, parent) => {
      if (node.tagName !== 'code') return
      if (!parent || parent.type !== 'element' || parent.tagName !== 'pre') return

      const classNames = node.properties?.className
      if (!Array.isArray(classNames)) return

      const languageClass = classNames.find(
        (value): value is string => typeof value === 'string' && value.startsWith('language-')
      )
      if (!languageClass) return

      const language = languageClass.slice('language-'.length)
      if (KNOWN_LANGUAGES.has(language)) return

      console.error(
        `[blog] highlight unavailable for ${slug} (lang=${language}) - rendering it plain. Add it to SHIKI_LANGUAGES if a post needs it.`
      )

      node.properties.className = classNames.map(value =>
        value === languageClass ? `language-${PLAIN}` : value
      )
    })
  }
}

/**
 * Render one post body.
 *
 * `slug` is used only in log messages. It is a required parameter rather than an optional one
 * so that a caller cannot accidentally produce unattributable logs - there are only two call
 * sites and both have it.
 */
export async function renderMarkdown(markdown: string, slug: string): Promise<string> {
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    // Raw HTML in the source is DROPPED, not escaped and not passed through. An author who
    // needs a construct markdown cannot express should get a pipeline change with a reason,
    // not a hole that also accepts whatever a compromised draft contains.
    .use(remarkRehype, { allowDangerousHtml: false })
    .use(rehypeSanitize, blogSanitizeSchema)
    .use(rehypeRestrictImageHosts)
    .use(downgradeUnknownFences, slug)
    // After sanitize by necessity - see the ordering note in the header. Before Shiki only
    // because Shiki has more work to do and no reason to be handed a larger tree.
    .use(rehypeHeadingIds)
    .use(rehypeShiki, {
      theme: 'github-dark',
      langs: [...SHIKI_LANGUAGES],
      // Belt to `downgradeUnknownFences`'s braces. That visitor handles every fence carrying
      // a `language-` class; this catches anything that reaches Shiki by another route.
      fallbackLanguage: PLAIN,
    })
    .use(rehypeStringify)
    .process(markdown)

  return String(file)
}
