import PortfolioShell from '@/components/portfolio/PortfolioShell'
import PortfolioStructuredData from '@/components/portfolio/PortfolioStructuredData'
import { loadPublicProfile } from '@/lib/profile-data'
import { derivePublicPortfolioViewModel } from '@/lib/profile-view-model'

/** Canonical `/` - one-page public entry; legacy routes 308 -> `/?section=`. */
export default async function HomePage() {
  const profile = await loadPublicProfile()
  const viewModel = derivePublicPortfolioViewModel(profile)

  return (
    <>
      <PortfolioStructuredData profile={profile} viewModel={viewModel} />
      <PortfolioShell profile={profile} viewModel={viewModel} />
    </>
  )
}
