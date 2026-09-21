'use client'

import { ChevronDown, ChevronUp, Plus, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react'

import {
  emptyStateCls,
  ghostBtnCls,
  helpTextCls,
  inputCls,
  labelCls,
  primaryBtnCls,
  secondaryBtnCls,
} from '@/components/settings/settings-utils'

/**
 * Manage a blog taxonomy: create, rename, reorder, delete. Serves series AND kinds.
 *
 * ```
 *   GET    /api/admin/blog/<resource>        list + post counts
 *   POST   /api/admin/blog/<resource>        create           slug is set once, here
 *   PATCH  /api/admin/blog/<resource>/[id]   the editable fields, order
 *   DELETE /api/admin/blog/<resource>/[id]   refused with 409 + the posts, if in use
 * ```
 *
 * ## Why one component and not a `KindDialog` beside it
 *
 * The two differ in three data points - the endpoint, the word on the heading, and whether
 * the second editable field is a line of prose or a checkbox. Everything else is identical:
 * the same list, the same immutable-slug rule, the same 409-carries-the-worklist handling,
 * the same `onBlur` save. A copy would have been ninety lines duplicated so that the next fix
 * to the delete-guard rendering could be applied to one of them and forgotten on the other.
 *
 * The guards themselves are NOT shared, deliberately - they live in the two route handlers,
 * because a post may have no series but must always have a kind, and that asymmetry is a
 * server rule. This component only renders whatever refusal it is handed.
 *
 * ## Why the slug is only editable at creation
 *
 * `Post.series` stores the slug, so renaming one either orphans every post pointing at it or
 * needs a multi-document migration with no transaction around it. The API refuses the change;
 * this renders it as static text after creation rather than as a disabled input, because a
 * disabled field invites "why can I not edit this" and the answer belongs next to it. Same
 * treatment, and the same reason, as the post slug in `BlogEditor`.
 *
 * ## Why delete shows the posts rather than just refusing
 *
 * A 409 saying "3 posts still use this" and nothing else leaves the owner to go and find
 * them. The handler returns the titles, so the refusal is also the worklist.
 *
 * ## Why there is no optimistic update
 *
 * Every mutation here re-reads the list. The post counts come from an aggregate over the
 * posts collection, and the ordering is server-assigned on create - so a local guess would
 * be right about the field that was edited and wrong about the two beside it. The list is
 * three or four rows behind an owner gate; a round trip is not the cost worth optimising.
 */

type Entry = {
  id: string
  slug: string
  /** `title` for a series, `label` for a kind. Normalised on read so the list is one shape. */
  name: string
  /** A series' blurb. Absent on kinds. */
  blurb?: string
  /** A kind's "print the label on the card". Absent on series. */
  eyebrow?: boolean
  order: number
  postCount: number
}

export type TaxonomyResource = 'series' | 'kinds'

type Config = {
  heading: string
  intro: string
  /** The JSON key the list arrives under, and the field that carries the display name. */
  listKey: 'series' | 'kinds'
  nameField: 'title' | 'label'
  slugPlaceholder: string
  namePlaceholder: string
  /** Prose under the slug field. Both say the slug is permanent; they differ on why. */
  slugHelp: string
}

const CONFIG: Record<TaxonomyResource, Config> = {
  series: {
    heading: 'Manage series',
    intro:
      'A series is a cluster on /blog. The title and blurb are the heading and the line under it; the order here is the order there.',
    listKey: 'series',
    nameField: 'title',
    slugPlaceholder: 'shipping-side-products',
    namePlaceholder: 'Title, e.g. Shipping side products',
    slugHelp:
      'Set once and permanent - posts reference it. To change it later, create the new series, move the posts, then delete the old one.',
  },
  kinds: {
    heading: 'Manage kinds',
    intro:
      'A kind is the tier a post is written at. Turn on the eyebrow to print its label above the title on the card, the way Note always has.',
    listKey: 'kinds',
    nameField: 'label',
    slugPlaceholder: 'link-roundup',
    namePlaceholder: 'Label, e.g. Link roundup',
    slugHelp:
      'Set once and permanent - posts reference it. To change it later, create the new kind, move the posts, then delete the old one.',
  },
}

export default function TaxonomyDialog({
  resource = 'series',
  open,
  onClose,
  onChanged,
}: {
  resource?: TaxonomyResource
  open: boolean
  onClose: () => void
  /** Fired after any successful mutation, so the editor can refresh its dropdown. */
  onChanged: () => void
}) {
  const config = CONFIG[resource]
  const endpoint = `/api/admin/blog/${resource}`
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [blockedBy, setBlockedBy] = useState<
    { id: string; title: string }[] | null
  >(null)
  const [busy, setBusy] = useState(false)
  const [newSlug, setNewSlug] = useState('')
  const [newName, setNewName] = useState('')
  const [newBlurb, setNewBlurb] = useState('')
  const [newEyebrow, setNewEyebrow] = useState(false)

  const panelRef = useRef<HTMLDivElement | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch(endpoint, { cache: 'no-store' })
      const data = (await res.json()) as Record<string, unknown>
      if (!res.ok)
        throw new Error((data.error as string) ?? `Could not load ${resource}`)

      // Normalised here rather than at every use: the two resources name their display field
      // differently (`title` vs `label`) and nothing below this line should have to care.
      const rows =
        (data[config.listKey] as Record<string, unknown>[] | undefined) ?? []
      setEntries(
        rows.map(row => ({
          id: String(row.id),
          slug: String(row.slug),
          name: String(row[config.nameField] ?? ''),
          blurb: typeof row.blurb === 'string' ? row.blurb : undefined,
          eyebrow: typeof row.eyebrow === 'boolean' ? row.eyebrow : undefined,
          order: Number(row.order ?? 0),
          postCount: Number(row.postCount ?? 0),
        }))
      )
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : `Could not load ${resource}`
      )
    }
  }, [endpoint, resource, config.listKey, config.nameField])

  const bootstrap = useEffectEvent(() => {
    void load()
  })

  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => bootstrap(), 0)
    return () => window.clearTimeout(timer)
  }, [open])

  // Escape closes. No focus trap: this is one owner-only panel over a form, and a half-built
  // trap is worse than none - it is the version that swallows Tab and strands a keyboard user.
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  const run = async (fn: () => Promise<Response>) => {
    setBusy(true)
    setError(null)
    setBlockedBy(null)
    try {
      const res = await fn()
      const data = (await res.json()) as {
        error?: string
        posts?: { id: string; title: string }[]
      }
      if (!res.ok) {
        // A 409 from DELETE carries the posts that blocked it - the refusal IS the worklist.
        if (data.posts) setBlockedBy(data.posts)
        throw new Error(data.error ?? 'That did not work')
      }
      await load()
      onChanged()
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That did not work')
      return false
    } finally {
      setBusy(false)
    }
  }

  const create = async () => {
    const ok = await run(() =>
      fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slug: newSlug.trim(),
          [config.nameField]: newName.trim(),
          ...(resource === 'series'
            ? { blurb: newBlurb.trim() }
            : { eyebrow: newEyebrow }),
        }),
      })
    )
    if (ok) {
      setNewSlug('')
      setNewName('')
      setNewBlurb('')
      setNewEyebrow(false)
    }
  }

  const patch = (id: string, changes: Record<string, unknown>) =>
    run(() =>
      fetch(`${endpoint}/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(changes),
      })
    )

  /**
   * Reorder by swapping the two rows' `order` values.
   *
   * Two PATCHes rather than one bulk write, because there is no endpoint for a bulk write and
   * a list of four does not need one. They run in sequence: `run` reloads on success, and two
   * concurrent reloads would race to set the same state.
   */
  const move = async (index: number, direction: -1 | 1) => {
    if (!entries) return
    const a = entries[index]
    const b = entries[index + direction]
    if (!a || !b) return

    await patch(a.id, { order: b.order })
    await patch(b.id, { order: a.order })
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-[rgba(31,28,26,0.35)] p-4 backdrop-blur-sm sm:p-8"
      // Click the backdrop to dismiss, but only the backdrop - `currentTarget` rather than
      // `target`, so a click that started inside the panel and drifted out does not close it.
      onClick={event => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="taxonomy-dialog-title"
        className="w-full max-w-2xl rounded-[1.75rem] border border-pp-line bg-[rgba(255,253,250,0.99)] p-6 shadow-[0_32px_64px_rgba(46,35,28,0.28)] backdrop-blur-xl sm:p-7"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-pp-muted">
              Blog editor
            </p>
            <h2
              id="taxonomy-dialog-title"
              className="mt-1 font-display text-2xl font-semibold tracking-tight text-pp-text"
            >
              {config.heading}
            </h2>
            <p className={`${helpTextCls} mt-2 max-w-[56ch]`}>{config.intro}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="bg-white/82 shrink-0 rounded-full border border-pp-line p-2 text-pp-muted transition hover:bg-white hover:text-pp-text"
          >
            <X
              aria-hidden
              size={15}
            />
          </button>
        </div>

        {error ? (
          <div className="mt-5 rounded-[1.15rem] border border-[rgba(163,49,47,0.16)] bg-[rgba(211,108,105,0.1)] px-3.5 py-2.5 text-sm text-[#7f2f2f]">
            {error}
            {blockedBy && blockedBy.length > 0 ? (
              <ul className="mt-2 space-y-1">
                {blockedBy.map(post => (
                  <li key={post.id}>
                    <a
                      href={`/admin/blog/${post.id}`}
                      className="text-[#7f2f2f] underline underline-offset-2"
                    >
                      {post.title || '(untitled)'}
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        <div className="mt-6 space-y-3">
          {entries === null ? (
            <p className={helpTextCls}>Loading...</p>
          ) : entries.length === 0 ? (
            <div className={emptyStateCls}>
              {resource === 'series'
                ? 'No series yet. Posts without one appear under \u201cEverything else\u201d.'
                : 'No kinds yet. Add one before writing a post - every post needs a kind.'}
            </div>
          ) : (
            entries.map((item, index) => (
              <div
                key={item.id}
                className="rounded-[1.3rem] border border-pp-line bg-white/85 p-4 shadow-[0_14px_28px_rgba(46,35,28,0.05)] backdrop-blur-md"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <code className="bg-white/82 rounded-full border border-pp-line px-2.5 py-1 text-[11px] text-pp-muted">
                    {item.slug}
                  </code>
                  <span className="text-[11px] text-pp-muted">
                    {item.postCount} post{item.postCount === 1 ? '' : 's'}
                  </span>

                  <span className="ml-auto flex items-center gap-1">
                    <button
                      type="button"
                      className={ghostBtnCls}
                      disabled={busy || index === 0}
                      aria-label={`Move ${item.name} up`}
                      onClick={() => void move(index, -1)}
                    >
                      <ChevronUp
                        aria-hidden
                        size={14}
                      />
                    </button>
                    <button
                      type="button"
                      className={ghostBtnCls}
                      disabled={busy || index === entries.length - 1}
                      aria-label={`Move ${item.name} down`}
                      onClick={() => void move(index, 1)}
                    >
                      <ChevronDown
                        aria-hidden
                        size={14}
                      />
                    </button>
                    <button
                      type="button"
                      className={ghostBtnCls}
                      disabled={busy}
                      aria-label={`Delete ${item.name}`}
                      title={
                        item.postCount > 0
                          ? 'Posts still use this - move them first'
                          : 'Delete'
                      }
                      onClick={() =>
                        void run(() =>
                          fetch(`${endpoint}/${item.id}`, { method: 'DELETE' })
                        )
                      }
                    >
                      <Trash2
                        aria-hidden
                        size={14}
                      />
                    </button>
                  </span>
                </div>

                <div className="mt-3 space-y-2">
                  <input
                    className={inputCls}
                    defaultValue={item.name}
                    aria-label={`Name for ${item.slug}`}
                    // `onBlur`, not `onChange`: this is a dialog over an autosaving editor,
                    // and a PATCH per keystroke would put the reload in `run` on the same
                    // timer as the typing, remounting the field mid-word.
                    onBlur={event => {
                      const next = event.target.value.trim()
                      if (next && next !== item.name)
                        void patch(item.id, { [config.nameField]: next })
                    }}
                  />
                  {resource === 'series' ? (
                    <input
                      className={inputCls}
                      defaultValue={item.blurb}
                      placeholder="One line, shown under the heading on /blog"
                      aria-label={`Blurb for ${item.slug}`}
                      onBlur={event => {
                        const next = event.target.value.trim()
                        if (next !== item.blurb)
                          void patch(item.id, { blurb: next })
                      }}
                    />
                  ) : (
                    <label className="flex items-center gap-2 text-sm text-pp-muted">
                      <input
                        type="checkbox"
                        checked={item.eyebrow ?? false}
                        onChange={event =>
                          void patch(item.id, { eyebrow: event.target.checked })
                        }
                      />
                      Print &ldquo;{item.name}&rdquo; above the title on the
                      card
                    </label>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="mt-6 rounded-[1.3rem] border border-dashed border-pp-line bg-white/60 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-pp-muted">
            {resource === 'series' ? 'New series' : 'New kind'}
          </p>
          <div className="mt-3 space-y-2">
            <div>
              <label
                className={labelCls}
                htmlFor="new-entry-slug"
              >
                Slug
              </label>
              <input
                id="new-entry-slug"
                className={inputCls}
                value={newSlug}
                onChange={event => setNewSlug(event.target.value)}
                placeholder={config.slugPlaceholder}
              />
              <p className={`${helpTextCls} mt-1`}>{config.slugHelp}</p>
            </div>
            <input
              className={inputCls}
              value={newName}
              onChange={event => setNewName(event.target.value)}
              placeholder={config.namePlaceholder}
              aria-label="Name"
            />
            {resource === 'series' ? (
              <input
                className={inputCls}
                value={newBlurb}
                onChange={event => setNewBlurb(event.target.value)}
                placeholder="Blurb (optional)"
                aria-label="New series blurb"
              />
            ) : (
              <label className="flex items-center gap-2 text-sm text-pp-muted">
                <input
                  type="checkbox"
                  checked={newEyebrow}
                  onChange={event => setNewEyebrow(event.target.checked)}
                />
                Print the label above the title on the card
              </label>
            )}
          </div>
          <button
            type="button"
            className={`${primaryBtnCls} mt-3 gap-2 px-4 py-2 text-xs`}
            disabled={busy || !newSlug.trim() || !newName.trim()}
            onClick={() => void create()}
          >
            <Plus
              aria-hidden
              size={14}
            />
            {resource === 'series' ? 'Add series' : 'Add kind'}
          </button>
        </div>

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            className={secondaryBtnCls}
            onClick={onClose}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
