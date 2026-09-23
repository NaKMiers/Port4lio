'use client'

import { LayoutGrid, List, Search, X } from 'lucide-react'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'

import PostCard from '@/components/blog/PostCard'
import { useBlogLocale } from '@/components/blog/BlogLocaleProvider'
import type { PostListItem } from '@/lib/blog/post-data'

/**
 * The `/blog` index list, with search over it.
 *
 * ```
 *   query empty, "By category"  ->  Start here  /  <series>  /  More posts   (the grouped browse)
 *   query empty, "List"         ->  every post as a card, two columns, no groups
 *   query set                   ->  one flat list of cards, "N posts match"   (the results view)
 * ```
 *
 * Every view is in the order the page hands down: newest-created first.
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
 * reader with JS disabled both get every post, in the default List view. The search input
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

/**
 * "By category" or "List", remembered per browser.
 *
 * `localStorage`, read through `useSyncExternalStore` with a server snapshot of `list`, the
 * default: the server HTML (what a crawler and a no-JS reader get) is always the list, and
 * a reader who chose "By category" switches to it one commit after hydration, with no
 * mismatch.
 */
type IndexView = 'grouped' | 'list'

const VIEW_STORAGE_KEY = 'blog-index-view'
const viewListeners = new Set<() => void>()
// This visit's choice; wins over storage, and carries it when storage throws.
let memoryView: IndexView | null = null

function readView(): IndexView {
  if (memoryView) return memoryView
  try {
    return window.localStorage.getItem(VIEW_STORAGE_KEY) === 'grouped'
      ? 'grouped'
      : 'list'
  } catch {
    return 'list'
  }
}

function writeView(view: IndexView) {
  memoryView = view
  try {
    window.localStorage.setItem(VIEW_STORAGE_KEY, view)
  } catch {
    // Private mode or blocked storage: `memoryView` keeps the toggle working this visit.
  }
  viewListeners.forEach(listener => listener())
}

