import type { Metadata } from 'next'

import BlogLocaleProvider from '@/components/blog/BlogLocaleProvider'
import { resolveSiteOrigin } from '@/lib/seo'

/**
 * The blog's root. A token wrapper and nothing else.
 *
 * ```
 *   (blog)/layout.tsx           ← this file: one div, the design tokens, the RSS link
 *     └── blog/
 *           ├── page.tsx              /blog
 *           └── [blog-slug]/page.tsx  /blog/<slug>
 * ```
 *
 * ## What this layout must NOT do, and why it is a list rather than an omission
 *
 * The obvious move is to reuse `PortfolioPublicChrome`, which is what `/` and `/cv` render
 * and what makes them look like this site. It cannot be used here, and both escape hatches
 * are worse than having no chrome:
 *
 * `PortfolioPublicChrome` renders `<ProfileFetchStatus />`, a client component whose first
 * line is `useApp()`. Outside a provider that throws
 * `useAppContext must be used within an AppProvider`, so the blog would 500 on every page.
 *
 * Adding `AppProvider bootstrapOnMount` fixes the throw and puts a `fixed inset-0 z-[200]`
 * loading overlay across every blog page while the profile fetch is in flight - on a surface
 * whose entire job is that a stranger arriving from a cross-post reads the first paragraph.
 *
 * Adding `AppProvider initialProfile` fixes the overlay and puts `unstable_cache` in the
 * blog read path, which D3 forbids in its own words. The blog's freshness story is
 * route-segment ISR plus `revalidatePath` with a literal path, and a second cache layer
 * underneath it is a second thing to invalidate and a second way for a published post to
 * stay stale.
 *
 * ## Why it is a flex column
 *
 * The pages below render their content and then `AvailabilityBlock`, and `min-h-screen`
 * alone only guarantees that the *wrapper* fills the viewport - it says nothing about where
 * a short page's last child lands. So `/blog` with two posts, and `/blog` with none at all,
 * put the availability footer halfway up the screen with cream background under it. A
 * column with `flex-1` on the content lets the footer be pushed to the bottom when the page
 * is short and sit directly under the content when it is not, which is the behaviour a
 * footer is expected to have and the reason `AvailabilityBlock` exists at all: it is the
 * conversion surface, and a conversion surface floating mid-page reads as a mistake.
 *
 * `flex-1` goes on the pages rather than on a wrapper here, because a wrapper would have to
 * guess which child is content and which is footer.
 *
 * So: no chrome, no provider, no profile. `portfolio-public-root` carries the design tokens
 * (`--pp-bg`, `--pp-text`, the Montserrat/Source Sans pairing, `--pp-max`) that make this
 * look like the rest of the site, and it is a class name, not a component - it needs no
 * context and fetches nothing. The header and footer that a reader expects are rendered by
 * the pages below, which have the post in hand and can link back to `/` and `/cv` directly.
 *
 * ## No `<html lang>` here
 *
 * Only the root layout can render `<html>`, and `src/app/layout.tsx` hardcodes `lang='en'`.
 * A post's language goes on `<article lang={post.language}>` in the page, mirroring what
 * `TestChrome.tsx` already does with a wrapper div. A layout also cannot read its page's
 * data, so setting it here would need a second query for the same document.
 */

export async function generateMetadata(): Promise<Metadata> {
  const origin = resolveSiteOrigin().replace(/\/$/, '')

  return {
    // Declared on the layout so every page below inherits it. A feed reader that lands on
    // any post can find the feed without the post having to remember to say so.
    alternates: {
      types: {
        'application/rss+xml': `${origin}/blog/rss.xml`,
      },
    },
  }
}

export default function BlogLayout({
  children,
}: {
  children: React.ReactNode
}) {
  /*
    `BlogLocaleProvider` is a provider, and the header above spends four paragraphs on why
    this layout must not have one - so the distinction matters. What it refuses is
    `AppProvider`: that one FETCHES, which means either a full-screen loading overlay across
    every blog page or `unstable_cache` in the blog read path, and D3 forbids the second in
    its own words.

    This provider fetches nothing. It is a `createContext` holding one string and a setter,
    reading `localStorage` in an effect after paint. It adds no request, no cache layer and
    no blocking state - the page renders identically with it and without it until a reader
    presses VI.
  */
  return (
    <BlogLocaleProvider>
      <div className="portfolio-public-root flex min-h-screen flex-col">
        {children}
      </div>
    </BlogLocaleProvider>
  )
}
