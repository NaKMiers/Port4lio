import type { PublicProfile } from '@/lib/profile-public'
import type {
  Certificate,
  EducationItem,
  ExperienceItem,
  ProjectItem,
  ServiceItem,
  SkillGroup,
  Stat,
} from '@/types/profile'

import {
  FEATURED_PROJECT_LIMIT,
  TRUST_CARD_LIMIT,
  excerptText,
  extractSignatureQuote,
  extractStoreLinksFromProjects,
  labelOutboundHttpsUrl,
  dedupeJobTitles,
  formatExperienceRange,
  heroEditorialHeading,
  heroEditorialSubheading,
  parseExperienceSortTime,
  sanitizeBriefServices,
  sanitizeCertificates,
  sanitizeEducation,
  sanitizeExperience,
  sanitizeProjects,
  sanitizeServiceItems,
  sanitizeSkillGroups,
  sanitizeSocialLinks,
  sanitizeStats,
  sortExperienceRecent,
  splitAboutParagraphs,
  trimText,
  collapseWhitespace,
} from '@/lib/profile-copy'

export type HeroViewModel = {
  fullName: string
  username: string
  jobTitles: string[]
  description: string
  headline: string
  subheadline: string
  avatarUrl: string | null
  backgroundImageUrl: string | null
  cvUrl: string | null
  stats: Stat[]
}

type SocialProofLink = {
  name: string
  url: string
  icon: string
}

export type SocialProofViewModel = {
  profiles: SocialProofLink[]
  /** Store / marketplace URLs mined from shipped project links (deduped). */
  storeLinks: SocialProofLink[]
}

export type FounderProofViewModel = {
  quote: string | null
  attributionName: string
  highlightStats: Stat[]
}

export type AboutViewModel = {
  heading: string
  subheading: string
  paragraphs: string[]
  skills: SkillGroup[]
  experience: ExperienceItem[]
  education: EducationItem[]
  certificates: Certificate[]
}

export type ServicesViewModel = {
  heading: string
  subheading: string
  briefBullets: string[]
  items: ServiceItem[]
}

export type ProjectsBandViewModel = {
  heading: string
  subheading: string
  projects: ProjectItem[]
}

type TrustCardViewModel = {
  id: string
  /** Small category label above the title (metrics, experience, etc.). */
  kicker?: string
  title: string
  body: string
}

export type TrustViewModel = {
  cards: TrustCardViewModel[]
}

type ContactViewModel = {
  socials: SocialProofLink[]
  cvUrl: string | null
}

type PublicPortfolioMeta = {
  displayName: string
  /** True when there is almost nothing safe to render publicly (sections should hide). */
  isEffectivelyEmpty: boolean
}

export type PublicPortfolioViewModel = {
  meta: PublicPortfolioMeta
  hero: HeroViewModel
  socialProof: SocialProofViewModel
  founderProof: FounderProofViewModel
  about: AboutViewModel
  services: ServicesViewModel
  featuredProjects: ProjectsBandViewModel
  projectCatalog: ProjectsBandViewModel
  trust: TrustViewModel
  contact: ContactViewModel
}

function toSocialProofLinks(
  socials: Array<{ name: string; link: string; icon: string }>
): SocialProofLink[] {
  return socials.map(s => ({
    name: collapseWhitespace(s.name) || 'Link',
    url: trimText(s.link),
    icon: trimText(s.icon),
  }))
}

