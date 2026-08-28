import {
  collapseWhitespace,
  dedupeJobTitles,
  extractStoreLinksFromProjects,
  sanitizeProjects,
  sanitizeSkillGroups,
  sanitizeStats,
  splitAboutParagraphs,
  trimText,
} from '@/lib/profile-copy'
import type { PublicProfile } from '@/lib/profile-public'

import { PLATFORM_LIMITS } from './limits'
import { manualBlockField, manualField, siteUrl } from './shared'
import type { ManualArtifact, RenderContext } from './types'

const PROJECT_LIMIT = 3

function headline(profile: PublicProfile): string {
  const titles = dedupeJobTitles(profile.jobTitle)
  const description = collapseWhitespace(profile.description)
  if (titles.length > 0 && description) return `${titles.join(' · ')} | ${description}`
  return titles.join(' · ') || description
}

function about(profile: PublicProfile, ctx: RenderContext): string {
  const paragraphs = splitAboutParagraphs(profile.aboutMe)
  const stats = sanitizeStats(profile.stats)
  const projects = sanitizeProjects(profile.projects)
    .filter(project => trimText(project.title))
    .slice(0, PROJECT_LIMIT)

  const blocks: string[] = [...paragraphs]

  if (stats.length > 0) {
    blocks.push(
      stats
        .map(stat => `${stat.value.toLocaleString('en-US')} ${collapseWhitespace(stat.label)}`)
        .join(' · ')
    )
  }

  if (projects.length > 0) {
    blocks.push(
      ['What I have shipped:', ...projects.map(project => {
        const overview = collapseWhitespace(project.overview ?? '')
        return `• ${collapseWhitespace(project.title)}${overview ? ` — ${overview}` : ''}`
      })].join('\n')
    )
  }

  const stores = extractStoreLinksFromProjects(profile.projects).filter(link =>
    /^https:\/\//i.test(link.url)
  )
  if (stores.length > 0) {
    blocks.push(stores.map(link => `${collapseWhitespace(link.name)}: ${link.url}`).join('\n'))
  }

  blocks.push(`Portfolio: ${siteUrl(ctx)}`)

  return blocks.join('\n\n')
}

function skills(profile: PublicProfile): string {
  const seen = new Set<string>()
  const names: string[] = []

  for (const group of sanitizeSkillGroups(profile.skills)) {
    for (const item of group.items) {
      const name = collapseWhitespace(item.name)
      const key = name.toLowerCase()
      if (!name || seen.has(key)) continue
      seen.add(key)
      names.push(name)
    }
  }

  return names.slice(0, PLATFORM_LIMITS.linkedinSkills).join('\n')
}

/** LinkedIn has no profile-write API - these are paste targets, not API payloads. */
export function renderLinkedIn(profile: PublicProfile, ctx: RenderContext): ManualArtifact {
  const skillList = skills(profile)
  const skillCount = skillList ? skillList.split('\n').length : 0

  return {
    kind: 'fields',
    fields: [
      manualField(
        'headline',
        'Headline',
        PLATFORM_LIMITS.linkedinHeadline,
        headline(profile),
        'Profile → Edit intro → Headline'
      ),
      manualBlockField(
        'about',
        'About',
        PLATFORM_LIMITS.linkedinAbout,
        about(profile, ctx),
        'Profile → About → Edit'
      ),
      {
        key: 'skills',
        label: 'Skills',
        limit: PLATFORM_LIMITS.linkedinSkills,
        value: skillList,
        sourceLength: skillCount,
        overflow: skillCount >= PLATFORM_LIMITS.linkedinSkills,
        hint: 'One per line. Add via Profile → Skills → Add skill.',
      },
    ],
  }
}
