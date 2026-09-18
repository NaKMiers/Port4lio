import Link from 'next/link'

import { ghostBtnCls, primaryBtnCls, secondaryBtnCls } from '@/components/settings/settings-utils'

/**
 * The editor's top bar: where this post is, whether it is saved, and the two transitions.
 *
 * ## Why this is not `SettingToolbar` generalised
 *
 * `SettingToolbar` was the obvious thing to reuse and it is the wrong thing. It has exactly
 * one consumer, and its prop contract is profile-shaped: it takes `uploading: UploadingState`,
 * a record with `avatar`, `background`, `cv`, `cvPhoto` and a `projects` map. Making it serve
 * both would mean widening that type until it describes neither caller, so that two toolbars
 * can share a flex container and three button classes.
 *
 * So this imports the button classes - which is the part that actually is shared, and the
 * part that keeps the two looking like one product - and states its own forty lines. The
 * duplication is the layout; the thing that would have been coupled is the data model.
 *
 * ## Why saved state is a timestamp and not a spinner
 *
 * Autosave's failure mode is silence: the author keeps typing, nothing indicates anything is
 * wrong, and an hour is gone at the next reload. A spinner only says "something is happening
 * now". "Saved 14:32" says the last thing that happened succeeded and when - which is the
 * question an author actually has, and it goes stale visibly if saving stops working.
 */
export default function BlogToolbar({
  slug,
  status,
  saving,
  savedAt,
  uploading,
  onPublish,
  onArchive,
}: {
  slug: string
  status: 'draft' | 'published' | 'archived' | 'deleted'
  saving: boolean
  savedAt: Date | null
  uploading: boolean
  onPublish: () => void
  onArchive: () => void
}) {
  return (
    <div className='flex flex-wrap items-center gap-3 rounded-[1.4rem] border border-pp-line bg-white/72 px-4 py-3'>
      <span className='font-display text-sm font-semibold'>/blog/{slug}</span>
      <span className='rounded-full border border-pp-line px-2.5 py-0.5 text-[11px] uppercase tracking-[0.14em] text-pp-muted'>
        {status}
      </span>

      <span className='text-xs text-pp-muted' role='status'>
        {saving
          ? 'Saving...'
          : savedAt
            ? `Saved ${savedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
            : 'No changes yet'}
        {uploading ? ' · uploading image' : ''}
      </span>

      <span className='ml-auto flex flex-wrap gap-2'>
        {status === 'published' ? (
          <>
            <Link className={secondaryBtnCls} href={`/blog/${slug}`}>
              View live
            </Link>
            <button className={ghostBtnCls} onClick={onArchive}>
              Archive
            </button>
          </>
        ) : (
          <button className={primaryBtnCls} onClick={onPublish} disabled={uploading}>
            {/*
              Blocked while an image is in flight, so a post cannot go live referencing a
              Cloudinary URL that does not exist yet - the same reason the settings editor
              gates its save on `hasActiveUploads`.
            */}
            Publish
          </button>
        )}
      </span>
    </div>
  )
}
