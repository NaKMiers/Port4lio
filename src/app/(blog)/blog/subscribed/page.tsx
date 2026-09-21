import type { Metadata } from 'next'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Subscription',
  robots: { index: false, follow: true },
}

/**
 * Where the confirm and unsubscribe links land.
 *
 * ## Why one page with a `state` param rather than four routes
 *
 * The four outcomes differ only in one sentence, and they are reached by clicking a link in
 * an email - so none of them is a destination anybody navigates to, bookmarks, or should find
 * in search. `noindex` for the same reason.
 *
 * `state` is read into a fixed lookup with a default, so an arbitrary query string renders the
 * generic copy rather than anything a caller chose. It never reaches the page as text.
 */

const COPY: Record<string, { heading: string; body: string }> = {
  confirmed: {
    heading: 'You are on the list',
    body: 'That is all it took. You will hear from me when there is a new post, and not otherwise.',
  },
  unsubscribed: {
    heading: 'Unsubscribed',
    body: 'You will not get any more email from me. No hard feelings - the posts stay free to read here.',
  },
  invalid: {
    heading: 'That link did not work',
    body: 'It may have expired or been mangled by a mail client. Subscribing again from the blog will send a fresh one.',
  },
  error: {
    heading: 'Something went wrong',
    body: 'Not your fault. Try the link again in a minute, or email me and I will sort it out by hand.',
  },
}

export default async function SubscribedPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>
}) {
  const { state } = await searchParams
  const copy = COPY[state ?? ''] ?? COPY.invalid

  return (
    <div className="mx-auto w-full max-w-editorial px-gutter py-20">
      <h1 className="font-display text-3xl font-semibold text-pp-text">
        {copy.heading}
      </h1>
      <p className="mt-4 max-w-[58ch] text-lg leading-relaxed text-pp-muted">
        {copy.body}
      </p>
      <p className="mt-8 text-sm">
        <Link
          href="/blog"
          className="inline-flex items-center gap-1.5 text-pp-blue no-underline"
        >
          <ArrowLeft
            aria-hidden
            size={14}
          />
          Back to the writing
        </Link>
      </p>
    </div>
  )
}
