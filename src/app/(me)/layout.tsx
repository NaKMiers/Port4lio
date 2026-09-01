import type { Metadata } from 'next'

import PortfolioPublicChrome from '@/components/portfolio/PortfolioPublicChrome'
import AppProvider from '@/context/AppContext'
import { loadPublicProfile } from '@/lib/profile-data'
import { derivePublicPortfolioViewModel } from '@/lib/profile-view-model'
import { buildPortfolioMetadata } from '@/lib/seo'

/**
 * Public routing (Chunk 0) + editorial shell (Chunk 2):
 * - Canonical public surface lives at `/`.
 * - `/?section=` targets in-page anchors (see `PortfolioSectionScrollTarget`).
 * - `/about`,`/services`,`/work`,`/contact`,`/testimonials` → HTTP 308 to `/` plus `section=` (`next.config.js`).
 *
 * `AppProvider` hydrates profile for client islands; admin `/settings` still uses dark `SiteChrome`.
 */

export const revalidate = 60

export async function generateMetadata(): Promise<Metadata> {
  const profile = await loadPublicProfile()
  const viewModel = derivePublicPortfolioViewModel(profile)
  return buildPortfolioMetadata(profile, viewModel)
}

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const profile = await loadPublicProfile()

  return (
    <AppProvider initialProfile={profile}>
      <PortfolioPublicChrome>{children}</PortfolioPublicChrome>
    </AppProvider>
  )
}
