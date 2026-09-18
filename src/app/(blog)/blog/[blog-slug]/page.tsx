import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import AvailabilityBlock from '@/components/blog/AvailabilityBlock'
import PostByline from '@/components/blog/PostByline'
import { listPublishedSlugs, readPublishedPost, resolveRelatedSlugs } from '@/lib/blog/post-data'
import { buildPostJsonLd, buildPostMetadata } from '@/lib/blog/seo'
import { loadPublicProfileUncached } from '@/lib/profile-data'
import { collapseWhitespace } from '@/lib/profile-copy'
import { resolveSiteOrigin } from '@/lib/seo'

/**
 * One post.
 *
 * ```
 *   revalidate = 300           ISR shell, invalidated on demand by revalidatePublishedPost
 *   dynamicParams = true       a slug not in the list below renders on first request
 *   generateStaticParams       try/catch → []   ← MANDATORY. see below.
 * ```
 *
 * ## `generateStaticParams` must never throw, and this is not defensive programming
 *
 * It calls `connectDatabase()`, which throws on any Atlas hiccup, and Vercel build machines
 * have no stable egress IP - so an IP allowlist, a brief cluster failover or a cold Atlas
 * instance all present here as a thrown connection error at build time.
 *
 * A throw out of this function does not fail this route. It fails **the entire build**:
 * `Failed to collect page data for /blog/[blog-slug]`, non-zero exit, deploy aborted. That
 * takes down `/`, `/cv`, all 35 MBTI and IQ pages and the sitemap - the whole site offline
 * because the blog could not reach its database for a second. Verified by making it throw.
 *
 * Returning `[]` is completely correct rather than merely safe, and that is what
 * `dynamicParams = true` buys: with no params prerendered, every post renders on its first
 * request and is cached from then on. The cost of a build-time database blip becomes a
 * slightly slower first hit per post. The cost of not catching is the site.
 *
 * ## No `layout.tsx` in this segment
 *
 * `<article lang>` below is why somebody would add one, and it cannot work: only the root
 * layout may render `<html>`, and `src/app/layout.tsx` hardcodes `lang='en'`. A nested
 * layout also cannot read its page's data, so it would need a second query for the same
 * document to learn the language. `lang` on the wrapping element is this repo's existing
 * answer - `TestChrome.tsx` does exactly this - and it is what assistive tech and Google
 * both read for a subtree.
 */

export const revalidate = 300
export const dynamicParams = true

type PageProps = { params: Promise<{ 'blog-slug': string }> }

export async function generateStaticParams() {
  try {
    const slugs = await listPublishedSlugs()
    return slugs.map(slug => ({ 'blog-slug': slug }))
  } catch (error) {
    // Logged loudly because the symptom - every post suddenly rendering on demand - is
    // invisible in a successful build otherwise.
    console.error(
      '[blog] generateStaticParams failed, falling back to on-demand rendering. The build is CORRECT but nothing is prerendered; dynamicParams=true covers it.',
      error
    )
    return []
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { 'blog-slug': slug } = await params
  const post = await readPublishedPost(slug)
  if (!post) return {}

  const origin = resolveSiteOrigin().replace(/\/$/, '')
  const profile = await loadPublicProfileUncached()
  const authorName = collapseWhitespace(profile.fullName) || 'Anh Khoa Nguyen'

  return buildPostMetadata(post, origin, authorName)
}

export default async function BlogPostPage({ params }: PageProps) {
  const { 'blog-slug': slug } = await params
  const post = await readPublishedPost(slug)

  // `readPublishedPost` filters on `status: 'published'`, so drafts, archived and
  // soft-deleted posts all land here identically - a 404, with no hint that the slug exists.
  if (!post) notFound()

  const origin = resolveSiteOrigin().replace(/\/$/, '')
  const profile = await loadPublicProfileUncached()
  const related = await resolveRelatedSlugs(post.relatedSlugs ?? [])

  return (
    <>
      <script
        type='application/ld+json'
        // The only `dangerouslySetInnerHTML` allowed to take a non-post string, and its
        // input is `JSON.stringify` output over fields we control - never author markdown.
        dangerouslySetInnerHTML={{ __html: buildPostJsonLd(post, origin, profile) }}
      />

      <div className='mx-auto w-full max-w-editorial px-gutter py-10'>
        <nav className='mb-8 text-sm'>
          <Link href='/blog' className='text-pp-muted no-underline hover:text-pp-text'>
            &larr; Writing
          </Link>
        </nav>

        {/*
          `lang` on the article, not the document. See the header - only the root layout can
          render `<html>`. This is the element a screen reader switches voice on and the
          subtree Google reads a language from, so it belongs on the content and not on a
          wrapper further out that also contains English navigation.
        */}
        <article lang={post.language}>
          <header className='mb-8'>
            <h1 className='font-display text-3xl font-semibold leading-tight text-pp-text sm:text-4xl'>
              {post.title}
            </h1>
            {post.excerpt ? (
              <p className='mt-4 max-w-[62ch] text-lg leading-relaxed text-pp-muted'>
                {post.excerpt}
              </p>
            ) : null}
            <PostByline
              authorName={collapseWhitespace(profile.fullName) || 'Anh Khoa Nguyen'}
              publishedAt={post.publishedAt}
              contentUpdatedAt={post.contentUpdatedAt}
            />
          </header>

          {/*
            `bodyHtml` was sanitized and highlighted at SAVE time (D9), by the pipeline in
            `lib/blog/markdown.ts`: raw HTML dropped at remark-rehype, everything else through
            `rehype-sanitize`, image hosts restricted to our own Cloudinary, and only then
            Shiki. Nothing is rendered here that did not go through that, and nothing renders
            markdown in a request path - Shiki's ~5.5s per-process bootstrap is the reason.
          */}
          <div
            className='blog-prose'
            dangerouslySetInnerHTML={{ __html: post.bodyHtml }}
          />
        </article>

        {related.length > 0 ? (
          <aside className='mt-14 border-t border-pp-line pt-8'>
            <h2 className='font-display text-sm font-semibold uppercase tracking-[0.14em] text-pp-muted'>
              Related
            </h2>
            <ul className='mt-4 space-y-3'>
              {related.map(item => (
                <li key={item.slug}>
                  <Link
                    href={`/blog/${item.slug}`}
                    className='font-display text-base font-semibold text-pp-text no-underline hover:text-pp-blue'
                  >
                    {item.title}
                  </Link>
                </li>
              ))}
            </ul>
          </aside>
        ) : null}
      </div>

      <AvailabilityBlock locale='en' />
    </>
  )
}
