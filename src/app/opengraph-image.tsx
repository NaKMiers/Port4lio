import { ImageResponse } from 'next/og'

import { loadPublicProfile } from '@/lib/profile-data'
import { collapseWhitespace, excerptText } from '@/lib/profile-copy'
import { derivePublicPortfolioViewModel } from '@/lib/profile-view-model'

export const runtime = 'nodejs'
/**
 * Becomes `og:image:alt`, which is what a screen reader announces for the share card and
 * what some crawlers read when the image itself cannot be fetched. An empty string marks
 * the image purely decorative - wrong here, since the card carries the name and role.
 */
export const alt = 'Portfolio'
export const revalidate = 60

export const size = {
  width: 1200,
  height: 630,
}

export const contentType = 'image/png'

export default async function OpenGraphImage() {
  const profile = await loadPublicProfile()
  const vm = derivePublicPortfolioViewModel(profile)
  const name = vm.meta.displayName
  const subtitle =
    collapseWhitespace(vm.hero.jobTitles.slice(0, 3).join(' · ')) ||
    excerptText(
      collapseWhitespace(
        profile.description || vm.hero.description || vm.hero.headline
      ),
      128
    )

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '64px',
        background:
          'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #334155 100%)',
        color: '#f8fafc',
        fontFamily:
          '"Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      }}
    >
      <div
        style={{
          fontSize: 54,
          fontWeight: 700,
          lineHeight: 1.08,
          letterSpacing: '-0.03em',
        }}
      >
        {name}
      </div>
      <div
        style={{
          marginTop: 28,
          fontSize: 26,
          color: '#e2e8f0',
          lineHeight: 1.35,
          maxWidth: 960,
        }}
      >
        {subtitle}
      </div>
    </div>,
    { ...size }
  )
}
