import AdminBackdrop from './AdminBackdrop'
import AdminHomeLink from './AdminHomeLink'

/**
 * The shell every owner surface renders inside. Replaces `SiteChrome` for `(admin)`.
 *
 * ```
 *   .portfolio-public-root      tokens, cream background, editorial type
 *     |- AdminBackdrop          blur pools + the home page's ornaments   (-z-10)
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
 * ## Why `ProfileFetchStatus` is not in that list any more
 *
 * It was, and it is the reason every owner surface opened behind a full-screen
 * "Loading portfolio..." overlay. The component is only ever `loading` when an `AppProvider`
 * above it is bootstrapping, and that provider used to sit on `(admin)/layout.tsx` - so
 * `/admin`, `/admin/blog`, `/admin/publish`, `/admin/metrics` and the CCA-F pages each
 * blocked on a `/api/admin/profile` round trip for data none of them render. The provider
 * now sits on `admin/settings/layout.tsx`, which is below this chrome, and `/admin/settings`
 * shows its own `SettingLoading` inline - so there is no admin surface left for this
 * component to speak for. Putting it back here would reintroduce the overlay on seven pages.
 *
 * `clip-decorations` and not `overflow-hidden`: the settings preview rail is `position:
 * sticky`, and `overflow-hidden` here would give it a scrollport that never scrolls. See the
 * rule's own comment in `globals.css`.
 */
export default function AdminChrome({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="portfolio-public-root clip-decorations relative flex min-h-screen flex-col text-pp-text">
      <AdminBackdrop />
      <AdminHomeLink />
      <div className="relative flex-1">{children}</div>
    </div>
  )
}
