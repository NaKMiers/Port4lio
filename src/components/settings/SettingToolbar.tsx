import React from 'react'

import { primaryBtnCls, secondaryBtnCls } from '@/components/settings/settings-utils'
import type { UploadingState } from '@/components/settings/types'

export default function SettingToolbar({
  saving,
  uploading,
  onFillMock,
  onSave,
}: {
  saving: boolean
  uploading: UploadingState
  onFillMock: () => void
  onSave: () => void
}) {
  const hasUploads =
    uploading.avatar ||
    uploading.background ||
    uploading.cv ||
    Object.values(uploading.projects).some(Boolean)

  return (
    <div className='mb-6 rounded-[2rem] border border-pp-line bg-[linear-gradient(135deg,rgba(255,255,255,0.84),rgba(255,250,246,0.78))] p-6 shadow-panel backdrop-blur-md sm:p-7'>
      <div className='flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between'>
        <div className='max-w-3xl space-y-3'>
          <div className='flex flex-wrap items-center gap-2.5'>
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
          {process.env.NODE_ENV === 'development' && (
            <button type='button' className={secondaryBtnCls} onClick={onFillMock}>
              Fill mock data
            </button>
          )}
          <a className={secondaryBtnCls} href='/publish'>
            Publish
          </a>
          <button
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
