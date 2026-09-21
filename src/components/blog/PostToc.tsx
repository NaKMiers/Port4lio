import type { TocEntry } from '@/lib/blog/toc'

/**
 * The contents list above a post.
 *
 * ## Why it is visible and not a `<details>` that starts closed
 *
 * The SEO half of this only works if it is rendered. Google surfaces anchor links into a page
 * ("jump to") when it can see a list of in-page links matching addressable sections - a
 * collapsed list is still in the DOM, but a reader on a phone never opens it, and the
 * engagement signal that makes the anchor links worth having never happens. A short list of
 * plain links costs four lines of vertical space and reads as a summary of the post, which is
 * the second reason it is here: it is the fastest honest answer to "is this what I wanted".
 *
 * ## Why `h3` links are indented and `h4` further
 *
 * Structure the reader can see is the point. A flat list of nine items all at one indent
 * tells them the post has nine sections; an indented one tells them it has three, with
 * subsections - which is the shape they are deciding about.
 *
 * ## No scroll-spy, no client JavaScript
 *
 * Highlighting the current section needs an IntersectionObserver, which makes this a client
 * component on a page that currently ships none of its own. The blog's whole posture (see
 * `(blog)/layout.tsx`) is that a stranger arriving from a cross-post reads the first
 * paragraph without waiting for anything - and native `#id` anchors already scroll, already
 * work with JavaScript off, and already update the address bar so the reader can share the
 * section.
 */
export default function PostToc({ entries }: { entries: TocEntry[] }) {
  if (entries.length === 0) return null

  return (
    <nav
      aria-labelledby="post-toc-heading"
      className="mb-10 rounded-panel border border-pp-line bg-[var(--pp-panel)] px-5 py-4"
    >
      <h2
        id="post-toc-heading"
        className="font-display text-[11px] font-semibold uppercase tracking-[0.16em] text-pp-ink-violet"
      >
        On this page
      </h2>
      <ol className="mt-3 space-y-1.5 text-sm">
        {entries.map(entry => (
          <li
            key={entry.id}
            // Indent by depth. `level` is 2, 3 or 4 - see `extractToc`, which anchors nothing
            // else - so the arithmetic cannot produce a class outside these three.
            style={{ paddingLeft: `${(entry.level - 2) * 0.9}rem` }}
          >
            {/* `--pp-blue` is a 2.70:1 decoration colour - fine as a hover tint on a link
                that is already legible, not fine as its resting state. `ink-blue` either way. */}
            <a
              href={`#${entry.id}`}
              className="text-pp-muted no-underline hover:text-pp-ink-blue"
            >
              {entry.text}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  )
}
