import type {
  Certificate,
  EducationItem,
  ExperienceItem,
  Profile,
  ProjectItem,
  ProjectPart,
  Resume,
  ResumeTextBlock,
  ServiceItem,
  SkillGroup,
  SkillItem,
} from '@/types/profile'
import { resolveIconCode } from '@/utils/iconResolver'

export function makeEmptyProfile(): Profile {
  return {
    cv: '',
    fullName: '',
    username: '',
    jobTitle: [],
    description: '',
    avatar: '',
    backgroundImage: '',
    publicLocation: '',
    socials: [],
    profileHeading: '',
    profileSubHeading: '',
    stats: [],
    aboutMe: '',
    skills: [],
    experience: [],
    education: [],
    certificates: [],
    serviceHeading: '',
    serviceSubHeading: '',
    briefServices: [],
    services: [],
    workHeading: '',
    workSubHeading: '',
    projects: [],
  }
}

function ensureStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(item => String(item ?? ''))
}

function ensureIndex(value: unknown): number {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0
}

function ensureArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function normalizeTextBlock(raw: unknown): ResumeTextBlock {
  const source = (raw ?? {}) as Record<string, unknown>
  return { heading: String(source.heading ?? ''), lines: ensureStringArray(source.lines) }
}

export function makeEmptyResume(): Resume {
  return {
    name: '',
    role: '',
    photo: '',
    contact: { email: '', phone: '', location: '', links: [] },
    summary: { heading: '', lines: [] },
    education: { heading: '', lines: [] },
    skillBlocks: [],
    certifications: { heading: '', groups: [] },
    projectSections: [],
    pageBreak: { sectionIndex: 0, projectIndex: 0, highlightsOnFirstSheet: 0 },
  }
}

/**
 * Defensive coercion for the stored `resume` block. Never throws, never invents copy -
 * seeding an absent block is `deriveResume`'s job, not this function's.
 */
export function normalizeResume(raw: unknown): Resume {
  const empty = makeEmptyResume()
  if (!raw || typeof raw !== 'object') return empty

  const source = raw as Record<string, unknown>
  const contact = (source.contact ?? {}) as Record<string, unknown>
  const certifications = (source.certifications ?? {}) as Record<string, unknown>
  const pageBreak = (source.pageBreak ?? {}) as Record<string, unknown>

  return {
    name: String(source.name ?? ''),
    role: String(source.role ?? ''),
    photo: String(source.photo ?? ''),
    contact: {
      email: String(contact.email ?? ''),
      phone: String(contact.phone ?? ''),
      location: String(contact.location ?? ''),
      links: ensureArray(contact.links).map(item => {
        const link = (item ?? {}) as Record<string, unknown>
        return {
          label: String(link.label ?? ''),
          text: String(link.text ?? ''),
          href: String(link.href ?? ''),
        }
      }),
    },
    summary: normalizeTextBlock(source.summary),
    education: normalizeTextBlock(source.education),
    skillBlocks: ensureArray(source.skillBlocks).map(item => {
      const block = (item ?? {}) as Record<string, unknown>
      return {
        heading: String(block.heading ?? ''),
        rows: ensureArray(block.rows).map(row => ({
          items: ensureStringArray((row as Record<string, unknown>)?.items),
        })),
      }
    }),
    certifications: {
      heading: String(certifications.heading ?? ''),
      groups: ensureArray(certifications.groups).map(item => {
        const group = (item ?? {}) as Record<string, unknown>
        return {
          issuer: String(group.issuer ?? ''),
          items: ensureArray(group.items).map(cert => {
            const entry = (cert ?? {}) as Record<string, unknown>
            return { name: String(entry.name ?? ''), link: String(entry.link ?? '') }
          }),
        }
      }),
    },
    projectSections: ensureArray(source.projectSections).map(item => {
      const section = (item ?? {}) as Record<string, unknown>
      return {
        heading: String(section.heading ?? ''),
        items: ensureArray(section.items).map(entry => {
          const project = (entry ?? {}) as Record<string, unknown>
          return {
            employer: String(project.employer ?? ''),
            title: String(project.title ?? ''),
            period: String(project.period ?? ''),
            details: ensureStringArray(project.details),
            highlights: ensureStringArray(project.highlights),
            demoLinks: ensureArray(project.demoLinks).map(link => {
              const entryLink = (link ?? {}) as Record<string, unknown>
              return { label: String(entryLink.label ?? ''), href: String(entryLink.href ?? '') }
            }),
          }
        }),
      }
    }),
    pageBreak: {
      sectionIndex: ensureIndex(pageBreak.sectionIndex),
      projectIndex: ensureIndex(pageBreak.projectIndex),
      highlightsOnFirstSheet: ensureIndex(pageBreak.highlightsOnFirstSheet),
    },
  }
}

