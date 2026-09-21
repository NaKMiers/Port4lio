import {
  collapseWhitespace,
  dedupeJobTitles,
  sanitizeBriefServices,
  sanitizeServiceItems,
  sanitizeSkillGroups,
  splitAboutParagraphs,
} from '@/lib/profile-copy'
import type { PublicProfile } from '@/lib/profile-public'

import { PLATFORM_LIMITS } from './limits'
import { manualBlockField, manualField, siteUrl } from './shared'
import type { ManualArtifact, RenderContext } from './types'

const SKILL_LIMIT = 10

function description(profile: PublicProfile, ctx: RenderContext): string {
  const blocks: string[] = []

  const paragraphs = splitAboutParagraphs(profile.aboutMe)
  // Fiverr's seller description is short - lead with the strongest paragraph only.
  if (paragraphs.length > 0) blocks.push(paragraphs[0])

  const services = sanitizeServiceItems(profile.services).map(service =>
    collapseWhitespace(service.title)
  )
  const brief = sanitizeBriefServices(profile.briefServices)
  const offers = services.length > 0 ? services : brief

  if (offers.length > 0)
    blocks.push(`I build: ${offers.slice(0, 6).join(', ')}.`)

  blocks.push(`Portfolio: ${siteUrl(ctx)}`)

  return blocks.join('\n\n')
}

function tagline(profile: PublicProfile): string {
  const titles = dedupeJobTitles(profile.jobTitle)
  return titles.join(' · ') || collapseWhitespace(profile.description)
}

function skills(profile: PublicProfile): string {
  const seen = new Set<string>()
  const names: string[] = []

  for (const group of sanitizeSkillGroups(profile.skills))
    for (const item of group.items) {
      const name = collapseWhitespace(item.name)
      const key = name.toLowerCase()
      if (!name || seen.has(key)) continue
      seen.add(key)
      names.push(name)
    }

  return names.slice(0, SKILL_LIMIT).join(', ')
}

/** Fiverr publishes no seller API at all, so this is a copy-paste kit by necessity. */
export function renderFiverr(
  profile: PublicProfile,
  ctx: RenderContext
): ManualArtifact {
  return {
    kind: 'fields',
    fields: [
      manualField(
        'tagline',
        'Tagline',
        120,
        tagline(profile),
        'Seller profile → Description'
      ),
      manualBlockField(
        'description',
        'Description',
        PLATFORM_LIMITS.fiverrDescription,
        description(profile, ctx),
        'Seller profile → Description'
      ),
      manualField(
        'skills',
        'Skills',
        200,
        skills(profile),
        `Up to ${SKILL_LIMIT} skills.`
      ),
    ],
  }
}
