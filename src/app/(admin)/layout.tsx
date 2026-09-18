import type { Metadata } from 'next'

import SiteChrome from '@/components/site/SiteChrome'
import AppProvider from '@/context/AppContext'

/**
 * Every owner surface on the site, and nothing else.
 *
 * ```
 *   (admin)/layout.tsx          ← this file: profile bootstrap + chrome, force-dynamic
 *     └── admin/
 *           ├── settings/       /admin/settings
 *           ├── publish/        /admin/publish
 *           ├── metrics/        /admin/metrics
 *           └── ccaf/           /admin/ccaf, /admin/ccaf/en
 * ```
 *
 * ## Why the pages sit under `admin/` and not directly in the group
 *
 * Route groups add no path segment, so `(admin)/settings/page.tsx` served `/settings` - a
 * top-level URL indistinguishable from a public one. Four owner surfaces meant four
 * unrelated top-level routes, which had two costs that were both paid before D6 moved them:
 *
 * `robots.ts` needed one `Disallow` per surface, and `/metrics` shipped without its rule
 * because adding it was a separate act of remembering. That file now carries `/admin` and
 * `/admin/`, and the next owner page is covered the moment it exists.
 *
 * And the public namespace was not the blog's to take. `/blog/<slug>` needs the root to
 * itself; a site where `/settings` is owner-only and `/five-things-next-16-did` is a post is
 * a site where the next owner page and the next post can collide on a name, silently, with
 * the post winning or losing depending on which file the router saw first.
 *
 * ## `title` is not set here, deliberately
 *
 * It used to be `'Settings'`, which was true when settings was the only page and became a
 * lie the moment it was not: `/admin/publish` and `/admin/metrics` both rendered a tab
 * reading "Settings", and the blog board would have inherited it too. There is no sensible
 * shared title for four unrelated boards, so each page states its own and this layout
 * declines to guess.
 *
 * `robots: noindex` stays, because that IS shared and is true of every page below.
 * `robots.ts` blocks the fetch; this keeps anything that fetched anyway out of the index.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppProvider bootstrapOnMount endpoint='/api/admin/profile'>
      <SiteChrome>{children}</SiteChrome>
    </AppProvider>
  )
}
