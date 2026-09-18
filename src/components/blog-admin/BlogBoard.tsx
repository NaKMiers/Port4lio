'use client'

import Link from 'next/link'
import { useCallback, useEffect, useEffectEvent, useState } from 'react'

import PostRowActions from '@/components/blog-admin/PostRowActions'
import OwnerAuthGate from '@/components/settings/OwnerAuthGate'
import SettingErrorBanner from '@/components/settings/SettingErrorBanner'
import SettingLoading from '@/components/settings/SettingLoading'
import { inputCls, primaryBtnCls, secondaryBtnCls } from '@/components/settings/settings-utils'

/**
 * `/admin/blog` - every post, and the two numbers that decide whether this is working.
 *
 * ```
 *   ┌────────────────────────────────────────────────────────────┐
 *   │  14 days since the last publish        ← the kill signal   │
 *   ├────────────────────────────────────────────────────────────┤
 *   │  new-slug ............................ [ Create draft ]    │
 *   ├────────────────────────────────────────────────────────────┤
 *   │  ● published  five-things-next-16   edit · revalidate · ✕  │
 *   │  ○ draft      shipping-two-tests    edit · ✕               │
 *   │  ◌ archived   an-old-take           edit · revalidate · ✕  │
 *   │  ✕ deleted    gone-but-slug-held    (holds its slug)       │
 *   └────────────────────────────────────────────────────────────┘
 * ```
 *
 * ## Days since the last publish is at the top on purpose
 *
 * It is the one number on this page that predicts failure. Of 27 blogs reviewed for this
 * feature, 10 had gone quiet, and going quiet is not a decision anybody makes - it is a
 * number drifting upward while nobody is looking at it. The cadence commitment is 2 articles
 * and 8 notes in 6 weeks, so anything past about two weeks means the commitment is already
 * slipping, and the board says so rather than leaving it to be inferred from a list of dates.
 *
 * ## Deleted posts are listed, greyed, and not hidden
 *
 * A soft-deleted post keeps its slug forever, so that a new post cannot inherit its contact
 * attributions. Hiding them would leave the owner unable to explain why a slug they deleted
 * last week is refused on create.
 */

type BoardPost = {
  _id: string
  slug: string
  title: string
  kind: string
  series: string | null
  isPillar: boolean
  coverImage: string | null
  status: 'draft' | 'published' | 'archived' | 'deleted'
  publishedAt: string | null
  updatedAt: string
  /**
   * DOCUMENT counts, never a sum of `count`. One reader refreshing five times is one view.
   * `views` is advisory: `sessionId` is client-chosen, so it is honest as a trend and
   * worthless as a number to quote. The kill criterion reads ContactMessage.sourceSlug.
   */
  metrics: { views: number; shares: number; attributions: number }
}

const STATUS_MARK: Record<BoardPost['status'], string> = {
  published: '●',
  draft: '○',
  archived: '◌',
  deleted: '✕',
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
}

