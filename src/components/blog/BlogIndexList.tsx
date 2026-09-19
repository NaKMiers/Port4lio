'use client'

import { Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'

import PostCard from '@/components/blog/PostCard'
import { useBlogLocale } from '@/components/blog/BlogLocaleProvider'
import type { PostListItem } from '@/lib/blog/post-data'

/**
 * The `/blog` index list, with search over it.
 *
 * ```
 *   query empty  ->  Start here  /  <series>  /  Everything else     (the grouped browse)
 *   query set    ->  one flat list, newest first, "N posts match"    (the results view)
 * ```
 *
 * ## Why searching collapses the grouping instead of filtering inside it
 *
 * Grouping is a browsing aid: it answers "what is here" for somebody who does not yet know
 * what they want. A search is the opposite question, asked by somebody who does - and
 * filtering each cluster in place answers it badly, because two matches in three clusters
 * renders three headings, two blurbs and a lot of vertical distance between six words of
 * result. Worse, "Start here" over a filtered pillar is a heading that has stopped being
 * true. So the clusters are for browsing and the flat list is for searching.
 *
 * ## Why this is a client component, and why that costs no SEO
 *
 * Search needs state, and state needs a client component. What it does NOT need is a
 * client-side fetch: the page is ISR with a 300s window and the whole corpus is measured in
 * tens of posts, so the server hands the list down as a prop and filtering is a `filter` over
 * an array already in memory. No endpoint, no loading state, no debounce, results on the
 * keystroke.
 *
 * Client components still render on the server for the initial HTML, so a crawler and a
 * reader with JS disabled both get the full grouped list exactly as before. The search input
 * is the only part that needs hydration, and it degrades to an inert box rather than to an
 * empty page.
 *
 * ## What it matches, and what it deliberately does not
 *
 * Title, excerpt, tags, and the series title - the things visible on a card, plus the cluster
 * name because "show me the career posts" is a real query. NOT the post body: `bodyMarkdown`
 * and `bodyHtml` are `select: false` and shipping every post's full text to the browser to
 * make a four-post list searchable is the wrong trade twice over.
 */

type SeriesInfo = { slug: string; title: string; blurb: string }
type KindInfo = { label: string; eyebrow: boolean }

export default function BlogIndexList({
  posts,
  series,
  kinds,
}: {
  posts: PostListItem[]
  series: SeriesInfo[]
  /** Serialised as an array: a `Map` does not survive the server-to-client boundary. */
  kinds: [string, KindInfo][]
}) {
  const [query, setQuery] = useState('')
  const { copy } = useBlogLocale()
  const kindMap = useMemo(() => new Map(kinds), [kinds])
  const seriesTitle = useMemo(
    () => new Map(series.map(item => [item.slug, item.title])),
    [series]
  )

  const trimmed = query.trim().toLowerCase()

  const matches = useMemo(() => {
    if (!trimmed) return []

    // Every term must appear somewhere in the haystack, in any order - so "next cache" finds
    // a post titled "Five things Next.js 16 did" tagged `caching`. A single-substring match
    // would find neither.
    const terms = trimmed.split(/\s+/)

    return posts.filter(post => {
      const haystack = [
        post.title,
        post.excerpt,
        post.tags.join(' '),
        post.series ? (seriesTitle.get(post.series) ?? post.series) : '',
      ]
        .join(' ')
        .toLowerCase()

      return terms.every(term => haystack.includes(term))
    })
  }, [trimmed, posts, seriesTitle])

  const pillars = posts.filter(post => post.isPillar)
  const bySeries = new Map<string, PostListItem[]>()
  for (const item of series) bySeries.set(item.slug, [])
  const unclustered: PostListItem[] = []

  for (const post of posts) {
    if (post.isPillar) continue
    if (post.series && bySeries.has(post.series)) bySeries.get(post.series)?.push(post)
    else unclustered.push(post)
  }

  return (
    <>
      <div className='mt-8'>
        <label className='sr-only' htmlFor='blog-search'>
          {copy.searchLabel}
        </label>
        <div className='relative'>
          <Search
            aria-hidden
            size={15}
            className='pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-pp-muted'
          />
          <input
            id='blog-search'
            type='search'
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder={copy.searchPlaceholder}
            className='w-full rounded-full border border-pp-line bg-pp-panel py-3 pl-11 pr-11 text-sm text-pp-text shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] outline-none backdrop-blur-md transition placeholder:text-pp-muted/75 focus:border-pp-blue/55 focus:bg-white focus:ring-4 focus:ring-pp-blue/10'
          />
          {query ? (
            <button
              type='button'
              onClick={() => setQuery('')}
              aria-label={copy.searchClear}
              className='absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-pp-muted transition hover:bg-white hover:text-pp-text'
            >
              <X aria-hidden size={14} />
            </button>
          ) : null}
        </div>
      </div>

      {trimmed ? (
        <section className='mt-10' aria-live='polite'>
          <h2 className='font-display text-sm font-semibold uppercase tracking-[0.14em] text-pp-ink-violet'>
            {matches.length === 0
              ? copy.resultsNone
              : matches.length === 1
                ? copy.resultsOne
                : copy.resultsMany(matches.length)}
          </h2>

          {matches.length === 0 ? (
            <p className='mt-4 max-w-[60ch] text-pp-muted'>{copy.noMatchBody(query.trim())}</p>
          ) : (
            <div className='mt-5 grid gap-5 sm:grid-cols-2'>
              {matches.map(post => (
                <PostCard key={post.slug} post={post} kind={kindMap.get(post.kind)} />
              ))}
            </div>
          )}
        </section>
      ) : (
        <>
          {pillars.length > 0 ? (
            <section className='mt-14'>
              <h2 className='font-display text-sm font-semibold uppercase tracking-[0.14em] text-pp-ink-violet'>
                {copy.startHere}
              </h2>
              <div className='mt-5 grid gap-5 sm:grid-cols-2'>
                {pillars.map(post => (
                  <PostCard key={post.slug} post={post} kind={kindMap.get(post.kind)} featured />
                ))}
              </div>
            </section>
          ) : null}

          {series.map(item => {
            const items = bySeries.get(item.slug) ?? []
            if (items.length === 0) return null

            return (
              /*
                `id` on the section, so a post can link back up to its own cluster with
                `/blog#<series-slug>` - which is what the series label above every post title
                now points at. Without it the "up" edge of the hub-and-spoke model had nowhere
                to land and a post could only link to the top of the index, which on an index
                with four sections is not the same place.

                `scroll-mt-6` so the heading is not flush against the viewport edge after the
                jump, which reads as having overshot by a section.
              */
              <section key={item.slug} id={item.slug} className='mt-14 scroll-mt-6'>
                {/*
                  Violet, the same ink a post's series eyebrow and the prose h2s use. A series
                  is the one concept that appears on three surfaces - the cluster heading here,
                  the "up" link on every post in it, and the section headings inside a post -
                  so it gets one hue across all three.

                  `More posts` below deliberately stays `--pp-text`. It is the bucket for posts
                  that belong to NO series, and the absence of the colour is what says so.
                */}
                <h2 className='font-display text-xl font-semibold text-pp-ink-violet'>{item.title}</h2>
                {item.blurb ? (
                  <p className='mt-1 max-w-[60ch] text-sm text-pp-muted'>{item.blurb}</p>
                ) : null}
                <div className='mt-5 grid gap-5 sm:grid-cols-2'>
                  {items.map(post => (
                    <PostCard key={post.slug} post={post} kind={kindMap.get(post.kind)} />
                  ))}
                </div>
              </section>
            )
          })}

          {unclustered.length > 0 ? (
            <section className='mt-14'>
              <h2 className='font-display text-xl font-semibold text-pp-text'>{copy.morePosts}</h2>
              <div className='mt-5 grid gap-5 sm:grid-cols-2'>
                {unclustered.map(post => (
                  <PostCard key={post.slug} post={post} kind={kindMap.get(post.kind)} />
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}
    </>
  )
}
