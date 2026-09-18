import {
  collapseWhitespace,
  dedupeJobTitles,
  sanitizeBriefServices,
  sanitizeProjects,
  sanitizeServiceItems,
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
const SKILL_LIMIT = 15

function title(profile: PublicProfile): string {
  const titles = dedupeJobTitles(profile.jobTitle)
  const description = collapseWhitespace(profile.description)
  return titles.join(' | ') || description
}

function overview(profile: PublicProfile, ctx: RenderContext): string {
  const blocks: string[] = []

  const paragraphs = splitAboutParagraphs(profile.aboutMe)
  if (paragraphs.length > 0) blocks.push(paragraphs.join('\n\n'))

  const services = sanitizeServiceItems(profile.services)
  const brief = sanitizeBriefServices(profile.briefServices)

  if (services.length > 0) {
    blocks.push(
      ['What I can do for you:', ...services.map(service => {
        const description = collapseWhitespace(service.description)
        return `• ${collapseWhitespace(service.title)}${description ? ` - ${description}` : ''}`
      })].join('\n')
    )
  } else if (brief.length > 0) {
    blocks.push(['What I can do for you:', ...brief.map(item => `• ${item}`)].join('\n'))
  }

  const projects = sanitizeProjects(profile.projects)
    .filter(project => trimText(project.title))
    .slice(0, PROJECT_LIMIT)

  if (projects.length > 0) {
    blocks.push(
      ['Recent work:', ...projects.map(project => {
        const tech = (project.techStack ?? []).map(collapseWhitespace).filter(Boolean)
        const overviewText = collapseWhitespace(project.overview ?? '')
        const suffix = tech.length > 0 ? ` (${tech.slice(0, 8).join(', ')})` : ''
        return `• ${collapseWhitespace(project.title)}${overviewText ? ` - ${overviewText}` : ''}${suffix}`
      })].join('\n')
    )
  }

  const stats = sanitizeStats(profile.stats)
  if (stats.length > 0) {
    blocks.push(
      stats
        .map(stat => `${stat.value.toLocaleString('en-US')} ${collapseWhitespace(stat.label)}`)
        .join(' · ')
    )
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

  return names.slice(0, SKILL_LIMIT).join(', ')
}

/**
 * Upwork's GraphQL API is read-oriented and exposes no mutation for editing your own
 * freelancer profile, so these are paste targets.
 */
export function renderUpwork(profile: PublicProfile, ctx: RenderContext): ManualArtifact {
  return {
    kind: 'fields',
    fields: [
      manualField(
        'title',
        'Professional title',
        PLATFORM_LIMITS.upworkTitle,
        title(profile),
        'Profile settings → Title'
      ),
      manualBlockField(
        'overview',
        'Overview',
        PLATFORM_LIMITS.upworkOverview,
        overview(profile, ctx),
        'Profile settings → Overview'
      ),
      manualField('skills', 'Skills', 400, skills(profile), `Up to ${SKILL_LIMIT} skills, comma separated.`),
    ],
  }
}
