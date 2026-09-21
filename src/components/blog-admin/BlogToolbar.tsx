import { Maximize2, Minimize2 } from 'lucide-react'
import Link from 'next/link'
import React from 'react'

import {
  ghostBtnCls,
  primaryBtnCls,
  secondaryBtnCls,
} from '@/components/settings/settings-utils'

/**
 * The editor's header panel: where this post is, whether it is saved, and the transitions.
 *
 * ## Why this is not `SettingToolbar` generalised
 *
 * `SettingToolbar` was the obvious thing to reuse and it is still the wrong thing. It has
 * exactly one consumer, and its prop contract is profile-shaped: it takes
 * `uploading: UploadingState`, a record with `avatar`, `background`, `cv`, `cvPhoto` and a
 * `projects` map. Making it serve both would mean widening that type until it describes
 * neither caller, so that two toolbars can share a flex container and three button classes.
 *
 * So this imports the button classes - which is the part that actually is shared, and the
 * part that keeps the two looking like one product - and states its own layout. The
 * duplication is the layout; the thing that would have been coupled is the data model.
 *
 * ## Why saved state is a timestamp and not a spinner
 *
 * Save is manual here, so the risk is not silent autosave failure but the opposite: an author
 * who clicked Save a while ago and has no way to tell whether that click actually landed. A
 * spinner only says "something is happening now". "Saved 14:32" says the last thing that
 * happened succeeded and when - which is the question an author actually has, and it goes
 * stale visibly (back to "Unsaved changes") the moment they type again.
 *
 * ## The heading is the post's own title
 *
 * `SettingToolbar` carries fixed marketing copy there, because the profile editor edits one
 * permanent thing. This editor is opened once per post, so the useful heading is which post
 * - and it reads live from the title field, which doubles as feedback that a title long
 * enough to be cut in a search result is long.
 */
