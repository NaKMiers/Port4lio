import type {
  Certificate,
  EducationItem,
  ExperienceItem,
  Profile,
  ProjectItem,
  ProjectPart,
  ServiceItem,
  SkillGroup,
  SocialLink,
  Stat,
} from '@/types/profile'

/** Maximum projects surfaced in the featured two-up grid (remainder go to catalog). */
export const FEATURED_PROJECT_LIMIT = 4

/** Maximum trust cards so the section stays light when data is noisy. */
export const TRUST_CARD_LIMIT = 8

/** Rough cap for founder quote pulled from story copy. */
const FOUNDER_QUOTE_MAX_CHARS = 420

export function trimText(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value).replace(/\u00a0/g, ' ').trim()
}

export function collapseWhitespace(value: string): string {
  return trimText(value).replace(/\s+/g, ' ')
}

export function dedupeJobTitles(jobTitles: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of jobTitles) {
    const t = collapseWhitespace(raw)
    if (!t) continue
    const key = t.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(t)
  }
  return out
}

/**
 * Splits story copy into paragraphs: blank-line boundaries first, then soft line breaks for long single blocks.
 */
export function splitAboutParagraphs(aboutMe: string): string[] {
  const cleaned = trimText(aboutMe)
  if (!cleaned) return []

  const byBlankLine = cleaned.split(/\n\s*\n/).map(p => collapseWhitespace(p)).filter(Boolean)
  if (byBlankLine.length > 1) return byBlankLine

  const single = byBlankLine[0] ?? cleaned
  const bySingleNewlines = single
    .split(/\r?\n/)
    .map(p => collapseWhitespace(p))
    .filter(Boolean)
  if (bySingleNewlines.length > 1) return bySingleNewlines

  return single ? [single] : []
}

/**
 * Expands malformed `briefServices` entries (often index 0 contains a packed list) and drops noise.
 */
export function sanitizeBriefServices(briefServices: string[]): string[] {
  const expanded: string[] = []
  for (const raw of briefServices) {
    const piece = trimText(raw)
    if (!piece || piece.toLowerCase() === 'null' || piece.toLowerCase() === 'undefined') continue

    const lines = piece.split(/\r?\n/).map(l => trimText(l)).filter(Boolean)
    if (lines.length > 1) {
      for (const line of lines) {
        const stripped = line.replace(/^[-*•]\s*/, '').trim()
        if (stripped) expanded.push(stripped)
      }
      continue
    }

    const bulletSplit = piece.split(/\s*[•|]\s*/).map(s => trimText(s)).filter(Boolean)
    if (bulletSplit.length > 1) {
      expanded.push(...bulletSplit)
      continue
    }

    expanded.push(piece.replace(/^[-*]\s+/, '').trim())
  }

  const deduped: string[] = []
  const seen = new Set<string>()
  for (const line of expanded) {
    const t = collapseWhitespace(line)
    if (!t) continue
    const key = t.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(t)
  }
  return deduped
}

export function sanitizeServiceItems(services: ServiceItem[]): ServiceItem[] {
  return services
    .map(s => ({
      icon: trimText(s.icon),
      title: collapseWhitespace(s.title),
      description: trimText(s.description).replace(/\s+/g, ' ').trim(),
    }))
    .filter(s => s.title.length > 0 || s.description.length > 0)
}

export function sanitizeStats(stats: Stat[]): Stat[] {
  return stats
    .map(s => ({
      label: collapseWhitespace(s.label),
      value: typeof s.value === 'number' && !Number.isNaN(s.value) ? s.value : Number(s.value ?? 0),
    }))
    .filter(s => s.label.length > 0 && Number.isFinite(s.value))
}

export function sanitizeSocialLinks(socials: SocialLink[]): SocialLink[] {
  return socials
    .map(s => ({
      name: socialDisplayName(s.name, s.link),
      link: trimText(s.link),
      icon: trimText(s.icon),
    }))
    .filter(s => s.link.length > 0 && isSupportedSocialUrl(s.link))
}

