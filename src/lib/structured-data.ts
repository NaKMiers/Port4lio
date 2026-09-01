import { collapseWhitespace, excerptText, trimText } from '@/lib/profile-copy'
import type { PublicPortfolioViewModel } from '@/lib/profile-view-model'
import type { PublicProfile } from '@/lib/profile-public'

type JsonLdThing = Record<string, unknown>

const PERSON_FRAGMENT = '#person'
const WEBSITE_FRAGMENT = '#website'
const PROFESSIONAL_FRAGMENT = '#professional-service'
const FEATURED_FRAGMENT = '#featured-projects'

function canonicalPageUrl(siteOrigin: string): string {
  const o = stripTrailingSlashOrigin(siteOrigin)
  return `${o}/`
}

function fragmentId(siteOrigin: string, fragment: string): string {
  return `${canonicalPageUrl(siteOrigin)}${fragment}`
}

/**
 * The stable `@id` of the site's Person entity.
 *
 * Exported so other pages - `/cv`, and the MBTI section - can point at the SAME entity
 * instead of each declaring an unrelated one. Google merges nodes that share an `@id`, so
 * this is what makes a search engine treat everything on the domain as one author's work
 * rather than several disconnected sites, and it consolidates authority accordingly.
 *
 * Deliberately derived from the origin alone: a caller can reference the Person without
 * loading the profile document, so linking to it costs no database read.
 */
export function personEntityId(siteOrigin: string): string {
  return fragmentId(siteOrigin, PERSON_FRAGMENT)
}

function stripTrailingSlashOrigin(siteOrigin: string): string {
  return siteOrigin.replace(/\/$/, '')
}