export default function BlogToolbar({
  slug,
  title,
  status,
  saving,
  savedAt,
  dirty,
  uploading,
  fullWidth,
  onSave,
  saveButtonRef,
  onToggleFullWidth,
  onPublish,
  onArchive,
}: {
  slug: string
  title: string
  status: 'draft' | 'published' | 'archived' | 'deleted'
  saving: boolean
  savedAt: Date | null
  /** An edit the server has not acknowledged. Drives the status line AND enables Save now. */
  dirty: boolean
  uploading: boolean
  /** Whether the editor is running edge to edge rather than inside the editorial column. */
  fullWidth: boolean
  onToggleFullWidth: () => void
  onSave: () => void
  /** Watched by `BlogSaveDock`, which takes over once this button scrolls away. */
  saveButtonRef?: React.Ref<HTMLButtonElement>
  onPublish: () => void
  onArchive: () => void
}) {
  /*
    `dirty` is checked before `savedAt`, and the order is the whole point. Reading `savedAt`
    first meant that once anything had ever saved, a paragraph typed afterwards still showed
    "Saved 14:32" for the length of the debounce - a stale timestamp presented as current
    state, which is the one failure mode a save indicator exists to prevent.
  */
  const savedLabel = saving
    ? 'Saving...'
    : dirty
      ? 'Unsaved changes'
      : savedAt
        ? `Saved ${savedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
        : 'No changes yet'

  /**
   * Guards the two links that leave this page - `All posts` and `View live`.
   *
   * `beforeunload` (see `BlogEditor`) only fires on a real navigation away from the app - a
   * closed tab, a refresh, a typed URL. A `next/link` click is a client-side transition, which
   * unmounts this component without ever touching that event, so the one native safety net the
   * editor has is silent on the single most common way to leave it. `window.confirm` is a
   * second, narrower net for exactly those two links, not a replacement for the first.
   */
  function confirmLeave(event: React.MouseEvent) {
    if (!dirty) return
    if (!window.confirm('You have unsaved changes. Leave without saving?'))
      event.preventDefault()
  }

  return (
    <div className="relative mb-6 rounded-[2rem] border border-pp-line bg-[linear-gradient(135deg,rgba(255,255,255,0.84),rgba(255,250,246,0.78))] p-6 shadow-panel backdrop-blur-md sm:p-7">
      {/* Top-right of this block, out of the way of the copy underneath - the same placement
          and the same pair of states the profile editor's toggle uses, because it is the same
          gesture on a second board and it should not have to be learned twice. */}
      <button
        type="button"
        onClick={onToggleFullWidth}
        aria-pressed={fullWidth}
        title={
          fullWidth
            ? 'Return to the editorial column width'
            : 'Use the full browser width'
        }
        className="bg-white/86 absolute right-4 top-4 inline-flex items-center gap-1.5 rounded-full border border-pp-line px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-pp-text shadow-[0_10px_24px_rgba(46,35,28,0.06)] transition hover:-translate-y-0.5 hover:bg-white sm:right-5 sm:top-5"
      >
        {fullWidth ? (
          <Minimize2
            aria-hidden
            size={12}
          />
        ) : (
          <Maximize2
            aria-hidden
            size={12}
          />
        )}
        {fullWidth ? 'Shrink' : 'Extend'}
      </button>

      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl space-y-3">
          {/* Right padding keeps the badges from sliding under the Extend button. */}
          <div className="flex flex-wrap items-center gap-2.5 pr-24">
            <span className="bg-white/82 rounded-full border border-pp-line px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-pp-muted">
              Blog control room
            </span>
            <span className="rounded-full bg-pp-text px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-white">
              {status}
            </span>
            {uploading ? (
              <span className="rounded-full border border-pp-orange/30 bg-pp-orange/10 px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-pp-text">
                Upload in progress
              </span>
            ) : null}
          </div>

          <div>
            <h1 className="font-display text-3xl font-semibold tracking-tight text-pp-text sm:text-4xl">
              {title.trim() || 'Untitled post'}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-pp-muted sm:text-base">
              <code>/blog/{slug}</code> ·{' '}
              <span role="status">{savedLabel}</span>
            </p>
          </div>

          <div className="flex flex-wrap gap-2.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-pp-muted">
            {/*
              "Text" rather than nothing, because this chip is a promise about when a PATCH
              happens and it stopped being true of the whole editor: images commit the moment
              they are uploaded or generated, and Publish/Archive commit on click. See
              `commitImage` in `BlogEditor` for why an image is not treated like a paragraph.
            */}
            <span className="bg-white/76 rounded-full border border-pp-line px-3 py-1.5">
              Manual save for text
            </span>
            <span className="bg-white/76 rounded-full border border-pp-line px-3 py-1.5">
              Preview rendered server-side
            </span>
            <span className="bg-white/76 rounded-full border border-pp-line px-3 py-1.5">
              Owner-gated access
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 lg:justify-end">
          <Link
            className={secondaryBtnCls}
            href="/admin/blog"
            onClick={confirmLeave}
          >
            All posts
          </Link>
          {/*
            Disabled whenever there is nothing pending - right after load, and again right
            after a save lands. A Save button that is always clickable in an editor with no
            autosave teaches you to press it out of superstition, and tells you nothing.
            Greyed out IS the message that your work is committed.
          */}
          <button
            ref={saveButtonRef}
            type="button"
            onClick={onSave}
            disabled={saving || uploading || !dirty}
            title={
              uploading ? 'Waiting for the image upload to finish' : 'Save now'
            }
            /*
              `secondaryBtnCls` carries no `disabled:` styling - unlike `BlogSaveDock`'s copy of
              this same button, which uses `primaryBtnCls` and already dims correctly. Without
              this, a disabled Save now (the common case: nothing typed since the last save)
              renders pixel-identical to an enabled one, so clicking it looks like the button is
              simply broken rather than like there is nothing to save.
            */
            className={`${secondaryBtnCls} disabled:cursor-not-allowed disabled:opacity-50`}
          >
            {saving ? 'Saving...' : 'Save now'}
          </button>
          {status === 'published' ? (
            <>
              <Link
                className={secondaryBtnCls}
                href={`/blog/${slug}`}
                onClick={confirmLeave}
              >
                View live
              </Link>
              <button
                className={ghostBtnCls}
                onClick={onArchive}
              >
                Archive
              </button>
            </>
          ) : (
            <button
              className={`${primaryBtnCls} min-w-[180px]`}
              onClick={onPublish}
              disabled={uploading}
            >
              {/*
                Blocked while an image is in flight, so a post cannot go live referencing a
                Cloudinary URL that does not exist yet - the same reason the settings editor
                gates its save on `hasActiveUploads`.
              */}
              Publish
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