function subscribeView(listener: () => void) {
  viewListeners.add(listener)
  return () => {
    viewListeners.delete(listener)
  }
}

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
  const view = useSyncExternalStore(
    subscribeView,
    readView,
    () => 'list' as const
  )
  const inputRef = useRef<HTMLInputElement>(null)
  const { copy } = useBlogLocale()

  // `/` focuses the search from anywhere on the page, unless the reader is already typing
  // somewhere - a slash in a textarea or the subscribe box is a slash, not a shortcut.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey)
        return
      const target = event.target as HTMLElement | null
      if (
        target &&
        (target.isContentEditable ||
          ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
      )
        return
      event.preventDefault()
      inputRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
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
    if (post.series && bySeries.has(post.series))
      bySeries.get(post.series)?.push(post)
    else unclustered.push(post)
  }

  return (
    <>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
        <label
          className="sr-only"
          htmlFor="blog-search"
        >
          {copy.searchLabel}
        </label>
        <div className="group/search relative flex-1">
          {/* After the input in paint order would be simpler, but the icon comes first so
              it reads naturally in the source - `z-10` is what keeps it above the input,
              whose `backdrop-blur` makes it a stacking context that would otherwise cover it
              (which is exactly how it vanished on focus before). */}
          <Search
            aria-hidden
            size={17}
            className="pointer-events-none absolute left-4 top-1/2 z-10 -translate-y-1/2 text-pp-muted transition-colors group-focus-within/search:text-pp-ink-blue"
          />
          <input
            ref={inputRef}
            id="blog-search"
            type="search"
            value={query}
            onChange={event => setQuery(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Escape' && query) {
                event.preventDefault()
                setQuery('')
              }
            }}
            placeholder={copy.searchPlaceholder}
            autoComplete="off"
            spellCheck={false}
            className="h-12 w-full rounded-2xl border border-pp-line bg-white/80 pl-11 pr-24 text-[0.95rem] text-pp-text shadow-[0_10px_30px_rgba(46,35,28,0.06),inset_0_1px_0_rgba(255,255,255,0.9)] outline-none backdrop-blur-md transition-[border-color,box-shadow,background-color] placeholder:text-pp-muted/70 hover:border-pp-muted/35 focus:border-pp-ink-blue/45 focus:bg-white focus:shadow-[0_0_0_4px_rgba(51,152,255,0.14),0_10px_30px_rgba(46,35,28,0.06)] [&::-webkit-search-cancel-button]:appearance-none"
          />
          <div className="absolute right-2.5 top-1/2 flex -translate-y-1/2 items-center">
            {query ? (
              <button
                type="button"
                onClick={() => {
                  setQuery('')
                  inputRef.current?.focus()
                }}
                aria-label={copy.searchClear}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-pp-muted transition hover:bg-pp-bg hover:text-pp-text"
              >
                <X
                  aria-hidden
                  size={15}
                />
              </button>
            ) : (
              <kbd
                title={copy.searchShortcut}
                className="pointer-events-none hidden h-7 min-w-[1.75rem] items-center justify-center rounded-lg border border-pp-line bg-pp-bg px-2 font-mono text-xs text-pp-muted sm:inline-flex"
              >
                /
              </kbd>
            )}
          </div>
        </div>

        {/* The view only changes the browse; a search always shows its flat results, so the
            toggle is disabled while there is a query rather than silently doing nothing. */}
        <div
          role="group"
          aria-label={copy.viewLabel}
          className="inline-flex shrink-0 items-center gap-0.5 self-end rounded-2xl border border-pp-line bg-white/80 p-1 shadow-[0_10px_30px_rgba(46,35,28,0.06)] backdrop-blur-md sm:self-auto"
        >
          {(
            [
              {
                value: 'grouped',
                label: copy.viewByCategory,
                Icon: LayoutGrid,
              },
              { value: 'list', label: copy.viewList, Icon: List },
            ] as const
          ).map(({ value, label, Icon }) => {
            const active = view === value
            return (
              <button
                key={value}
                type="button"
                onClick={() => writeView(value)}
                aria-pressed={active}
                disabled={Boolean(trimmed)}
                className={[
                  'inline-flex h-10 items-center gap-2 rounded-xl px-3.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50',
                  active
                    ? 'bg-pp-text text-[var(--pp-bg)] shadow-[0_6px_14px_rgba(31,28,26,0.18)]'
                    : 'text-pp-muted hover:bg-pp-bg hover:text-pp-text',
                ].join(' ')}
              >
                <Icon
                  aria-hidden
                  size={15}
                />
                {label}
              </button>
            )
          })}
        </div>
      </div>

      {trimmed ? (
        <section
          className="mt-10"
          aria-live="polite"
        >
          <h2 className="font-display text-sm font-semibold uppercase tracking-[0.14em] text-pp-ink-violet">
            {matches.length === 0
              ? copy.resultsNone
              : matches.length === 1
                ? copy.resultsOne
                : copy.resultsMany(matches.length)}
          </h2>

          {matches.length === 0 ? (
            <p className="mt-4 max-w-[60ch] text-pp-muted">
              {copy.noMatchBody(query.trim())}
            </p>
          ) : (
            <div className="mt-5 grid gap-5 sm:grid-cols-2">
              {matches.map(post => (
                <PostCard
                  key={post.slug}
                  post={post}
                  kind={kindMap.get(post.kind)}
                />
              ))}
            </div>
          )}
        </section>
      ) : view === 'list' ? (
        // The same cards as the grouped browse, in one grid: every post, no headings. With
        // no section heading to say which category a post is in, each card says it itself.
        <section className="mt-10">
          <div className="grid gap-5 sm:grid-cols-2">
            {posts.map(post => (
              <PostCard
                key={post.slug}
                post={post}
                kind={kindMap.get(post.kind)}
                category={
                  post.series ? (seriesTitle.get(post.series) ?? null) : null
                }
              />
            ))}
          </div>
        </section>
      ) : (
        <>
          {pillars.length > 0 ? (
            <section className="mt-14">
              <h2 className="font-display text-sm font-semibold uppercase tracking-[0.14em] text-pp-ink-violet">
                {copy.startHere}
              </h2>
              <div className="mt-5 grid gap-5 sm:grid-cols-2">
                {pillars.map(post => (
                  <PostCard
                    key={post.slug}
                    post={post}
                    kind={kindMap.get(post.kind)}
                    featured
                  />
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
              <section
                key={item.slug}
                id={item.slug}
                className="mt-14 scroll-mt-6"
              >
                {/*
                  Violet, the same ink a post's series eyebrow and the prose h2s use. A series
                  is the one concept that appears on three surfaces - the cluster heading here,
                  the "up" link on every post in it, and the section headings inside a post -
                  so it gets one hue across all three.

                  `More posts` below deliberately stays `--pp-text`. It is the bucket for posts
                  that belong to NO series, and the absence of the colour is what says so.
                */}
                <h2 className="font-display text-xl font-semibold text-pp-ink-violet">
                  {item.title}
                </h2>
                {item.blurb ? (
                  <p className="mt-1 max-w-[60ch] text-sm text-pp-muted">
                    {item.blurb}
                  </p>
                ) : null}
                <div className="mt-5 grid gap-5 sm:grid-cols-2">
                  {items.map(post => (
                    <PostCard
                      key={post.slug}
                      post={post}
                      kind={kindMap.get(post.kind)}
                    />
                  ))}
                </div>
              </section>
            )
          })}

          {unclustered.length > 0 ? (
            <section className="mt-14">
              <h2 className="font-display text-xl font-semibold text-pp-text">
                {copy.morePosts}
              </h2>
              <div className="mt-5 grid gap-5 sm:grid-cols-2">
                {unclustered.map(post => (
                  <PostCard
                    key={post.slug}
                    post={post}
                    kind={kindMap.get(post.kind)}
                  />
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}
    </>
  )
}