function buildTrustCards(
  profile: PublicProfile,
  paragraphs: string[],
  stats: Stat[],
  projects: ProjectItem[]
): TrustCardViewModel[] {
  const cards: TrustCardViewModel[] = []
  let idx = 0

  const push = (
    kicker: string,
    title: string,
    body: string,
    prefix: string
  ) => {
    if (cards.length >= TRUST_CARD_LIMIT) return
    const t = collapseWhitespace(title)
    const k = collapseWhitespace(kicker)
    const b = body
      .split(/\n/)
      .map(line => collapseWhitespace(line))
      .filter(Boolean)
      .join('\n')
    if (!t || !b) return
    cards.push({
      id: `${prefix}-${idx++}`,
      kicker: k || undefined,
      title: t,
      body: b,
    })
  }

  for (const s of stats.slice(0, 3))
    push('Impact', s.label, String(s.value), 'stat')

  if (cards.length < TRUST_CARD_LIMIT) {
    const storePairs = extractStoreLinksFromProjects(projects)
    if (storePairs.length) {
      const lines = storePairs.slice(0, 8).map(p => {
        const dest = labelOutboundHttpsUrl(p.url)
        return `${collapseWhitespace(p.name)} - ${dest}`
      })
      push('Shipped', 'Live product surfaces', lines.join('\n'), 'store')
    }
  }

  if (cards.length < TRUST_CARD_LIMIT) {
    const groups = sanitizeSkillGroups(profile.skills ?? [])
    const briefLines = sanitizeBriefServices(profile.briefServices ?? [])
    const capLines: string[] = []
    for (const g of groups.slice(0, 3)) {
      const names = g.items
        .slice(0, 6)
        .map(i => collapseWhitespace(i.name))
        .filter(Boolean)
      if (names.length) capLines.push(`${g.groupName}: ${names.join(', ')}`)
    }
    if (!capLines.length && briefLines.length)
      for (const line of briefLines.slice(0, 6)) capLines.push(line)

    if (capLines.length) {
      const capTitle =
        groups[0] && collapseWhitespace(groups[0].groupName)
          ? groups[0].groupName
          : 'What I ship'
      push('Capabilities', capTitle, capLines.join('\n'), 'cap')
    }
  }

  const xp = sortExperienceRecent(sanitizeExperience(profile.experience ?? []))
  for (const e of xp) {
    if (cards.length >= TRUST_CARD_LIMIT) break
    const title = e.position || e.companyName
    const bodyParts = [
      e.companyName && e.companyName !== title ? e.companyName : '',
      formatExperienceRange(e.start, e.end),
    ]
      .filter(Boolean)
      .join(' · ')
    push('Experience', title, bodyParts || 'Experience', 'xp')
  }

  if (cards.length < TRUST_CARD_LIMIT) {
    const snippetSource = paragraphs[0] ?? trimText(profile.aboutMe)
    const snippet = excerptText(snippetSource, 220)
    if (snippet) push('Positioning', 'How I work', snippet, 'about')
  }

  return cards.slice(0, TRUST_CARD_LIMIT)
}

function computeMeta(
  profile: PublicProfile,
  hero: HeroViewModel,
  paragraphs: string[]
): PublicPortfolioMeta {
  const displayName =
    collapseWhitespace(profile.fullName) || hero.headline || 'Portfolio'
  const hasStory = paragraphs.some(p => collapseWhitespace(p).length > 0)
  const hasWork =
    sanitizeProjects(profile.projects ?? []).length > 0 ||
    sanitizeServiceItems(profile.services ?? []).length > 0 ||
    sanitizeBriefServices(profile.briefServices ?? []).length > 0

  const hasIdentity =
    collapseWhitespace(profile.fullName).length > 0 ||
    collapseWhitespace(profile.username).length > 0 ||
    hero.jobTitles.length > 0 ||
    collapseWhitespace(profile.description).length > 0

  const isEffectivelyEmpty =
    !hasIdentity && !hasStory && !hasWork && hero.stats.length === 0

  return { displayName, isEffectivelyEmpty }
}

/**
 * Derived, defensive view model for the public portfolio page (server-first rendering).
 * Starts from {@link normalizeProfile} output - keep API/admin payloads unchanged.
 */
