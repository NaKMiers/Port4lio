'use client'

import Link from 'next/link'
import { useCallback, useEffect, useEffectEvent, useState } from 'react'

import ConfirmDialog from '@/components/blog-admin/ConfirmDialog'
import GenerateBlogButton from '@/components/blog-admin/GenerateBlogButton'
import GenerateBlogDialog from '@/components/blog-admin/GenerateBlogDialog'
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
 *   │  new-slug .......... [ Create draft ] [ ✨ Generate blog ]  │
 *   ├────────────────────────────────────────────────────────────┤
 *   │  ● published  five-things-next-16   edit · revalidate · ✕  │
 *   │  ○ draft      shipping-two-tests    edit · ✕               │
 *   │  ◌ archived   an-old-take           edit · revalidate · ✕  │
 *   │  ✕ deleted    gone-but-slug-held    restore · delete forever│
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
 *
 * ## Delete forever is on that row, and it is the one action that breaks the rule above
 *
 * Removing the document releases the slug, which is exactly what the soft delete existed to
 * prevent. It is offered anyway, because a board that accumulates every mistake forever is a
 * board nobody reads - but only from a row that is already deleted, and only after a confirm
 * that names the consequence. If the slug is on real `ContactMessage` rows the server refuses
 * the first press and returns the count, and the dialog shows it before asking again. See the
 * DELETE handler for why the messages themselves are never touched.
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
  /**
   * How many `![image](imageN)` placeholders are still unresolved in the body.
   *
   * The board never receives the body itself, so this count is computed server-side. It exists
   * because Publish here is one click with no confirm, and every generated post starts with
   * unresolved placeholders - each of which publishes as a sourceless `<img>`, i.e. a
   * broken-image icon on a live page.
   */
  unresolvedImages: number
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
  const [pendingDelete, setPendingDelete] = useState<{ id: string; title: string } | null>(null)
  /**
   * The permanent-delete confirm, and `contactMessages` is the two-stage part.
   *
   * `null` is the first press: "this frees the slug". A NUMBER means the server refused once
   * because that slug is on real contact messages, and the dialog is now showing the count
   * before the second, acknowledged press. One piece of state rather than two booleans, so
   * the two stages cannot both be true.
   */
  const [pendingPurge, setPendingPurge] = useState<{
    id: string
    slug: string
    title: string
    contactMessages: number | null
  } | null>(null)
  /**
   * The publish confirm, raised ONLY when the post still has unresolved image placeholders.
   *
   * A clean post publishes on the first click exactly as before - a confirm on every publish
   * would be a dialog the owner learns to dismiss without reading, which is worse than none.
   */
  const [pendingPublish, setPendingPublish] = useState<{
    id: string
    title: string
    unresolvedImages: number
  } | null>(null)
  const [generating, setGenerating] = useState(false)

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

  /**
   * Remove a soft-deleted post for good.
   *
   * Two passes by design. The first is refused with a count if the slug is on real contact
   * messages - the refusal IS the warning, the same shape the series delete guard uses - and
   * the second carries `acknowledge=true` to say the owner has seen it. A slug with nothing
   * against it goes on the first press and never shows the second dialog at all.
   */
  async function purge(id: string, slug: string, title: string, acknowledge: boolean) {
    setBusy(true)
    setError(null)
    try {
      const query = `permanent=true${acknowledge ? '&acknowledge=true' : ''}`
      const res = await fetch(`/api/admin/blog/${id}?${query}`, { method: 'DELETE' })
      const data = (await res.json()) as { error?: string; contactMessages?: number }

      if (res.status === 409 && typeof data.contactMessages === 'number') {
        // Re-open the same dialog in its second stage rather than surfacing a banner: the
        // decision is still in front of the owner, so the number belongs where the button is.
        setPendingPurge({ id, slug, title, contactMessages: data.contactMessages })
        return
      }
      if (!res.ok) throw new Error(data.error ?? 'Could not delete the post')

      setPendingPurge(null)
      await load()
    } catch (cause) {
      setPendingPurge(null)
      setError(cause instanceof Error ? cause.message : 'Could not delete the post')
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
          {/*
            Beside Create draft, and second. The order is the reading order of what they do:
            the left one makes an empty page to write on, the right one writes it. Putting the
            expensive, animated control first would make it the default press.
          */}
          <GenerateBlogButton onClick={() => setGenerating(true)} disabled={busy} />
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
                `alt=''`: the title is the next element and says the same thing. No box at all
                when there is no cover - an empty bordered slot read as a broken thumbnail
                rather than as "no image".
              */}
              {post.coverImage ? (
                <span className='hidden h-10 w-16 shrink-0 overflow-hidden rounded-[0.6rem] border border-pp-line bg-white/60 sm:block'>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={post.coverImage}
                    alt=''
                    aria-hidden
                    loading='lazy'
                    className='h-full w-full object-cover'
                  />
                </span>
              ) : null}

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
                            onSelect: () =>
                              post.unresolvedImages > 0
                                ? setPendingPublish({
                                    id: post._id,
                                    title: post.title || post.slug,
                                    unresolvedImages: post.unresolvedImages,
                                  })
                                : void mutate(post._id, { status: 'published' }, 'PATCH'),
                          },
                        ]),
                    {
                      key: 'delete',
                      label: 'Delete',
                      disabled: busy,
                      separated: true,
                      onSelect: () => setPendingDelete({ id: post._id, title: post.title || post.slug }),
                    },
                  ]}
                />
              ) : (
                <span className='flex items-center gap-3'>
                  <span className='text-xs text-pp-muted'>holds its slug</span>
                  <PostRowActions
                    label={`Restore ${post.title || post.slug}`}
                    actions={[
                      {
                        key: 'restore',
                        label: 'Restore',
                        disabled: busy,
                        /*
                          Restore NEVER republishes. `archived` when the post was public before
                          it was deleted, `draft` when it never was.

                          The obvious version of this - `publishedAt ? 'published' : 'draft'` -
                          is wrong, and wrong in the direction that puts content in front of
                          readers. `publishedAt` is write-once and SURVIVES archiving (see
                          `models/Post.ts`), so it does not mean "was public when deleted", it
                          means "was public at some point". A post that was published, then
                          deliberately taken down, then deleted, came back LIVE on restore and
                          `revalidatePublishedPost` pushed it out - undoing a takedown the owner
                          chose, with one menu click and no confirm.

                          Restoring to `archived` is recoverable in the direction that matters:
                          the post is back on the board, out of the bin, and one deliberate
                          Publish away from live. The status enum has four values and this
                          branch only ever had two.
                        */
                        onSelect: () =>
                          void mutate(
                            post._id,
                            { status: post.publishedAt ? 'archived' : 'draft' },
                            'PATCH'
                          ),
                      },
                      /*
                        Offered only on a row that is ALREADY deleted, which is the server's
                        precondition too - so reaching this needs two separate deletions with a
                        confirm on each. Last and `separated`, the same position Delete holds on
                        a live row, because it is the same "no way back" slot one step further.
                      */
                      {
                        key: 'purge',
                        label: 'Delete forever',
                        disabled: busy,
                        separated: true,
                        onSelect: () =>
                          setPendingPurge({
                            id: post._id,
                            slug: post.slug,
                            title: post.title || post.slug,
                            contactMessages: null,
                          }),
                      },
                    ]}
                  />
                </span>
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

      {/*
        Mounted only while open, rather than always-mounted behind an `open` prop. That is what
        makes each opening start fresh: the dialog's spec is `useState` initialiser state, so a
        dialog kept mounted would reopen holding the last run's settings and its stale result
        card.
      */}
      {generating ? (
        <GenerateBlogDialog
          onClose={() => setGenerating(false)}
          // The dialog stays open on success to show its warnings, so the board refreshes
          // underneath it rather than waiting for a close that may not come for a minute.
          onGenerated={() => void load()}
        />
      ) : null}

      {/*
        One dialog, two stages, keyed off `contactMessages`. The second stage is only ever
        reached when the server has said the slug is on real messages, so the scarier copy is
        never shown to somebody deleting a post that carried nothing.
      */}
      <ConfirmDialog
        open={pendingPurge !== null}
        title={
          pendingPurge?.contactMessages
            ? 'This slug is on real messages'
            : 'Delete this post forever?'
        }
        message={
          pendingPurge?.contactMessages ? (
            <>
              <p>
                <strong className='font-semibold text-pp-text'>
                  {pendingPurge.contactMessages} contact message
                  {pendingPurge.contactMessages === 1 ? '' : 's'}
                </strong>{' '}
                came from <code>/blog/{pendingPurge.slug}</code>. The messages are kept either
                way - they are not deleted with the post.
              </p>
              <p className='mt-2'>
                What is released is the slug. A future post taking{' '}
                <code>{pendingPurge.slug}</code> would inherit{' '}
                {pendingPurge.contactMessages === 1 ? 'that attribution' : 'those attributions'},
                which is the one number the blog is measured by.
              </p>
            </>
          ) : (
            <>
              &quot;{pendingPurge?.title ?? ''}&quot; and its read counts will be removed from the
              database. This cannot be undone, and <code>{pendingPurge?.slug}</code> becomes
              available for a new post to take.
            </>
          )
        }
        confirmLabel={pendingPurge?.contactMessages ? 'Delete anyway' : 'Delete forever'}
        busy={busy}
        onCancel={() => setPendingPurge(null)}
        onConfirm={() => {
          if (!pendingPurge) return
          const { id, slug, title, contactMessages } = pendingPurge
          // The second press carries the acknowledgement. The first does not, which is what
          // lets the server refuse it and hand back the count.
          void purge(id, slug, title, contactMessages !== null)
        }}
      />

      <ConfirmDialog
        open={pendingPublish !== null}
        title='This post has images that were never made'
        message={
          <>
            <p>
              &quot;{pendingPublish?.title ?? ''}&quot; still has{' '}
              <strong className='font-semibold text-pp-text'>
                {pendingPublish?.unresolvedImages}{' '}
                {pendingPublish?.unresolvedImages === 1 ? 'placeholder' : 'placeholders'}
              </strong>{' '}
              in the body.
            </p>
            <p className='mt-2'>
              A placeholder is refused by the renderer and published as an image with no source,
              which every browser paints as a broken-image icon. Open the post and upload them,
              or publish now and fix it after - the choice is yours, but it will be visible.
            </p>
          </>
        }
        confirmLabel='Publish anyway'
        busy={busy}
        onCancel={() => setPendingPublish(null)}
        onConfirm={() => {
          if (!pendingPublish) return
          const { id } = pendingPublish
          setPendingPublish(null)
          void mutate(id, { status: 'published' }, 'PATCH')
        }}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        title='Delete this post?'
        message={`"${pendingDelete?.title ?? ''}" will be soft-deleted. Its slug stays reserved and the row stays on this board, greyed out.`}
        confirmLabel='Delete'
        busy={busy}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (!pendingDelete) return
          const { id } = pendingDelete
          setPendingDelete(null)
          void mutate(id, {}, 'DELETE')
        }}
      />
    </OwnerAuthGate>
  )
}
