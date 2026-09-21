import type { Metadata } from 'next'

import { collapseWhitespace, excerptText, trimText } from '@/lib/profile-copy'
import type { PublicPortfolioViewModel } from '@/lib/profile-view-model'
import type { Profile } from '@/types/profile'

const LOCALHOST_SITE_ORIGIN = 'http://localhost:3000'

function normalizeOrigin(raw: string): string | null {
  try {
    const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
    return new URL(withScheme).origin
  } catch {
    return null
  }
}

function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === 'production'
}

/** Public site origin - require a trusted site URL in production. */
export function resolveSiteOrigin(): string {
  const explicit = trimText(process.env.NEXT_PUBLIC_SITE_URL)
  const explicitOrigin = explicit ? normalizeOrigin(explicit) : null
  if (explicitOrigin) return explicitOrigin

  if (explicit && isProductionRuntime())
    throw new Error(
      'Invalid NEXT_PUBLIC_SITE_URL. Set it to the deployed public origin, for example https://example.com.'
    )

  const vercelHost = trimText(process.env.VERCEL_URL)
  if (vercelHost) {
    const vercelOrigin = normalizeOrigin(vercelHost)
    if (vercelOrigin) {
      if (process.env.VERCEL_ENV === 'production' && !explicitOrigin)
        throw new Error(
          'Missing NEXT_PUBLIC_SITE_URL in production. Refusing to generate canonical URLs from VERCEL_URL.'
        )

      return vercelOrigin
    }
  }

  if (isProductionRuntime())
    throw new Error(
      'Missing NEXT_PUBLIC_SITE_URL in production. Refusing to fall back to localhost for canonical URLs.'
    )

  return LOCALHOST_SITE_ORIGIN
}

function canonicalHomeUrl(): `${string}/` | string {
  const origin = resolveSiteOrigin().replace(/\/$/, '')
  return `${origin}/`
}

/** SEO description grounded in hero tagline, then trimmed about copy (no invented claims). */
function buildPortfolioDescription(
  profile: Profile,
  vm: PublicPortfolioViewModel
): string {
  const fromHero = collapseWhitespace(
    profile.description || vm.hero.description
  )
  const aboutFirst = collapseWhitespace(
    vm.about.paragraphs[0] ?? profile.aboutMe
  )
  const body = excerptText(
    fromHero.length >= 48 ? fromHero : aboutFirst || fromHero,
    160
  )
  const fallback =
    excerptText(
      `${vm.hero.headline}${vm.hero.subheadline ? ` - ${vm.hero.subheadline}` : ''}`,
      160
    ) || 'Professional portfolio.'
  return collapseWhitespace(body) || fallback
}

const KEYWORD_LIMIT = 24

/** Keywords strictly from headline fields, titles, capabilities - capped and deduped. */
function buildPortfolioKeywords(vm: PublicPortfolioViewModel): string[] {
  const acc: string[] = []
  const seen = new Set<string>()

  const pushUnique = (...words: string[]) => {
    for (const raw of words) {
      const t = collapseWhitespace(raw)
      if (t.length < 2 || t.length > 48) continue
      const k = t.toLowerCase()
      if (seen.has(k)) continue
      seen.add(k)
      acc.push(t)
      if (acc.length >= KEYWORD_LIMIT) return
    }
  }

  pushUnique(...vm.hero.jobTitles)
  pushUnique(vm.services.heading)
  pushUnique(vm.services.subheading)

  for (const s of vm.services.items) {
    pushUnique(collapseWhitespace(s.title))
    if (acc.length >= KEYWORD_LIMIT) break
  }

  for (const group of vm.about.skills) {
    pushUnique(collapseWhitespace(group.groupName))
    for (const item of group.items) {
      pushUnique(collapseWhitespace(item.name))
      if (acc.length >= KEYWORD_LIMIT) break
    }
    if (acc.length >= KEYWORD_LIMIT) break
  }

  return acc
}

function buildDefaultTitle(
  profile: Profile,
  vm: PublicPortfolioViewModel
): string {
  const name = collapseWhitespace(profile.fullName) || vm.meta.displayName
  const titles = vm.hero.jobTitles.slice(0, 2)
  const viaTitles = titles.length ? titles.join(', ') : ''
  const viaHeadline =
    collapseWhitespace(profile.profileHeading) ||
    collapseWhitespace(profile.description) ||
    vm.hero.headline
  const tag = viaTitles || viaHeadline
  const core =
    `${name}${tag ? ` - ${collapseWhitespace(tag)}` : ''}`.trim() ||
    vm.meta.displayName
  return excerptText(core, 70).replace(/…+$/, '').trimEnd() || 'Portfolio'
}

export function buildPortfolioMetadata(
  profile: Profile,
  vm: PublicPortfolioViewModel
): Metadata {
  const canonical = canonicalHomeUrl()

  const titleDefault = buildDefaultTitle(profile, vm)
  const description = buildPortfolioDescription(profile, vm)
  const keywordsArr = buildPortfolioKeywords(vm)

  const personNameForTemplate =
    collapseWhitespace(profile.fullName) || vm.meta.displayName

  return {
    title: {
      default: titleDefault,
      template: `%s | ${personNameForTemplate || 'Portfolio'}`,
    },
    description,
    keywords: keywordsArr.length ? keywordsArr : undefined,
    alternates: {
      canonical: '/',
    },
    openGraph: {
      type: 'website',
      url: canonical,
      siteName: personNameForTemplate,
      title: titleDefault,
      description,
      locale: 'en',
      images: [{ url: '/opengraph-image' }],
    },
    twitter: {
      card: 'summary_large_image',
      title: titleDefault,
      description,
      images: ['/opengraph-image'],
    },
  }
}
