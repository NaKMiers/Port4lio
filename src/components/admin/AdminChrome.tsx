import ProfileFetchStatus from '@/components/ProfileFetchStatus'

import AdminBackdrop from './AdminBackdrop'
import AdminHomeLink from './AdminHomeLink'

/**
 * The shell every owner surface renders inside. Replaces `SiteChrome` for `(admin)`.
 *
 * ```
 *   .portfolio-public-root      tokens, cream background, editorial type
 *     |- AdminBackdrop          blur pools + the home page's ornaments   (-z-10)
 *     |- ProfileFetchStatus     the global load/error toast
 *     |- AdminHomeLink          the one nav link, absent on /admin
 *     `- {children}             flex-1, so a short board still fills the viewport
 * ```
 *
 * ## Why `SiteChrome` had to go rather than be conditionally trimmed
 *
 * It renders `Nav` and `Header`, both written for the public one-page site. `Nav`'s six
 * links are `/?section=...` anchors into the portfolio, so the only navigation an owner
 * board had led away from the admin area; `Header` puts the public logo and the social
 * icons above the profile editor. Neither has an admin-shaped version worth keeping.
 *
 * ## What this consolidates
 *
 * `SiteChrome` is dark (`.page text-white`), so every owner surface had to cover it with its
 * own `portfolio-public-root relative z-50 min-h-screen clip-decorations pt-12 text-pp-text`
 * wrapper plus a `pp-grid-wash` overlay. That string was copied into eleven places - four
 * pages, `OwnerAuthGate` twice, `SettingLoading`, `SettingLoadError`, `BlogBoard` and
 * `BlogEditor` - and had already drifted: the board wrappers had no `clip-decorations` and no
 * wash, the CCA-F pages had no `pt-12`, and only `/admin/settings` rendered the blur blobs.
 * With the dark chrome gone there is nothing to cover, so the wrapper moved up here and the
 * eleven copies were deleted.
 *
 * `z-50` went with them. It existed to lift a light page above dark chrome that no longer
 * renders, and it is actively harmful now: `IconPickerModal` and the settings preview rail
 * both stack inside this subtree.
 *
 * `clip-decorations` and not `overflow-hidden`: the settings preview rail is `position:
 * sticky`, and `overflow-hidden` here would give it a scrollport that never scrolls. See the
 * rule's own comment in `globals.css`.
 */
export default function AdminChrome({ children }: { children: React.ReactNode }) {
  return (
    <div className='portfolio-public-root clip-decorations relative flex min-h-screen flex-col text-pp-text'>
      <AdminBackdrop />
      <ProfileFetchStatus />
      <AdminHomeLink />
      <div className='relative flex-1'>{children}</div>
    </div>
  )
}