function socialPlatformName(link: string): string | null {
  const raw = trimText(link)
  if (!raw) return null

  try {
    const normalized = raw.startsWith('http')
      ? raw
      : raw.startsWith('mailto:') || raw.startsWith('tel:')
        ? raw
        : `https://${raw.replace(/^\/+/, '')}`

    const url = new URL(normalized)
    const host = url.hostname.replace(/^www\./, '').toLowerCase()

    if (host.includes('github.com')) return 'GitHub'
    if (host.includes('linkedin.com')) return 'LinkedIn'
    if (host.includes('youtube.com') || host.includes('youtu.be')) return 'YouTube'
    if (host.includes('instagram.com')) return 'Instagram'
    if (host.includes('facebook.com') || host.includes('fb.com')) return 'Facebook'
    if (host.includes('pinterest.')) return 'Pinterest'
    if (host.includes('zalo.me')) return 'Zalo'
    if (host.includes('x.com') || host.includes('twitter.com')) return 'X'
    if (host.includes('behance.net')) return 'Behance'
    if (host.includes('dribbble.com')) return 'Dribbble'
    if (host.includes('tiktok.com')) return 'TikTok'
    if (host.includes('threads.net')) return 'Threads'
    if (host.includes('medium.com')) return 'Medium'
    if (host.includes('reddit.com')) return 'Reddit'
    if (raw.startsWith('mailto:')) return 'Email'
    if (raw.startsWith('tel:')) return 'Phone'
  } catch {
    if (raw.startsWith('mailto:')) return 'Email'
    if (raw.startsWith('tel:')) return 'Phone'
  }

  return null
}

function looksLikePersonLabel(name: string): boolean {
  const t = collapseWhitespace(name)
  if (!t) return false
  if (t.length > 36) return true
  const lower = t.toLowerCase()
  if (lower.includes('nguyen') || lower.includes('anh khoa')) return true
  return t.split(' ').length >= 2 && !/[./@]/.test(t)
}

function socialDisplayName(name: string, link: string): string {
  const platform = socialPlatformName(link)
  const cleaned = collapseWhitespace(name)

  if (platform) return platform
  if (!cleaned) return 'Website'
  if (looksLikePersonLabel(cleaned)) return 'Website'
  return cleaned
}

function isSupportedSocialUrl(link: string): boolean {
  const t = link.trim()
  return /^https?:\/\//i.test(t) || t.startsWith('/') || t.startsWith('mailto:') || t.startsWith('tel:')
}

export function sanitizeCertificates(certificates: Certificate[]): Certificate[] {
  return certificates
    .map(c => ({
      name: collapseWhitespace(c.name),
      link: trimText(c.link),
    }))
    .filter(c => c.name.length > 0)
}

export function sanitizeEducation(items: EducationItem[]): EducationItem[] {
  return items
    .map(e => ({
      schoolName: collapseWhitespace(e.schoolName),
      major: collapseWhitespace(e.major),
      start: trimText(e.start),
      end: trimText(e.end),
    }))
    .filter(e => e.schoolName.length > 0 || e.major.length > 0)
}

export function sanitizeExperience(items: ExperienceItem[]): ExperienceItem[] {
  return items
    .map(e => ({
      companyName: collapseWhitespace(e.companyName),
      position: collapseWhitespace(e.position),
      start: trimText(e.start),
      end: trimText(e.end),
    }))
    .filter(e => e.companyName.length > 0 || e.position.length > 0)
}

export function sanitizeSkillGroups(groups: SkillGroup[]): SkillGroup[] {
  return groups
    .map(g => ({
      groupName: collapseWhitespace(g.groupName),
      items: Array.isArray(g.items)
        ? g.items
            .map(i => ({
              icon: trimText(i.icon),
              name: collapseWhitespace(i.name),
            }))
            .filter(i => i.name.length > 0)
        : [],
    }))
    .filter(g => g.groupName.length > 0 || g.items.length > 0)
}