export function derivePublicPortfolioViewModel(
  profile: PublicProfile
): PublicPortfolioViewModel {
  const jobTitles = dedupeJobTitles(profile.jobTitle ?? [])
  const paragraphs = splitAboutParagraphs(profile.aboutMe ?? '')
  const stats = sanitizeStats(profile.stats ?? [])
  const projects = sanitizeProjects(profile.projects ?? [])
  const safeSocials = sanitizeSocialLinks(profile.socials ?? [])
  const services = sanitizeServiceItems(profile.services ?? [])
  const briefBullets = sanitizeBriefServices(profile.briefServices ?? [])

  const hero: HeroViewModel = {
    fullName: collapseWhitespace(profile.fullName),
    username: collapseWhitespace(profile.username),
    jobTitles,
    description: trimText(profile.description).replace(/\s+/g, ' ').trim(),
    headline: heroEditorialHeading(profile),
    subheadline: heroEditorialSubheading(profile),
    avatarUrl: trimText(profile.avatar) || null,
    backgroundImageUrl: trimText(profile.backgroundImage) || null,
    // Falls back to the live CV page. `profile.cv` holds a manually uploaded PDF, which
    // goes stale the moment the CV is edited in the admin - clearing that field is the
    // way to point every "view my CV" link at the page that is always current.
    cvUrl: trimText(profile.cv) || '/cv',
    stats,
  }

  const storeProjects = sanitizeProjects(profile.projects ?? [])
  const storePairs = extractStoreLinksFromProjects(storeProjects)
  const socialProof: SocialProofViewModel = {
    profiles: toSocialProofLinks(safeSocials),
    storeLinks: storePairs.map((p, i) => ({
      name: collapseWhitespace(p.name) || `Store ${i + 1}`,
      url: p.url,
      icon: '',
    })),
  }

  let founderQuote = extractSignatureQuote(paragraphs)
  if (
    founderQuote &&
    paragraphs.length === 1 &&
    collapseWhitespace(paragraphs[0]) === collapseWhitespace(founderQuote)
  )
    founderQuote = null

  const founderProof: FounderProofViewModel = {
    quote: founderQuote,
    attributionName:
      collapseWhitespace(profile.fullName) ||
      collapseWhitespace(profile.username) ||
      hero.headline,
    highlightStats: stats.slice(0, 3),
  }

  const about: AboutViewModel = {
    heading: collapseWhitespace(profile.profileHeading) || hero.headline,
    subheading:
      collapseWhitespace(profile.profileSubHeading) || hero.subheadline,
    paragraphs,
    skills: sanitizeSkillGroups(profile.skills ?? []),
    experience: sanitizeExperience(profile.experience ?? []),
    education: sanitizeEducation(profile.education ?? []),
    certificates: sanitizeCertificates(profile.certificates ?? []),
  }

  const servicesVm: ServicesViewModel = {
    heading: collapseWhitespace(profile.serviceHeading),
    subheading: collapseWhitespace(profile.serviceSubHeading),
    briefBullets,
    items: services,
  }

  const featuredProjects: ProjectItem[] = projects.slice(
    0,
    FEATURED_PROJECT_LIMIT
  )
  const catalogProjects: ProjectItem[] = projects.slice(FEATURED_PROJECT_LIMIT)

  const featuredBand: ProjectsBandViewModel = {
    heading: collapseWhitespace(profile.workHeading),
    subheading: collapseWhitespace(profile.workSubHeading),
    projects: featuredProjects,
  }

  const catalogBand: ProjectsBandViewModel = {
    heading: collapseWhitespace(profile.workHeading),
    subheading: collapseWhitespace(profile.workSubHeading),
    projects: catalogProjects,
  }

  const trust: TrustViewModel = {
    cards: buildTrustCards(profile, paragraphs, stats, projects),
  }

  const contact: ContactViewModel = {
    socials: toSocialProofLinks(safeSocials),
    cvUrl: hero.cvUrl,
  }

  const meta = computeMeta(profile, hero, paragraphs)

  return {
    meta,
    hero,
    socialProof,
    founderProof,
    about,
    services: servicesVm,
    featuredProjects: featuredBand,
    projectCatalog: catalogBand,
    trust,
    contact,
  }
}