export default function BlogBoard() {
  const [posts, setPosts] = useState<BoardPost[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [newSlug, setNewSlug] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch('/api/admin/blog', { cache: 'no-store' })
      if (res.status === 401) {
        // The gate below renders the login card; leaving posts null keeps the board hidden.
        setPosts(null)
        return
      }
      const data = (await res.json()) as { posts?: BoardPost[]; error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Could not load posts')
      setPosts(data.posts ?? [])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load posts')
      setPosts([])
    }
  }, [])

  const bootstrap = useEffectEvent(() => {
    void load()
  })

  // Deferred to a macrotask so the fetch's setState does not run inside the effect body,
  // matching PublishBoard and AppProvider. The lint rule this satisfies is not a formality:
  // a setState in an effect body cascades a second render before paint.
  useEffect(() => {
    const timer = window.setTimeout(() => bootstrap(), 0)
    return () => window.clearTimeout(timer)
  }, [])

  /**
   * Create a draft, optionally pre-filled from a source comment.
   *
   * Creates an empty draft and reloads the board. It used to have a second path - paste a
   * doc comment and get a draft pre-filled with the seven-step template (T20) - which was
   * removed along with `lib/blog/draft-template.ts`.
   */
  async function create() {
    const slug = newSlug.trim()
    if (!slug) return

    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/blog', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug, title: slug.replace(/-/g, ' ') }),
      })
      const data = (await res.json()) as { error?: string; id?: string }
      if (!res.ok) throw new Error(data.error ?? 'Could not create the draft')

      setNewSlug('')
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create the draft')
    } finally {
      setBusy(false)
    }
  }

  async function mutate(id: string, body: Record<string, unknown>, method: 'PATCH' | 'DELETE') {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/blog/${id}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: method === 'PATCH' ? JSON.stringify(body) : undefined,
      })
      const data = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'That did not work')
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That did not work')
    } finally {
      setBusy(false)
    }
  }

  if (posts === null && !error) {
    return (
      <OwnerAuthGate onAuthed={() => void load()}>
        <SettingLoading
          title='Loading posts...'
          subtitle='Reading the blog board.'
        />
      </OwnerAuthGate>
    )
  }

  const lastPublished = (posts ?? [])
    .filter(post => post.status === 'published' && post.publishedAt)
    .map(post => post.publishedAt as string)
    .sort()
    .at(-1) ?? null
  const quietDays = daysSince(lastPublished)

  return (
    <OwnerAuthGate onAuthed={() => void load()}>
      <div className='mx-auto w-full max-w-editorial px-gutter py-10'>
        <header className='flex flex-wrap items-baseline justify-between gap-4'>
          <div>
            <h1 className='font-display text-2xl font-semibold tracking-tight'>Blog</h1>
            <p className='mt-1 text-sm text-pp-muted'>
              {quietDays === null
                ? 'Nothing published yet.'
                : `${quietDays} day${quietDays === 1 ? '' : 's'} since the last publish.`}
              {quietDays !== null && quietDays > 14 ? (
                <span className='ml-2 font-semibold text-pp-text'>
                  Cadence is 2 articles + 8 notes in 6 weeks.
                </span>
              ) : null}
            </p>
          </div>
          <div className='flex gap-2'>
            <Link className={secondaryBtnCls} href='/admin/settings'>
              Settings
            </Link>
            <Link className={secondaryBtnCls} href='/blog'>
              View blog
            </Link>
          </div>
        </header>

        {error ? <div className='mt-6'><SettingErrorBanner message={error} /></div> : null}

        <div className='mt-8 flex flex-wrap items-end gap-3'>
          <div className='min-w-[16rem] flex-1'>
            <label className='mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-pp-muted' htmlFor='new-slug'>
              New draft slug
            </label>
            <input
              id='new-slug'
              className={inputCls}
              value={newSlug}
              onChange={event => setNewSlug(event.target.value)}
              placeholder='five-things-next-16-did'
            />
          </div>
          <button className={primaryBtnCls} onClick={() => void create()} disabled={busy}>
            Create draft
          </button>
        </div>

        <ul className='mt-8 space-y-2'>
          {(posts ?? []).map(post => (
            <li
              key={post._id}
              className={[
                /*
                  `bg-white/72` with no blur and no shadow was fine over the flat page this
                  board used to render on. It is not fine over `AdminBackdrop`: the floating
                  shapes and colour pools now pass straight under the row, so a 72% white with
                  nothing lifting it read as a faint outline with the decoration showing
                  through the title.

                  `/85` and not `/82`, and that is not a taste call. Tailwind's default opacity
                  scale is multiples of five, and a `/n` outside it MATCHES NOTHING - the
                  utility is never generated and the element ends up with no background at all,
                  silently. The old `bg-white/72` here was one of those: this row has had no
                  background since it was written, which is what made it read as a faint
                  outline over the decoration. `tailwind.config.ts` documents the same failure
                  for `pp-*` colours and fixes it with `ppColor()`; plain `white` does not go
                  through that helper, so the only defence is staying on the scale.
                */
                'flex flex-wrap items-center gap-3 rounded-[1.4rem] border border-pp-line bg-white/85 px-4 py-3 shadow-[0_18px_36px_rgba(46,35,28,0.06)] backdrop-blur-md transition',
                'hover:border-pp-blue/30 hover:bg-white/95',
                post.status === 'deleted' ? 'opacity-50' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <span aria-hidden className='w-4 text-pp-muted'>
                {STATUS_MARK[post.status]}
              </span>
              <span className='sr-only'>{post.status}</span>

              {/*
                A fixed-size slot whether or not there is an image, so the titles stay on one
                vertical line down the board. A thumbnail that collapsed when absent would
                indent every covered row relative to every uncovered one, which on a list you
                scan is worse than a little empty space.

                `alt=''`: the title is the next element and says the same thing.
              */}
              <span className='hidden h-10 w-16 shrink-0 overflow-hidden rounded-[0.6rem] border border-pp-line bg-white/60 sm:block'>
                {post.coverImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={post.coverImage}
                    alt=''
                    aria-hidden
                    loading='lazy'
                    className='h-full w-full object-cover'
                  />
                ) : null}
              </span>

              <span className='min-w-0 flex-1'>
                <span className='block truncate font-display text-sm font-semibold'>
                  {post.title}
                </span>
                <span className='block truncate text-xs text-pp-muted'>
                  /blog/{post.slug}
                  {post.isPillar ? ' · pillar' : ''}
                  {post.series ? ` · ${post.series}` : ''}
                  {' · edited '}
                  {new Date(post.updatedAt).toLocaleDateString('en-GB')}
                  {post.status === 'published'
                    ? ` · ${post.metrics.views} read · ${post.metrics.shares} shared · ${post.metrics.attributions} arrived`
                    : ''}
                </span>
              </span>

              {post.status !== 'deleted' ? (
                /*
                  Four actions still wrap badly on a narrow row, so `PostRowActions` renders
                  them inline from `md` up and behind one trigger below it.
                */
                <PostRowActions
                  label={`Actions for ${post.title || post.slug}`}
                  actions={[
                    /*
                      Ordered by how often each is reached for and how hard it is to undo:
                      View and Edit are the everyday pair, Archive is reversible, Delete is
                      last and separated. `Revalidate` used to sit between them - an empty
                      PATCH that re-ran `revalidatePath` by hand - and was removed with the
                      rest of that feature. Note the FUNCTION survives: PATCH and DELETE still
                      call `revalidatePublishedPost`, which is how a publish reaches a reader
                      inside the 300s ISR window at all.
                    */
                    ...(post.status === 'published'
                      ? [
                          /*
                            Published only, and the same rule `BlogToolbar`'s "View live"
                            follows. `readPublishedPost` filters on `status: 'published'`, so
                            this link on a draft or an archived post is a 404 - a button that
                            reliably breaks is worse than no button.

                            Same tab rather than `target='_blank'`. `PostTracker`'s `sessionId`
                            lives in sessionStorage, which is per-tab: navigating here reuses
                            this tab's id so every later visit de-duplicates, while a new tab
                            can mint a fresh one each time and add a unique read to the very
                            `metrics.views` number printed on this row.
                          */
                          { key: 'view', label: 'View', href: `/blog/${post.slug}` },
                        ]
                      : []),
                    { key: 'edit', label: 'Edit', href: `/admin/blog/${post._id}` },
                    ...(post.status === 'published'
                      ? [
                          {
                            key: 'archive',
                            label: 'Archive',
                            disabled: busy,
                            onSelect: () => void mutate(post._id, { status: 'archived' }, 'PATCH'),
                          },
                        ]
                      : [
                          {
                            key: 'publish',
                            label: 'Publish',
                            disabled: busy,
                            onSelect: () => void mutate(post._id, { status: 'published' }, 'PATCH'),
                          },
                        ]),
                    {
                      key: 'delete',
                      label: 'Delete',
                      disabled: busy,
                      separated: true,
                      onSelect: () => void mutate(post._id, {}, 'DELETE'),
                    },
                  ]}
                />
              ) : (
                <span className='text-xs text-pp-muted'>holds its slug</span>
              )}
            </li>
          ))}
        </ul>

        {posts !== null && posts.length === 0 && !error ? (
          <p className='mt-8 text-sm text-pp-muted'>
            No posts yet. The first three should be mined from source comments you have
            already written - see <code>docs/blog/authoring.md</code>.
          </p>
        ) : null}
      </div>
    </OwnerAuthGate>
  )
}
