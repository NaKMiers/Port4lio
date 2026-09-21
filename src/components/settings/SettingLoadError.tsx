import React from 'react'

import { secondaryBtnCls } from '@/components/settings/settings-utils'

/**
 * The failure counterpart to `SettingLoading` - no longer a symmetric one.
 *
 * `SettingLoading` takes `title`/`subtitle` props now, because three boards render it and
 * only one of them is loading a profile. This component has stayed hardcoded to the settings
 * case deliberately: it is rendered by `/admin/settings` alone, and the copy it carries is
 * about `/api/admin/profile` specifically rather than about loading in general. Give it props
 * when a second caller exists, not before.
 *
 * There is no global toast behind this. `ProfileFetchStatus` used to render one from
 * `AdminChrome` and had to special-case this pathname away, so it could not sit on top of
 * the owner login card; now the fetching provider lives on `admin/settings/layout.tsx` and
 * that component is not in the admin tree at all. Either way this page is the only thing
 * surfacing its own fetch failures, and without it a 500 from `/api/admin/profile` looks
 * identical to a slow one: a spinner, forever.
 */
export default function SettingLoadError({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}) {
  return (
    <div className="mx-auto w-full max-w-editorial px-gutter py-10">
      <div className="bg-white/78 rounded-[1.8rem] border border-pp-line p-6 shadow-panel backdrop-blur-md">
        <h2 className="font-display text-2xl font-semibold tracking-tight text-pp-text">
          Could not load your profile
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-pp-muted">{message}</p>
        <button
          type="button"
          className={`${secondaryBtnCls} mt-4`}
          onClick={onRetry}
        >
          Try again
        </button>
      </div>
    </div>
  )
}
