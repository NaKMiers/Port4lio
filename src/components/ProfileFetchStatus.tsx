'use client'

import React from 'react'
import { LuLoader2 } from 'react-icons/lu'

import { useApp } from '@/context/AppContext'

/**
 * The blocking fallback for a surface whose `AppProvider` fetches instead of being handed an
 * `initialProfile`, and which has no loading state of its own.
 *
 * ## Mount it only where both halves of that sentence are true
 *
 * The overlay is `fixed inset-0 z-[200]` over an opaque backdrop: it does not decorate a
 * page, it replaces it. So it belongs on a surface that genuinely cannot render without the
 * profile - not on chrome shared by pages that never read it.
 *
 * It used to sit in `AdminChrome` while the provider sat on `(admin)/layout.tsx`, which gave
 * "Loading portfolio..." to `/admin`, `/admin/blog`, `/admin/metrics` and
 * the CCA-F pages - six boards blocking on a profile document none of them render. That is
 * also why this file used to open with `if (pathname === '/admin/settings') return null`:
 * the one admin page that DID need the profile already draws `SettingLoading` inline, so the
 * shared overlay had to be carved back out again for it. Both the mount and the carve-out
 * are gone; the provider now sits on `admin/settings/layout.tsx`, below the chrome.
 *
 * What is left is `PortfolioPublicChrome`, where `(me)/layout.tsx` passes `initialProfile`
 * from the server - so `loading` is false on first paint and this renders nothing. It earns
 * its place as the error surface for a later `refetchProfile()`, which has no other UI.
 */
export default function ProfileFetchStatus() {
  const { loading, error, refetchProfile } = useApp()

  if (loading)
    return (
      <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm">
        <div className="w-[min(92vw,420px)] rounded-2xl border border-white/15 bg-zinc-950/95 p-6 text-center text-white shadow-2xl">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-white/15 bg-white/5">
            <LuLoader2
              className="animate-spin text-cyan-300"
              size={24}
            />
          </div>
          <div className="text-base font-semibold">Loading portfolio...</div>
          <div className="mt-1 text-sm text-white/65">
            Please wait while profile data is being fetched.
          </div>
        </div>
      </div>
    )

  if (error)
    return (
      <div className="fixed bottom-4 left-4 z-[90] max-w-[min(520px,calc(100vw-2rem))] rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-100 backdrop-blur">
        <div className="font-semibold">Profile load failed</div>
        <div className="mt-0.5 text-rose-100/80">{error}</div>
        <button
          type="button"
          onClick={() => void refetchProfile()}
          className="mt-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-[11px] font-medium text-rose-100 hover:bg-rose-500/15"
        >
          Retry
        </button>
      </div>
    )

  return null
}
