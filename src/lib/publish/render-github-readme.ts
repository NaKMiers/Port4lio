import {
  collapseWhitespace,
  extractStoreLinksFromProjects,
  labelOutboundHttpsUrl,
  projectOutboundLinks,
  sanitizeCertificates,
  sanitizeExperience,
  sanitizeProjects,
  sanitizeSkillGroups,
  sanitizeStats,
  sortExperienceRecent,
  splitAboutParagraphs,
  trimText,
} from '@/lib/profile-copy'
import type { PublicProfile } from '@/lib/profile-public'

import { joinSections, mdLink, mdTable } from './markdown'
import { displayName, formatPublishPeriod, publishableSocials, siteUrl } from './shared'
import type { GithubReadmeArtifact, RenderContext } from './types'

const PROJECT_LIMIT = 4
const ABOUT_PARAGRAPH_LIMIT = 2

function header(profile: PublicProfile, ctx: RenderContext): string {
  const name = displayName(profile)
  const titles = profile.jobTitle.map(collapseWhitespace).filter(Boolean)
  const lines = [`# ${name || ctx.githubUsername}`]

  if (titles.length > 0) lines.push('', `**${titles.join(' · ')}**`)

  const description = collapseWhitespace(profile.description)
  if (description) lines.push('', description)

  return lines.join('\n')
}

function links(profile: PublicProfile, ctx: RenderContext): string {
  const socials = publishableSocials(profile.socials)
    .filter(social => {
      try {
        return !new URL(social.link).hostname.includes('github.com')
      } catch {
        return false
      }
    })
    .map(social => mdLink(collapseWhitespace(social.name) || labelOutboundHttpsUrl(social.link), social.link))

  const all = [mdLink('Portfolio', siteUrl(ctx)), ...socials]
  return all.length > 0 ? all.join(' · ') : ''
}

function stats(profile: PublicProfile): string {
  const items = sanitizeStats(profile.stats)
  if (items.length === 0) return ''
  return items
    .map(stat => `**${stat.value.toLocaleString('en-US')}** ${collapseWhitespace(stat.label)}`)
    .join(' · ')
}

function about(profile: PublicProfile): string {
  const paragraphs = splitAboutParagraphs(profile.aboutMe).slice(0, ABOUT_PARAGRAPH_LIMIT)
  if (paragraphs.length === 0) return ''
  return joinSections(['## About', ...paragraphs])
}

function skills(profile: PublicProfile): string {
  const groups = sanitizeSkillGroups(profile.skills).filter(group => group.items.length > 0)
  if (groups.length === 0) return ''

  const rows = groups.map(group => [
    collapseWhitespace(group.groupName),
    group.items.map(item => collapseWhitespace(item.name)).join(', '),
  ])

  return joinSections(['## Stack', mdTable(['Area', 'Tools'], rows)])
}

function projects(profile: PublicProfile): string {
  const items = sanitizeProjects(profile.projects)
    .filter(project => trimText(project.title))
    .slice(0, PROJECT_LIMIT)
  if (items.length === 0) return ''

  const blocks = items.map(project => {
    const lines = [`### ${collapseWhitespace(project.title)}`]

    const overview = collapseWhitespace(project.overview ?? '')
    if (overview) lines.push('', overview)

    const tech = (project.techStack ?? []).map(collapseWhitespace).filter(Boolean)
    if (tech.length > 0) lines.push('', `\`${tech.join('` · `')}\``)

    const outbound = projectOutboundLinks(project)
      .filter(link => /^https:\/\//i.test(link.url))
      .map(link => mdLink(link.label, link.url))
    if (outbound.length > 0) lines.push('', outbound.join(' · '))

    return lines.join('\n')
  })

  return joinSections(['## Selected work', ...blocks])
}

function shipped(profile: PublicProfile): string {
  const storeLinks = extractStoreLinksFromProjects(profile.projects).filter(link =>
    /^https:\/\//i.test(link.url)
  )
  if (storeLinks.length === 0) return ''

  const rows = storeLinks.map(link => [
    collapseWhitespace(link.name),
    mdLink(labelOutboundHttpsUrl(link.url), link.url),
  ])

  return joinSections(['## Live on stores', mdTable(['Product', 'Where'], rows)])
}

function experience(profile: PublicProfile, ctx: RenderContext): string {
  const items = sortExperienceRecent(sanitizeExperience(profile.experience))
  if (items.length === 0) return ''

  const rows = items.map(item => [
    formatPublishPeriod(item.start, item.end, ctx.now),
    collapseWhitespace(item.position),
    collapseWhitespace(item.companyName),
  ])

  return joinSections(['## Experience', mdTable(['When', 'Role', 'Where'], rows)])
}

function certificates(profile: PublicProfile): string {
  const items = sanitizeCertificates(profile.certificates).filter(item => trimText(item.name))
  if (items.length === 0) return ''

  const list = items.map(item =>
    item.link ? `- ${mdLink(item.name, item.link)}` : `- ${collapseWhitespace(item.name)}`
  )

  return joinSections(['## Certifications', list.join('\n')])
}

/**
 * The GitHub profile README, rendered whole.
 *
 * Returns content with NO trailing newline: the workflow writes it via `jq -r`, which
 * appends one. Emitting our own would produce a stable-but-ugly blank line at EOF.
 */
export function renderGithubReadme(
  profile: PublicProfile,
  ctx: RenderContext
): GithubReadmeArtifact {
  const content = joinSections([
    header(profile, ctx),
    links(profile, ctx),
    stats(profile),
    about(profile),
    skills(profile),
    projects(profile),
    shipped(profile),
    experience(profile, ctx),
    certificates(profile),
    '<sub>Generated from ' + siteUrl(ctx) + ' - edits there land here automatically.</sub>',
  ])

  return { kind: 'file', path: 'README.md', content }
}
