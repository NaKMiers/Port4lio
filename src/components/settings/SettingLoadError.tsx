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
