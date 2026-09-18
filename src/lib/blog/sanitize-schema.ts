import { defaultSchema } from 'hast-util-sanitize'
import type { Schema } from 'hast-util-sanitize'

/**
 * The sanitize schema the blog pipeline runs, and the story of the version that was wrong.
 *
 * ```
 *   structuredClone(defaultSchema)
 *        │
 *        ├─ className entries      KEPT VERBATIM   ← the whole point
 *        ├─ protocols.href         http, https, mailto
 *        ├─ protocols.src          https only
 *        └─ style                  asserted absent, never "removed"
 * ```
 *
 * ## Why this starts from `defaultSchema` and subtracts almost nothing
 *
 * The first version of this plan specified three deltas against the default. All three were
 * wrong, and one of them would have silently broken the feature it was meant to protect:
 *
 * **Stripping `className` globally.** This reads like obvious hygiene - author-controlled
 * class names are how you get `class="fixed inset-0"` over somebody's page - except that
 * `defaultSchema`'s `className` entries are not author free-text at all. They are a fixed
 * allowlist of literals and patterns, and one of them is:
 *
 * ```js
 *   code: [['className', /^language-./]]
 * ```
 *
 * which is exactly the class Shiki reads to pick a grammar. Strip `className` and every code
 * block silently loses its highlighting - no error, no warning, just grey code forever. The
 * same entries also carry GFM's footnote and task-list classes, so those break too. The
 * attack this delta was imagined to stop was never possible: an author cannot put an
 * arbitrary class through the default schema, because the schema enumerates them.
 *
 * **"Removing" `style`.** `defaultSchema` never admits `style` on anything, so removing it
 * removes nothing. The delta was a no-op that read like a control. What this file does
 * instead is *assert* its absence, in `sanitize-schema.test.ts` - a test that fails if a
 * future edit adds it, which is the only version of that check that can ever fire.
 *
 * **"Removing" `data-*`.** Same: not in the default, nothing to remove.
 *
 * The lesson the three share is that a delta against a schema you have not read is a
 * decoration. So this file reads it, keeps it, and narrows exactly two things.
 *
 * ## What IS narrowed, and why only these
 *
 * `protocols.href` drops everything except `http`, `https` and `mailto`. The default already
 * excludes `javascript:`; this additionally drops `tel:`, `xmpp:`, `irc:` and the rest, which
 * no post here will ever want and each of which is a surface.
 *
 * `protocols.src` is `https` alone. The default allows `http`, and a `http://` image on an
 * `https://` page is mixed content that the browser blocks anyway - so allowing it only
 * creates a broken image somebody has to debug.
 *
 * ## What this schema deliberately does NOT do
 *
 * It does not constrain image *hosts*. `protocols` filters SCHEMES; `https://evil.com/x.png`
 * passes it cleanly, because the scheme is fine. Host restriction is a separate visitor -
 * see `rehype-restrict-image-hosts.ts` - and conflating the two is how a reader of this file
 * concludes images are locked down when they are not.
 *
 * `href` and `src` survive sanitization as author-controlled values, by design. That is not
 * a gap; a blog whose author cannot write a link is not a blog. What makes it safe is that
 * the scheme is constrained here and the host is constrained there.
 */

/**
 * Built once at module load and frozen-by-convention. Exported so the test asserts against
 * the SAME object the renderer passes to `rehype-sanitize`, rather than a copy of it that
 * could drift - the failure mode where the test proves a schema nobody runs.
 */
export const blogSanitizeSchema: Schema = buildBlogSanitizeSchema()

function buildBlogSanitizeSchema(): Schema {
  const schema = structuredClone(defaultSchema) as Schema

  schema.protocols = {
    ...schema.protocols,
    href: ['http', 'https', 'mailto'],
    src: ['https'],
  }

  return schema
}

/**
 * Every attribute name the schema admits, flattened across all tag entries.
 *
 * Exists for the regression test: the `style` assertion has to look everywhere, and
 * `attributes` is a mix of bare strings (`'href'`) and `[name, ...allowed]` tuples, so a
 * naive `includes('style')` would miss the tuple form. Written here rather than in the test
 * so the shape-handling lives next to the shape it knows about.
 */
export function allAttributeNames(schema: Schema): string[] {
  const names: string[] = []

  for (const entry of Object.values(schema.attributes ?? {})) {
    for (const attribute of entry ?? []) {
      names.push(typeof attribute === 'string' ? attribute : attribute[0])
    }
  }

  return names
}
