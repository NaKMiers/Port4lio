import type { PublicPortfolioViewModel } from '@/lib/profile-view-model'
import { resolveSiteOrigin } from '@/lib/seo'
import { serializePortfolioJsonLd } from '@/lib/structured-data'
import type { Profile } from '@/types/profile'

export default function PortfolioStructuredData({
  profile,
  viewModel,
}: {
  profile: Profile
  viewModel: PublicPortfolioViewModel
}) {
  const ld = serializePortfolioJsonLd(resolveSiteOrigin(), profile, viewModel)
  return (
    <script
      type="application/ld+json"
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: ld }}
    />
  )
}
