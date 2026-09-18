'use client'

import Link from 'next/link'

import { useBlogLocale } from '@/components/blog/BlogLocaleProvider'
import type { PostListItem } from '@/lib/blog/post-data'
import { POST_LANGUAGE_LABEL } from '@/lib/blog/ui-copy'

/**
 * One post in a list.
 *
 * ## Why some kinds name themselves here and others do not
 *
 * The two tiers exist so that the cheap one actually gets written. Of 27 blogs reviewed for
 * this feature, 10 had gone quiet, and the pattern was that a site with only one expensive
 * format stops publishing the moment a post feels too big to start. A `note` needs no cover
 * image and no excerpt, so a card for one has to read as complete without them rather than
 * as an article with pieces missing - otherwise the tier is nominal and the author still
 * feels the full cost every time.
 *
 * That used to be `post.kind === 'note'` written twice, in this file. Kinds are managed from
 * the editor now, so the decision moved onto the kind itself as `eyebrow` - see
 * `models/Kind.ts`. `note` ships with it on and `article` with it off, which is exactly the
 * behaviour the literal produced; the difference is that a third kind can now choose.
 *
 * `kind` is optional, and the undefined branch is not defensive padding: a post outlives the
 * kind it names if that kind is deleted, and such a card renders without an eyebrow rather
 * than with the word `undefined` over the title.
 *
 * ## The cover thumbnail does NOT follow the tier
 *
 * It renders whenever `coverImage` is set, regardless of kind. Gating it on `article` would
 * override the author rather than reflect them: a note that carries a picture should show
 * it, and the reason notes look lighter in this list is that nobody attaches a cover to one.
 * The tier shows through the data, not through a branch that contradicts it.
 *
 * ## The date IS in the card now, reversing an earlier decision
 *
 * It used to be omitted, and the reasoning was: the index groups by series rather than by
 * recency, so a date invites scanning for the newest thing instead of the entry point, and on
 * a blog with five posts "three weeks ago" only makes it look abandoned.
 *
 * The first half still holds and is handled a better way - the date is set small and last,
 * under the title, where it reads as provenance rather than as a sort key. The second half
 * was the weaker argument: it optimises the page against the reader. An undated technical
 * post is a post nobody can tell is still true, and for anything touching a framework that
 * ships breaking changes twice a year, "when was this written" is the first question a
 * stranger asks. Hiding it to look fresher trades their trust for our comfort.
 *
 * `timeZone: 'UTC'` in the formatter is load-bearing, not pedantry: this component renders on
 * the server AND in `BlogIndexList`, a client component. Without a pinned zone the two format
 * in different zones, a post published near midnight resolves to different days, and React
 * reports a hydration mismatch.
 */
/**
 * Built once at module scope rather than per card. `Intl.DateTimeFormat` is expensive to
 * construct and this list renders one per post.
 *
 * `en-GB` with a spelled-out month - "18 September 2026" - because the numeric orderings are
 * ambiguous across exactly the audience this blog is read by: 09/10/2026 is two different days
 * depending on which side of the Atlantic the reader is on.
 */
const DATE_FORMAT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})

export default function PostCard({
  post,
  kind,
  featured = false,
}: {
  post: PostListItem
  /** Presentation for `post.kind`, looked up once by the page rather than per card. */
  kind?: { label: string; eyebrow: boolean }
  featured?: boolean
}) {
  const showEyebrow = kind?.eyebrow === true
  const { locale } = useBlogLocale()
  return (
    <article
      className={[
        'group relative cursor-pointer rounded-panel border border-pp-line bg-[var(--pp-panel)] p-5 shadow-panel backdrop-blur-md transition-colors',
        'hover:border-pp-blue/40',
        featured ? 'sm:p-6' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {post.coverImage ? (
        post.coverCaption ? (
          <figure className='mb-4'>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={post.coverImage}
              alt=''
              loading='lazy'
              className='aspect-[1200/630] w-full rounded-[0.9rem] border border-pp-line object-cover'
            />
            <figcaption className='mt-2 text-[11px] leading-relaxed text-pp-muted'>
              {post.coverCaption}
            </figcaption>
          </figure>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={post.coverImage}
            alt=''
            aria-hidden
            loading='lazy'
            className='mb-4 aspect-[1200/630] w-full rounded-[0.9rem] border border-pp-line object-cover'
          />
        )
      ) : null}

      {showEyebrow ? (
        <p className='text-[10px] font-semibold uppercase tracking-[0.16em] text-pp-muted'>
          {kind?.label}
        </p>
      ) : null}

      <h3
        className={[
          'font-display font-semibold text-pp-text',
          featured ? 'text-xl' : 'text-lg',
          showEyebrow ? 'mt-1' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {/*
          The whole card is clickable, and it is still only this one anchor - the "stretched
          link" pattern rather than a card-sized `<a>` wrapped around everything.

          The distinction is the accessible name. Wrapping the card gives a screen reader one
          enormous link announced as the entire card contents: eyebrow, title, date, language
          badge, excerpt and every tag, read out as the name of one link. Here the anchor
          still contains exactly the title and an empty `::after` pinned to the card's box
          does the intercepting - so the link is named "five thing nextjs 16 did" while the
          click target is the whole card.

          Three parts, and this had one of them. `after:absolute` was already written, but the
          `<article>` was not `relative` so the pseudo-element resolved against some ancestor
          further up the page; without `after:inset-0` it had no size; and without
          `after:content-['']` it was never generated at all. The pattern was documented and
          inert, which is why the card looked clickable and was not.

          The cost, which the comment this replaces predicted: the overlay sits above the
          text, so the excerpt and caption can no longer be selected with a mouse. Copying a
          title to search for it means copying it from the post page now. That is the trade
          being asked for, and it is worth naming rather than leaving to be discovered.
        */}
        <Link
          href={`/blog/${post.slug}`}
          className="text-pp-text no-underline after:absolute after:inset-0 after:content-[''] group-hover:text-pp-blue"
        >
          {post.title}
        </Link>
      </h3>

      <p className='mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-pp-muted'>
        {post.publishedAt ? (
          <time dateTime={new Date(post.publishedAt).toISOString()}>
            {DATE_FORMAT.format(new Date(post.publishedAt))}
          </time>
        ) : null}
        {post.language !== locale ? (
          <>
            <span aria-hidden>&middot;</span>
            <span className='rounded-full border border-pp-line px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]'>
              {POST_LANGUAGE_LABEL[post.language] ?? post.language}
            </span>
          </>
        ) : null}
      </p>

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