export function normalizeProfile(raw: unknown): Profile {
  const empty = makeEmptyProfile()
  if (!raw || typeof raw !== 'object') return empty

  const source = raw as Record<string, unknown>
  const profile: Profile = { ...empty, ...source } as Profile

  profile.socials = Array.isArray(source.socials) ? (source.socials as Profile['socials']) : []
  profile.stats = Array.isArray(source.stats) ? (source.stats as Profile['stats']) : []
  profile.skills = Array.isArray(source.skills) ? (source.skills as SkillGroup[]) : []
  profile.experience = Array.isArray(source.experience)
    ? (source.experience as ExperienceItem[])
    : []
  profile.education = Array.isArray(source.education) ? (source.education as EducationItem[]) : []
  profile.certificates = Array.isArray(source.certificates)
    ? (source.certificates as Certificate[])
    : []
  profile.briefServices = ensureStringArray(source.briefServices)
  profile.services = Array.isArray(source.services) ? (source.services as ServiceItem[]) : []
  profile.projects = Array.isArray(source.projects) ? (source.projects as ProjectItem[]) : []

  profile.fullName = String(profile.fullName ?? '')
  profile.username = String(profile.username ?? '')

  const rawJobTitle = source.jobTitle
  if (Array.isArray(rawJobTitle)) {
    profile.jobTitle = rawJobTitle.map(item => String(item ?? '').trim()).filter(Boolean)
  } else if (typeof rawJobTitle === 'string') {
    profile.jobTitle = rawJobTitle
      .split('\n')
      .map(item => item.trim())
      .filter(Boolean)
  } else {
    profile.jobTitle = []
  }

  profile.description = String(profile.description ?? '')
  profile.profileHeading = String(profile.profileHeading ?? '')
  profile.profileSubHeading = String(profile.profileSubHeading ?? '')
  profile.aboutMe = String(profile.aboutMe ?? '')
  profile.serviceHeading = String(profile.serviceHeading ?? '')
  profile.serviceSubHeading = String(profile.serviceSubHeading ?? '')
  profile.workHeading = String(profile.workHeading ?? '')
  profile.workSubHeading = String(profile.workSubHeading ?? '')
  profile.avatar = profile.avatar ? String(profile.avatar) : ''
  profile.backgroundImage = profile.backgroundImage ? String(profile.backgroundImage) : ''
  profile.publicLocation = profile.publicLocation ? String(profile.publicLocation) : ''
  profile.cv = profile.cv ? String(profile.cv) : ''

  // Absence is meaningful - it is what tells `deriveResume` to fall back to the seed.
  profile.resume =
    source.resume && typeof source.resume === 'object' ? normalizeResume(source.resume) : undefined

  profile.socials = profile.socials.map(item => {
    const name = String(item?.name ?? '')
    const link = String(item?.link ?? '')
    const rawIcon = String(item?.icon ?? '')
    const rawType = String((item as { type?: unknown })?.type ?? '')
    const icon = rawIcon || resolveIconCode(rawType) || rawType || ''
    return { name, link, icon }
  })

  profile.stats = profile.stats.map(item => ({
    label: String(item.label ?? ''),
    value: typeof item.value === 'number' ? item.value : Number(item.value ?? 0),
  }))

  profile.skills = profile.skills.map(group => ({
    groupName: String(group.groupName ?? ''),
    items: Array.isArray(group.items)
      ? (group.items as SkillItem[]).map(item => ({
          icon: String(item.icon ?? ''),
          name: String(item.name ?? ''),
        }))
      : [],
  }))

  profile.projects = profile.projects.map(project => ({
    title: String(project.title ?? ''),
    overview: String(project.overview ?? ''),
    techStack: ensureStringArray((project as { techStack?: unknown }).techStack),
    parts: (() => {
      if (Array.isArray((project as { parts?: unknown }).parts)) {
        return ((project as { parts: unknown[] }).parts ?? []).map(part => ({
          image: String((part as { image?: unknown })?.image ?? ''),
          description: String((part as { description?: unknown })?.description ?? ''),
          link: String((part as { link?: unknown })?.link ?? ''),
        })) satisfies ProjectPart[]
      }

      const legacy = project as {
        images?: unknown[]
        links?: unknown[]
        description?: unknown
      }
      const legacyImages = Array.isArray(legacy.images) ? legacy.images.map(String) : []
      const legacyLinks = Array.isArray(legacy.links) ? legacy.links.map(String) : []
      const legacyDescription = String(legacy.description ?? '')

      if (legacyImages.length > 0) {
        return legacyImages.map((image, index) => ({
          image,
          description: legacyDescription,
          link: legacyLinks[index] ?? legacyLinks[0] ?? '',
        }))
      }

      if (legacyLinks.length > 0 || legacyDescription) {
        return legacyLinks.length > 0
          ? legacyLinks.map(link => ({ image: '', description: legacyDescription, link }))
          : [{ image: '', description: legacyDescription, link: '' }]
      }

      return []
    })(),
  }))

  return profile
}
