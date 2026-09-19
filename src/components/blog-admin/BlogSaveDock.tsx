'use client'

import React, { useEffect, useState } from 'react'

import { primaryBtnCls } from '@/components/settings/settings-utils'

/**
 * Save and save state, kept on screen after the toolbar has scrolled away.
 *
 * ## Why the editor needs a save button down here at all
 *
 * The toolbar's own Save button and status line live at the very top of a page whose markdown
 * card alone is `min-h-[32rem]`. Save is manual, so the entire time anyone is actually writing,
 * both the only way to commit their work and the only evidence of whether it is committed are
 * off screen - and the honest reading of a blank corner is that nothing has been saved.
 *
 * This dock is a second copy of the same button and the same status, not a second way to
 * save: `onSave` is the toolbar's own `saveNow`, so there is exactly one save path, mirrored
 * wherever the author happens to be scrolled.
 *
 * ## Why this is not `FloatingSaveButton`
 *
 * Same reason `BlogToolbar` is not `SettingToolbar`: that component takes
 * `uploading: UploadingState`, a record of `avatar`, `background`, `cv`, `cvPhoto` and a
 * `projects` map, and this editor has one boolean. It also renders a button and nothing else,
 * where the problem here is mostly the missing status. What is shared is the
 * `IntersectionObserver` trick and `primaryBtnCls`; the first is six lines and the second is
 * imported.
 *
 * Presence is driven by observing the toolbar's own save button rather than by a scroll
 * threshold, so it stays correct at any zoom, viewport height or toolbar wrap - and the two
 * are never on screen together competing for the same click.
 */
export default function BlogSaveDock({
  anchorRef,
  saving,
  savedAt,
  dirty,
  uploading,
  onSave,
}: {
  /** The toolbar's save button. This dock shows exactly while that button is out of view. */
  anchorRef: React.RefObject<HTMLButtonElement | null>
  saving: boolean
  savedAt: Date | null
  dirty: boolean
  uploading: boolean
  onSave: () => void
}) {
  const [anchorVisible, setAnchorVisible] = useState(true)

  useEffect(() => {
    const anchor = anchorRef.current
    if (!anchor) return

    const observer = new IntersectionObserver(
      entries => setAnchorVisible(entries[0]?.isIntersecting ?? true),
      // Any sliver counts as visible: a button half cut by the top edge is still clickable,
      // and flipping at exactly 0 keeps the two from overlapping.
      { threshold: 0 }
    )
    observer.observe(anchor)
    return () => observer.disconnect()
  }, [anchorRef])

  if (anchorVisible) return null

  return (
    <div className='fixed bottom-6 right-6 z-[55] flex items-center gap-3 rounded-full border border-pp-line bg-[rgba(255,253,250,0.98)] py-2 pl-5 pr-2 shadow-[0_18px_44px_rgba(17,17,17,0.22)] backdrop-blur-xl print:hidden'>
      <span className='text-xs font-medium text-pp-muted' role='status'>
        {saving
          ? 'Saving...'
          : dirty
            ? 'Unsaved changes'
            : savedAt
              ? `Saved ${savedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
              : 'No changes yet'}
      </span>
      <button
        type='button'
        onClick={onSave}
        disabled={saving || uploading || !dirty}
        title={uploading ? 'Waiting for the image upload to finish' : 'Save now'}
        className={`${primaryBtnCls} px-4 py-2 text-xs`}
      >
        {saving ? 'Saving...' : uploading ? 'Uploading...' : 'Save now'}
      </button>
    </div>
  )
}
