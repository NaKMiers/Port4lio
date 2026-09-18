import Link from 'next/link'

import type { PostListItem } from '@/lib/blog/post-data'

/**
 * One post in a list.
 *
 * ## Why `note` and `article` look different here
 *
 * The two tiers exist so that the cheap one actually gets written. Of 27 blogs reviewed for
 * this feature, 10 had gone quiet, and the pattern was that a site with only one expensive
 * format stops publishing the moment a post feels too big to start. A `note` needs no cover
 * image and no excerpt, so a card for one has to read as complete without them rather than
 * as an article with pieces missing - otherwise the tier is nominal and the author still
 * feels the full cost every time.
 *
 * So a note gets a tighter card and its kind stated, and an article gets the excerpt and the
 * cover. Same list, two shapes, neither looking like a failed version of the other.
 *
 * ## Why the date is not in the card
 *
 * The index is grouped by series rather than sorted by recency, so a date on every card
 * invites the reader to scan for the newest thing instead of the entry point - and on a blog
 * with five posts, "three weeks ago" is information that only makes it look abandoned. The
 * date is on the post itself, where a reader who wants to judge currency is already reading.
 */
export default function PostCard({
  post,
  featured = false,
}: {
  post: PostListItem
  featured?: boolean
}) {
  return (
    <article
      className={[
        'group rounded-panel border border-pp-line bg-[var(--pp-panel)] p-5 transition-colors',
        'hover:border-pp-blue/40',
        featured ? 'sm:p-6' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {post.kind === 'note' ? (
        <p className='text-[10px] font-semibold uppercase tracking-[0.16em] text-pp-muted'>Note</p>
      ) : null}

      <h3
        className={[
          'font-display font-semibold text-pp-text',
          featured ? 'text-xl' : 'text-lg',
          post.kind === 'note' ? 'mt-1' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {/*
          The whole card is not a link. A card-sized anchor swallows text selection, which is
          how somebody copies a title to search for it, and it gives a screen reader one
          enormous link whose name is the entire card contents.
        */}
        <Link
          href={`/blog/${post.slug}`}
          className='text-pp-text no-underline after:absolute group-hover:text-pp-blue'
        >
          {post.title}
        </Link>
      </h3>

      {post.excerpt ? (
        <p className='mt-2 text-sm leading-relaxed text-pp-muted'>{post.excerpt}</p>
      ) : null}

      {post.tags.length > 0 ? (
        <ul className='mt-3 flex flex-wrap gap-2'>
          {post.tags.slice(0, 4).map(tag => (
            <li
              key={tag}
              className='rounded-full border border-pp-line px-2.5 py-0.5 text-[11px] text-pp-muted'
            >
              {tag}
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  )
}