/** Maximum tech chips per project card so the surface stays readable. */
export const PROJECT_TECH_LIMIT = 12

function sanitizeTechStack(techStack: unknown): string[] {
  if (!Array.isArray(techStack)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of techStack) {
    const item = collapseWhitespace(String(raw ?? ''))
    if (!item) continue
    const key = item.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
    if (out.length >= PROJECT_TECH_LIMIT) break
  }
  return out
}

function sanitizeProjectParts(parts: ProjectPart[]): ProjectPart[] {
  return parts.map(p => ({
    image: trimText(p.image),
    description: trimText(p.description),
    link: trimText(p.link),
  }))
}

export function sanitizeProjects(projects: ProjectItem[]): ProjectItem[] {
  return projects
    .map(p => ({
      title: collapseWhitespace(p.title),
      overview: collapseWhitespace(p.overview ?? ''),
      techStack: sanitizeTechStack(p.techStack),
      parts: sanitizeProjectParts(Array.isArray(p.parts) ? p.parts : []),
    }))
    .filter(hasRenderableProject)
}

function hasRenderableProject(p: ProjectItem): boolean {
  if (p.title.length > 0) return true
  if ((p.overview ?? '').length > 0) return true
  return p.parts.some(part => part.image.length > 0 || part.description.length > 0 || part.link.length > 0)
}

/**
 * Part descriptions double as carousel captions, so a description that merely repeats the
 * project title carries no information for body copy.
 */
export function projectDetailLines(project: ProjectItem): string[] {
  const title = collapseWhitespace(project.title).toLowerCase()
  const overview = collapseWhitespace(project.overview ?? '').toLowerCase()
  const seen = new Set<string>()
  const out: string[] = []

  for (const part of project.parts) {
    const line = collapseWhitespace(part.description)
    if (!line) continue
    const key = line.toLowerCase()
    if (key === title || key === overview || seen.has(key)) continue
    seen.add(key)
    out.push(line)
  }

  return out
}

const STORE_HOST_HINTS =
  /\b(apps\.apple\.com|itunes\.apple\.com|play\.google\.com|chrome\.google\.com\/webstore)\b/i

export function extractStoreLinksFromProjects(projects: ProjectItem[]): { name: string; url: string }[] {
  const out: { name: string; url: string }[] = []
  const seen = new Set<string>()
  for (const project of projects) {
    const title = collapseWhitespace(project.title) || 'Project'
    for (const part of project.parts) {
      const url = trimText(part.link)
      if (!url || !/^https?:\/\//i.test(url)) continue
      if (!STORE_HOST_HINTS.test(url)) continue
      const key = url.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ name: title, url })
    }
  }
  return out
}

/** Human-friendly label for outbound HTTPS destinations (projects, store links). */
export function labelOutboundHttpsUrl(url: string): string {
  try {
    const u = new URL(url)
    const h = u.hostname.replace(/^www\./, '')
    if (h.includes('apps.apple.com') || h.includes('itunes.apple.com')) return 'App Store'
    if (h.includes('play.google.com')) return 'Google Play'
    if (h.includes('chrome.google.com')) return 'Chrome Web Store'
    if (h === 'github.com' || h.endsWith('.github.com')) return 'GitHub'
    if (h.includes('linkedin.com')) return 'LinkedIn'
    if (h.includes('dribbble.com')) return 'Dribbble'
    if (h.includes('behance.net')) return 'Behance'
    return 'View project'
  } catch {
    return 'View project'
  }
}

/** Deduped HTTPS destinations preserved in project part order. */
export function projectOutboundLinks(project: ProjectItem): { url: string; label: string }[] {
  const seen = new Set<string>()
  const out: { url: string; label: string }[] = []
  for (const part of project.parts) {
    const raw = trimText(part.link)
    if (!raw || !/^https?:\/\//i.test(raw)) continue
    const key = raw.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ url: raw, label: labelOutboundHttpsUrl(raw) })
  }
  return out
}

