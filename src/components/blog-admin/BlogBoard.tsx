'use client'

import Link from 'next/link'
import { useCallback, useEffect, useEffectEvent, useState } from 'react'

import OwnerAuthGate from '@/components/settings/OwnerAuthGate'
import SettingErrorBanner from '@/components/settings/SettingErrorBanner'
import SettingLoading from '@/components/settings/SettingLoading'
import { buildDraftFromSourceComment } from '@/lib/blog/draft-template'
import { ghostBtnCls, inputCls, primaryBtnCls, secondaryBtnCls, textareaCls } from '@/components/settings/settings-utils'

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
 * ## Why there is a Force revalidate button
 *
 * When a published post does not look right on `/blog`, there are exactly three explanations
 * and they are indistinguishable from the outside: the ISR window has not elapsed, a
 * `revalidatePath` call failed, or the post never made it into `generateStaticParams`. The
 * owner cannot tell which, and the first is fine while the second is a bug.
 *
 * This button collapses that. Press it, and if the page is still wrong the ISR window was not
 * the explanation. It is a PATCH with no changes, which runs `revalidatePublishedPost` through
 * the same path a real save does - so it also proves that path still works.
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
  kind: 'article' | 'note'
  series: string | null
  isPillar: boolean
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
  const [sourceComment, setSourceComment] = useState('')
  const [sourceFile, setSourceFile] = useState('')

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
   * The two paths are one function because they differ by one field. A bare create makes an
   * empty draft; pasting a comment makes one with the seven-step template already in it and
   * the comment parked at the bottom - which is the whole of T20. See
   * `lib/blog/draft-template.ts` for why this exists instead of the source-comment miner
   * that was cut, and why a topic-to-post generator was refused outright.
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

      // Two requests rather than one: POST creates, PATCH renders the body through the
      // markdown pipeline. Folding a body into the create would mean a second code path that
      // also has to render, and rendering is what PATCH is already for.
      if (sourceComment.trim() && data.id) {
        await fetch(`/api/admin/blog/${data.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            bodyMarkdown: buildDraftFromSourceComment({
              comment: sourceComment,
              sourceFile: sourceFile.trim() || undefined,
            }),
          }),
        })
      }

      setNewSlug('')
      setSourceComment('')
      setSourceFile('')
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
      <div className='portfolio-public-root min-h-screen pt-12 text-pp-text'>
        <div className='mx-auto max-w-editorial px-gutter py-10'>
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
              {sourceComment.trim() ? 'Create from comment' : 'Create draft'}
            </button>
          </div>

          {/*
            T20. The 90% of the cut source-comment miner that had value: the miner was a
            search engine over eight things already listed by name in docs/blog/authoring.md.
            What "I do not want to spend four hours per post" actually meant is the blank
            page and re-deriving the structure, not the writing - so paste the comment you
            already wrote and the template arrives filled in.
          */}
          <details className='mt-4'>
            <summary className='cursor-pointer text-[11px] font-semibold uppercase tracking-[0.16em] text-pp-muted'>
              Start from a source comment
            </summary>
            <div className='mt-3 space-y-3'>
              <input
                className={inputCls}
                value={sourceFile}
                onChange={event => setSourceFile(event.target.value)}
                placeholder='src/lib/blog/revalidate.ts  (optional, for attribution)'
              />
              <textarea
                className={`${textareaCls} min-h-[10rem] font-mono text-[13px]`}
                value={sourceComment}
                onChange={event => setSourceComment(event.target.value)}
                placeholder='Paste the doc comment. The seven-step template and the title rule come with it.'
              />
            </div>
          </details>

          <ul className='mt-8 space-y-2'>
            {(posts ?? []).map(post => (
              <li
                key={post._id}
                className={[
                  'flex flex-wrap items-center gap-3 rounded-[1.2rem] border border-pp-line bg-white/72 px-4 py-3',
                  post.status === 'deleted' ? 'opacity-50' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <span aria-hidden className='w-4 text-pp-muted'>
                  {STATUS_MARK[post.status]}
                </span>
                <span className='sr-only'>{post.status}</span>

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
                  <span className='flex flex-wrap gap-1'>
                    <Link className={ghostBtnCls} href={`/admin/blog/${post._id}`}>
                      Edit
                    </Link>
                    {post.status === 'published' ? (
                      <>
                        <button
                          className={ghostBtnCls}
                          disabled={busy}
                          onClick={() => void mutate(post._id, {}, 'PATCH')}
                          title='Re-run revalidatePath for this post. If /blog is still wrong after this, the ISR window was not the explanation.'
                        >
                          Revalidate
                        </button>
                        <button
                          className={ghostBtnCls}
                          disabled={busy}
                          onClick={() => void mutate(post._id, { status: 'archived' }, 'PATCH')}
                        >
                          Archive
                        </button>
                      </>
                    ) : (
                      <button
                        className={ghostBtnCls}
                        disabled={busy}
                        onClick={() => void mutate(post._id, { status: 'published' }, 'PATCH')}
                      >
                        Publish
                      </button>
                    )}
                    <button
                      className={ghostBtnCls}
                      disabled={busy}
                      onClick={() => void mutate(post._id, {}, 'DELETE')}
                    >
                      Delete
                    </button>
                  </span>
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
      </div>
    </OwnerAuthGate>
  )
}
