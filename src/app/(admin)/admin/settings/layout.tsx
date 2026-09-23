import type { Metadata } from 'next'

import AppProvider from '@/context/AppContext'

/**
 * Gives `/admin/settings` a title, and owns the only profile fetch in the admin group.
 *
 * ## The title
 *
 * `page.tsx` beside this is `'use client'`, and a client component cannot export `metadata`.
 * Until D6 that did not matter: `(admin)/layout.tsx` hardcoded `title: 'Settings'`, so this
 * page got the right tab label by accident and its three sibling boards got the wrong one.
 * Removing that default fixed the siblings and left this page as the one that had been
 * relying on it, so the title moves here - to the only segment it was ever true of.
 *
 * A layout rather than converting the page to a server shell: the page is one large client
 * island with its own state, and splitting it to move four lines of metadata would be a real
 * refactor in service of a tab label.
 *
 * ## Why `AppProvider` is here and not on `(admin)/layout.tsx`
 *
 * `bootstrapOnMount` FETCHES - `/api/admin/profile`, the full profile document including
 * `resume`. Mounted on the group layout it ran on every owner surface, and since
 * `AdminChrome` rendered `ProfileFetchStatus`, every one of them opened behind a
 * `fixed inset-0 z-[200]` "Loading portfolio..." overlay: `/admin`, `/admin/blog`,
 * `/admin/metrics`, the three CCA-F pages. None of them read the profile.
 * `useApp()` appears in exactly one page in this tree, and it is the one below this file.
 *
 * So the provider sits on the narrowest segment that needs it. The admin endpoint rather
 * than the public `/api/profile` because the editor must see the private fields that
 * `PUBLIC_PROFILE_FIELDS` projects away.
 *
 * `ProfileFetchStatus` is deliberately NOT rendered under this provider: the page renders
 * `SettingLoading` and `SettingLoadError` from the same `loading`/`error` state, inline and
 * in the editor's own layout, which is why that component always bailed out on this exact
 * pathname. One provider, one loading surface.
 */
export const metadata: Metadata = {
  title: 'Settings',
}

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <AppProvider
      bootstrapOnMount
      endpoint="/api/admin/profile"
    >
      {children}
    </AppProvider>
  )
}
