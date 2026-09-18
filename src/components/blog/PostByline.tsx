import Link from 'next/link'

/**
 * Name, date, and a link to the CV.
 *
 * ## Why this is a rendered element and not just JSON-LD
 *
 * The post already emits a full `Person` node in its `@graph`, so the machine-readable half
 * of authorship is covered. This is the human-readable half, and the two are not
 * substitutes: "named author with visible credentials" is a signal a reader evaluates in the
 * first two seconds, and it is the one that decides whether the rest of the page is worth
 * their time. A recruiter skimming a post linked from Viblo has no reason to read the page
 * source.
 *
 * The `/cv` link is the credential. It is the only outbound link above the fold, deliberately
 * - the availability block at the foot of the page is where the conversion ask lives, and a
 * second one up here would be asking before the reader has been given anything.
 *
 * ## Why `dateModified` only renders when it is meaningfully later
 *
 * Every post has a `contentUpdatedAt`, and on a post that was published and never touched it
 * equals `publishedAt` to the second. Rendering "Updated 12 March 2026" next to
 * "12 March 2026" reads as a mistake. The one-day threshold is a judgement, not a
 * measurement: a typo fix an hour after publishing is not an update a reader needs told
 * about, and a revision a week later is.
 */

const ONE_DAY_MS = 24 * 60 * 60 * 1000

function formatDate(value: Date | null | undefined): string | null {
  if (!value) return null

  // `en-GB` for "12 March 2026" rather than "March 12, 2026". Unambiguous to both audiences,
  // which matters on a site whose readers are split between Vietnam and elsewhere.
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(value)
}

export default function PostByline({
  authorName,
  publishedAt,
  contentUpdatedAt,
}: {
  authorName: string
  publishedAt: Date | null
  contentUpdatedAt: Date | null
}) {
  const published = formatDate(publishedAt)
  const showUpdated =
    publishedAt && contentUpdatedAt
      ? contentUpdatedAt.getTime() - publishedAt.getTime() > ONE_DAY_MS
      : false
  const updated = showUpdated ? formatDate(contentUpdatedAt) : null

  return (
    <div className='mt-6 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-pp-muted'>
      <span>
        By{' '}
        <Link href='/cv' className='font-semibold text-pp-text no-underline hover:text-pp-blue'>
          {authorName}
        </Link>
      </span>
      {published ? (
        <>
          <span aria-hidden>·</span>
          {/*
            `dateTime` carries the machine-readable form so the visible text can be the
            human one. `publishedAt` is write-once, so this never silently changes on a
            re-publish - which would tell a reader a months-old post was written today.
          */}
          <time dateTime={publishedAt?.toISOString()}>{published}</time>
        </>
      ) : null}
      {updated ? (
        <>
          <span aria-hidden>·</span>
          <time dateTime={contentUpdatedAt?.toISOString()}>Updated {updated}</time>
        </>
      ) : null}
    </div>
  )
}