/** Turn stored avatar/path into absolute https URL where possible. */
function absolutePublicAssetUrl(siteOrigin: string, value: unknown): string | undefined {
  const raw = trimText(value)
  if (!raw || raw === '/' || /\s/.test(raw)) return undefined
  if (/^https:\/\//i.test(raw)) return raw
  if (/^\/\//.test(raw)) return `https:${raw}`
  if (raw.startsWith('/')) return `${stripTrailingSlashOrigin(siteOrigin)}${raw}`
  return undefined
}

function sameAsHttps(vm: PublicPortfolioViewModel): string[] {
  return vm.contact.socials
    .map(s => trimText(s.url))
    .filter(u => /^https:\/\//i.test(u))
    .slice(0, 20)
}

function firstProjectHttpsLink(parts: { link: string }[]): string | undefined {
  for (const part of parts) {
    const u = trimText(part.link)
    if (/^https:\/\//i.test(u)) return u
  }
  return undefined
}

function featuredListItems(vm: PublicPortfolioViewModel): JsonLdThing[] {
  const out: JsonLdThing[] = []
  vm.featuredProjects.projects.forEach((p, i) => {
    const name = collapseWhitespace(p.title)
    if (!name) return
    const url = firstProjectHttpsLink(p.parts)
    out.push({
      '@type': 'ListItem',
      position: i + 1,
      name,
      ...(url ? { url } : {}),
    })
  })
  return out
}

/** Grounded in services fields surfaced on the homepage. */
function professionalServiceCopy(
  profile: PublicProfile,
  vm: PublicPortfolioViewModel,
): { name: string; description?: string } {
  const person = collapseWhitespace(profile.fullName) || vm.meta.displayName
  let svcTitles = vm.services.items.map(s => collapseWhitespace(s.title)).filter(Boolean)
  if (!svcTitles.length) {
    svcTitles = [...vm.services.briefBullets]
  }
  const svcHeading =
    collapseWhitespace(profile.serviceHeading) ||
    collapseWhitespace(vm.services.heading) ||
    (svcTitles.slice(0, 3).length ? svcTitles.slice(0, 3).join(', ') : '')

  const nameParts = [person, svcHeading].filter(Boolean)
  const name = nameParts.length ? nameParts.join(' - ') : person || svcHeading || 'Portfolio'

  const sub = collapseWhitespace(profile.serviceSubHeading) || collapseWhitespace(vm.services.subheading)
  const titleLine = svcTitles.slice(0, 8).join(' · ')

  const rawDesc =
    excerptText([sub, titleLine].filter(Boolean).join(' - '), 380) ||
    excerptText(profile.description || vm.hero.description || (vm.about.paragraphs[0] ?? ''), 260)

  return {
    name: collapseWhitespace(name) || 'Portfolio',
    ...(collapseWhitespace(rawDesc).length >= 48 ? { description: collapseWhitespace(rawDesc) } : {}),
  }
}

function hasServiceSignals(vm: PublicPortfolioViewModel): boolean {
  return (
    vm.services.items.length > 0 ||
    vm.services.briefBullets.length > 0 ||
    collapseWhitespace(vm.services.heading).length > 0 ||
    collapseWhitespace(vm.services.subheading).length > 0
  )
}

/** JSON-LD `Person`, `WebSite`, optional `ProfessionalService` + `ItemList`. */
function buildPortfolioJsonLdGraph(
  siteOrigin: string,
  profile: PublicProfile,
  vm: PublicPortfolioViewModel,
): { '@context': string; '@graph': JsonLdThing[] } {
  const homeUrl = canonicalPageUrl(siteOrigin)
  const personUri = fragmentId(siteOrigin, PERSON_FRAGMENT)
  const webUri = fragmentId(siteOrigin, WEBSITE_FRAGMENT)

  const displayName = collapseWhitespace(profile.fullName) || vm.meta.displayName || 'Portfolio'
  const avatar = absolutePublicAssetUrl(siteOrigin, profile.avatar)
  const sameAs = sameAsHttps(vm)
  const jobTitles = vm.hero.jobTitles

  const person: JsonLdThing = {
    '@type': 'Person',
    '@id': personUri,
    name: displayName,
    url: homeUrl,
    ...(jobTitles.length ? { jobTitle: jobTitles } : {}),
    ...(avatar ? { image: avatar } : {}),
    ...(sameAs.length ? { sameAs } : {}),
  }

  const websiteDescRaw = excerptText(
    profile.description || vm.hero.description || (vm.about.paragraphs[0] ?? vm.hero.headline),
    240,
  )

  const website: JsonLdThing = {
    '@type': 'WebSite',
    '@id': webUri,
    url: homeUrl,
    name: displayName,
    ...(collapseWhitespace(websiteDescRaw).length >= 48 ? { description: collapseWhitespace(websiteDescRaw) } : {}),
    publisher: { '@id': personUri },
  }

  const graph: JsonLdThing[] = [person, website]

  if (hasServiceSignals(vm)) {
    const pro = professionalServiceCopy(profile, vm)
    graph.push({
      '@type': 'ProfessionalService',
      '@id': fragmentId(siteOrigin, PROFESSIONAL_FRAGMENT),
      name: pro.name,
      url: homeUrl,
      ...(pro.description ? { description: pro.description } : {}),
      provider: { '@id': personUri },
    })
  }

  const listElements = featuredListItems(vm)
  if (listElements.length > 0) {
    const listHeading =
      collapseWhitespace(profile.workHeading) ||
      collapseWhitespace(vm.featuredProjects.heading) ||
      `${displayName} - Featured projects`
    const listDescription = collapseWhitespace(vm.featuredProjects.subheading)

    graph.push({
      '@type': 'ItemList',
      '@id': fragmentId(siteOrigin, FEATURED_FRAGMENT),
      name: listHeading,
      ...(listDescription ? { description: listDescription } : {}),
      url: `${homeUrl}#work`,
      numberOfItems: listElements.length,
      itemListElement: listElements,
    })
  }

  return {
    '@context': 'https://schema.org',
    '@graph': graph,
  }
}

function escapeJsonForInlineScript(json: string): string {
  return json
    .replace(/&/g, '\\u0026')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

export function serializePortfolioJsonLd(siteOrigin: string, profile: PublicProfile, vm: PublicPortfolioViewModel): string {
  return escapeJsonForInlineScript(JSON.stringify(buildPortfolioJsonLdGraph(siteOrigin, profile, vm)))
}
