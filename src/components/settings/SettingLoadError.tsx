import React from 'react'

import { secondaryBtnCls } from '@/components/settings/settings-utils'

/**
 * The failure counterpart to `SettingLoading`.
 *
 * `ProfileFetchStatus` suppresses the global error toast on `/settings` so it cannot sit
 * on top of the owner login card, which leaves this page responsible for surfacing its
 * own fetch failures. Without it a 500 from `/api/admin/profile` looked identical to a
 * slow one: a spinner, forever.
 */
export default function SettingLoadError({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}) {
  return (
    <div className='portfolio-public-root relative z-50 min-h-screen clip-decorations pt-12 text-pp-text'>
      <div className='pointer-events-none absolute inset-0 pp-grid-wash opacity-60' />
      <div className='relative mx-auto max-w-editorial px-gutter py-10'>
        <div className='rounded-[1.8rem] border border-pp-line bg-white/78 p-6 shadow-panel backdrop-blur-md'>
          <h2 className='font-display text-2xl font-semibold tracking-tight text-pp-text'>
            Could not load your profile
          </h2>
          <p className='mt-2 text-sm leading-relaxed text-pp-muted'>{message}</p>
          <button type='button' className={`${secondaryBtnCls} mt-4`} onClick={onRetry}>
            Try again
          </button>
        </div>
      </div>
    </div>
  )
}