function splitIntoSentences(text: string): string[] {
  const t = collapseWhitespace(text)
  if (!t) return []
  return t
    .split(/(?<=[.!?])\s+/)
    .map(s => collapseWhitespace(s))
    .filter(Boolean)
}

/**
 * Prefer the closing beat of the story: last paragraph, optionally last sentence if the paragraph is long.
 */
export function extractSignatureQuote(paragraphs: string[]): string | null {
  if (!paragraphs.length) return null
  const last = paragraphs[paragraphs.length - 1]
  if (!last) return null
  if (last.length <= FOUNDER_QUOTE_MAX_CHARS) return last
  const sentences = splitIntoSentences(last)
  const closing = sentences[sentences.length - 1]
  if (closing && closing.length <= FOUNDER_QUOTE_MAX_CHARS) return closing
  return `${last.slice(0, FOUNDER_QUOTE_MAX_CHARS - 1).trim()}…`
}

export function formatExperienceRange(start: string, end: string): string {
  const s = trimText(start)
  const e = trimText(end)
  if (s && e) return `${s} - ${e}`
  return s || e || ''
}

const portfolioPeriodFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})

function utcDateFromInput(iso: string): Date | null {
  const raw = trimText(iso)
  if (!raw) return null
  const d = new Date(raw)
  return Number.isFinite(d.getTime()) ? d : null
}

function isOngoingEndDate(iso: string): boolean {
  const t = trimText(iso).toLowerCase()
  if (!t) return true
  if (t === 'present' || t === 'now' || t === 'current') return true
  const d = utcDateFromInput(iso)
  if (!d) return false
  return d.getTime() > Date.now()
}

/**
 * Human-readable period for editorial surfaces (server-safe, en-US short month + year).
 */
export function formatPortfolioPeriod(start: string, end: string): string {
  const sDate = utcDateFromInput(start)
  const eDate = utcDateFromInput(end)
  const ongoing = isOngoingEndDate(end)
  const startLabel = sDate ? portfolioPeriodFormatter.format(sDate) : trimText(start)
  const endLabel = ongoing ? 'Present' : eDate ? portfolioPeriodFormatter.format(eDate) : trimText(end)
  if (startLabel && endLabel) return `${startLabel} - ${endLabel}`
  return startLabel || endLabel || ''
}

export function sortExperienceRecent(items: ExperienceItem[]): ExperienceItem[] {
  return [...items].sort((a, b) => {
    const tb = parseExperienceSortTime(b.end) || parseExperienceSortTime(b.start)
    const ta = parseExperienceSortTime(a.end) || parseExperienceSortTime(a.start)
    return tb - ta
  })
}

export function sortEducationRecent(items: EducationItem[]): EducationItem[] {
  return [...items].sort((a, b) => {
    const tb = parseExperienceSortTime(b.end) || parseExperienceSortTime(b.start)
    const ta = parseExperienceSortTime(a.end) || parseExperienceSortTime(a.start)
    return tb - ta
  })
}

export function parseExperienceSortTime(iso: string): number {
  const t = Date.parse(trimText(iso))
  return Number.isFinite(t) ? t : 0
}

/** Heading/subheading fallbacks when editorial fields are empty. */
export function heroEditorialHeading(profile: Profile): string {
  const h = collapseWhitespace(profile.profileHeading)
  if (h) return h
  const name = collapseWhitespace(profile.fullName)
  return name || 'Portfolio'
}

export function heroEditorialSubheading(profile: Profile): string {
  const s = collapseWhitespace(profile.profileSubHeading)
  if (s) return s
  const jobs = dedupeJobTitles(profile.jobTitle ?? [])
  if (jobs.length) return jobs.join(' · ')
  return collapseWhitespace(profile.description)
}

export function excerptText(text: string, maxChars: number): string {
  const t = collapseWhitespace(text)
  if (!t) return ''
  if (t.length <= maxChars) return t
  return `${t.slice(0, Math.max(0, maxChars - 1)).trim()}…`
}
