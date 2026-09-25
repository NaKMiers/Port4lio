import { Minimize2, Maximize2 } from 'lucide-react'
import React from 'react'

import { AdminHubPill } from '@/components/admin/AdminHomeLink'
import {
  hasActiveUploads,
  primaryBtnCls,
} from '@/components/settings/settings-utils'
import type { UploadingState } from '@/components/settings/types'

/**
 * The editor's one toolbar row: the way back, and the save buttons.
 *
 * ```
 *   [All boards] (Upload in progress)       [Extend] [Save profile]    Profile / Career / Offering
 *   [All boards]                            [Extend] [Save CV]         CV
 *                                           └ xl (1200px) and up only
 * ```
 *
 * It used to be a hero card - badges, a headline, a paragraph, three more badges and a
 * Metrics link - that pushed the editor most of a screen down on every visit to a page the
 * owner already knows. Now it is the "All boards" row itself: `AdminHomeLink` hides on this
 * route so the pill is not drawn twice, and Save sits on the same line as it. Metrics is one
 * click away on the hub.
 *
 * Two buttons because they save two different things (multi-cv-plan.md R5): Save profile
 * sends the profile document, Save CV the selected CV (`useCvEditor`). Only one is ever
 * shown, the one for the tab: on the CV tab Save profile is gone rather than disabled, so
 * there is one save button and it saves what the owner is looking at. (It was disabled at
 * first; the owner asked for it hidden.) A profile edit made on another tab is not lost - it
 * waits in the editor state for that tab's Save profile.
 *
 * Extend is hidden below `xl`: the editorial column is `--pp-max` (1160px), so on a narrower
 * screen the editor already fills the width and the toggle would change nothing.
 */
export default function SettingToolbar({
  saving,
  uploading,
  fullWidth,
  onToggleFullWidth,
  onSave,
  saveButtonRef,
  cvSave,
  cvSaveButtonRef,
}: {
  saving: boolean
  uploading: UploadingState
  /** Whether the editor is running edge to edge rather than inside the editorial column. */
  fullWidth: boolean
  onToggleFullWidth: () => void
  onSave: () => void
  /** Watched by `FloatingSaveButton`, which takes over once this one scrolls away. */
  saveButtonRef?: React.Ref<HTMLButtonElement>
  /** Present only on the CV tab: Save CV, shown in place of Save profile. */
  cvSave?: {
    onSave: () => void
    saving: boolean
    disabled: boolean
    title?: string
  }
  /** Save CV's button, watched by `FloatingSaveButton` on the CV tab. */
  cvSaveButtonRef?: React.Ref<HTMLButtonElement>
}) {
  const hasUploads = hasActiveUploads(uploading)

  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <AdminHubPill />
        {hasUploads ? (
          <span className="rounded-full border border-pp-orange/30 bg-pp-orange/10 px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-pp-text">
            Upload in progress
          </span>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        {/* The editor is normally held to the public site's editorial column; on a wide
            screen the forms and the preview rail both benefit from dropping that. */}
        <button
          type="button"
          onClick={onToggleFullWidth}
          aria-pressed={fullWidth}
          title={
            fullWidth
              ? 'Return to the editorial column width'
              : 'Use the full browser width'
          }
          className="bg-white/86 hidden min-h-[36px] items-center gap-1.5 rounded-full border border-pp-line px-3.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-pp-text shadow-[0_10px_24px_rgba(46,35,28,0.06)] transition hover:-translate-y-0.5 hover:bg-white xl:inline-flex"
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
        {cvSave ? (
          <button
            ref={cvSaveButtonRef}
            type="button"
            data-testid="save-cv"
            onClick={cvSave.onSave}
            disabled={cvSave.disabled}
            title={cvSave.title}
            className={`${primaryBtnCls} min-w-[180px]`}
          >
            {cvSave.saving ? 'Saving...' : 'Save CV'}
          </button>
        ) : (
          <button
            ref={saveButtonRef}
            type="button"
            onClick={onSave}
            disabled={saving || hasUploads}
            className={`${primaryBtnCls} min-w-[180px]`}
          >
            {saving ? 'Saving...' : 'Save profile'}
          </button>
        )}
      </div>
    </div>
  )
}
