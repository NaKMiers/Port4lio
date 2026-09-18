import Link from 'next/link'
import React from 'react'

import { hasActiveUploads, primaryBtnCls, secondaryBtnCls } from '@/components/settings/settings-utils'
import type { UploadingState } from '@/components/settings/types'

export default function SettingToolbar({
  saving,
  uploading,
  fullWidth,
  onToggleFullWidth,
  onSave,
  saveButtonRef,
}: {
  saving: boolean
  uploading: UploadingState
  /** Whether the editor is running edge to edge rather than inside the editorial column. */
  fullWidth: boolean
  onToggleFullWidth: () => void
  onSave: () => void
  /** Watched by `FloatingSaveButton`, which takes over once this one scrolls away. */
  saveButtonRef?: React.Ref<HTMLButtonElement>
}) {
  const hasUploads = hasActiveUploads(uploading)

  return (
    <div className='relative mb-6 rounded-[2rem] border border-pp-line bg-[linear-gradient(135deg,rgba(255,255,255,0.84),rgba(255,250,246,0.78))] p-6 shadow-panel backdrop-blur-md sm:p-7'>
      {/* Top-right of this block, out of the way of the copy underneath. The editor is
          normally held to the same editorial column width as the public site; on a wide
          screen the forms and the preview rail both benefit from dropping that. */}
      <button
        type='button'
        onClick={onToggleFullWidth}
        aria-pressed={fullWidth}
        title={fullWidth ? 'Return to the editorial column width' : 'Use the full browser width'}
        className='absolute right-4 top-4 inline-flex items-center gap-1.5 rounded-full border border-pp-line bg-white/86 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-pp-text shadow-[0_10px_24px_rgba(46,35,28,0.06)] transition hover:-translate-y-0.5 hover:bg-white sm:right-5 sm:top-5'
      >
        <span aria-hidden>{fullWidth ? '⇥⇤' : '⇤⇥'}</span>
        {fullWidth ? 'Shrink' : 'Extend'}
      </button>

      <div className='flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between'>
        <div className='max-w-3xl space-y-3'>
          {/* Right padding keeps the badges from sliding under the Extend button. */}
          <div className='flex flex-wrap items-center gap-2.5 pr-24'>
            <span className='rounded-full border border-pp-line bg-white/82 px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-pp-muted'>
              Portfolio control room
            </span>
            <span className='rounded-full bg-pp-text px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-white'>
              One page editor
            </span>
            {hasUploads ? (
              <span className='rounded-full border border-pp-orange/30 bg-pp-orange/10 px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-pp-text'>
                Upload in progress
              </span>
            ) : null}
          </div>

          <div>
            <h1 className='font-display text-3xl font-semibold tracking-tight text-pp-text sm:text-4xl'>
              Shape the settings page with the same editorial energy as the live portfolio.
            </h1>
            <p className='mt-3 max-w-2xl text-sm leading-relaxed text-pp-muted sm:text-base'>
              Update every story block, link, service, metric, and project from one surface. Uploads
              still go straight to Cloudinary, and saving still sends only the profile JSON.
            </p>
          </div>

          <div className='flex flex-wrap gap-2.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-pp-muted'>
            <span className='rounded-full border border-pp-line bg-white/76 px-3 py-1.5'>
              Live profile sync
            </span>
            <span className='rounded-full border border-pp-line bg-white/76 px-3 py-1.5'>
              Media URLs only on save
            </span>
            <span className='rounded-full border border-pp-line bg-white/76 px-3 py-1.5'>
              Owner-gated access
            </span>
          </div>
        </div>

        <div className='flex flex-wrap items-center gap-2.5 lg:justify-end'>
          {/*
            Not dev-gated, unlike the "Fill mock data" button this replaced. That one was
            development-only because it overwrote the live editor state with fixtures;
            reading the funnel is something you want most on the deployed site, and
            `/metrics` is owner-gated server-side anyway.
          */}
          <Link className={secondaryBtnCls} href='/admin/metrics'>
            Metrics
          </Link>
          <Link className={secondaryBtnCls} href='/admin/publish'>
            Publish
          </Link>
          <button
            ref={saveButtonRef}
            type='button'
            onClick={onSave}
            disabled={saving || hasUploads}
            className={`${primaryBtnCls} min-w-[180px]`}
          >
            {saving ? 'Saving...' : 'Save profile'}
          </button>
        </div>
      </div>
    </div>
  )
}
