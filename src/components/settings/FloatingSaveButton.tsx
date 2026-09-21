'use client'

import React, { useEffect, useState } from 'react'

import {
  hasActiveUploads,
  primaryBtnCls,
} from '@/components/settings/settings-utils'
import type { UploadingState } from '@/components/settings/types'

/**
 * Save, kept within reach once the toolbar's own button has scrolled away.
 *
 * The editor is one very long page and the only way to save sits at the very top of it, so
 * a change made near the bottom of the CV tab meant scrolling the whole way back. This is
 * the same action, not a second one: it gates on the same uploads and calls the same
 * handler, and it only exists while the real button is off screen, so the two are never on
 * screen together competing for the click.
 *
 * Presence is driven by an `IntersectionObserver` on the toolbar button rather than a
 * scroll threshold, so it stays correct at any zoom, viewport height, or toolbar layout -
 * including the wrap that moves the button down a row on a narrow window.
 */
export default function FloatingSaveButton({
  anchorRef,
  saving,
  uploading,
  onSave,
}: {
  /** The toolbar's save button. This one shows exactly while that one is out of view. */
  anchorRef: React.RefObject<HTMLButtonElement | null>
  saving: boolean
  uploading: UploadingState
  onSave: () => void
}) {
  const [anchorVisible, setAnchorVisible] = useState(true)

  useEffect(() => {
    const anchor = anchorRef.current
    if (!anchor) return

    const observer = new IntersectionObserver(
      entries => setAnchorVisible(entries[0]?.isIntersecting ?? true),
      // Any sliver counts as visible: the toolbar button half cut by the top edge is still
      // a button you can click, and flipping at exactly 0 keeps the two from overlapping.
      { threshold: 0 }
    )

    observer.observe(anchor)
    return () => observer.disconnect()
  }, [anchorRef])

  if (anchorVisible) return null

  const hasUploads = hasActiveUploads(uploading)

  return (
    // Under the icon picker (z-60) and every other overlay, above the editor itself.
    <div className="fixed bottom-6 right-6 z-[55] print:hidden">
      <button
        type="button"
        onClick={onSave}
        disabled={saving || hasUploads}
        title={hasUploads ? 'Waiting for uploads to finish' : 'Save profile'}
        className={`${primaryBtnCls} min-w-[160px] shadow-[0_18px_44px_rgba(17,17,17,0.32)]`}
      >
        {saving ? 'Saving...' : hasUploads ? 'Uploading...' : 'Save profile'}
      </button>
    </div>
  )
}
