import type {
  Certificate,
  EducationItem,
  ExperienceItem,
  Profile,
  ProjectItem,
  Resume,
  ResumeTextBlock,
  ServiceItem,
  SocialLink,
  SkillGroup,
  SkillItem,
  Stat,
} from '@/types/profile'

function trimOrEmpty(value: string | undefined): string {
  return String(value ?? '').trim()
}

function isBlank(value: string | undefined): boolean {
  return trimOrEmpty(value) === ''
}

function pruneSocials(socials: SocialLink[]): SocialLink[] {
  return socials
    .map(s => ({ name: trimOrEmpty(s.name), icon: trimOrEmpty(s.icon), link: trimOrEmpty(s.link) }))
    .filter(s => !isBlank(s.name) || !isBlank(s.icon) || !isBlank(s.link))
}

function pruneStats(stats: Stat[]): Stat[] {
  return stats
    .map(st => ({ label: trimOrEmpty(st.label), value: Number(st.value ?? 0) }))
    .filter(st => !isBlank(st.label) || st.value !== 0)
}

function pruneSkills(skills: SkillGroup[]): SkillGroup[] {
  return skills
    .map(group => {
      const groupName = trimOrEmpty(group.groupName)
      const items = (group.items ?? [])
        .map(it => ({ icon: trimOrEmpty(it.icon), name: trimOrEmpty(it.name) }))
        .filter(it => !isBlank(it.icon) || !isBlank(it.name))
      return { groupName, items }
    })
    .filter(group => !isBlank(group.groupName) || group.items.length > 0)
}

function pruneExperience(experience: ExperienceItem[]): ExperienceItem[] {
  return experience
    .map(item => ({
      companyName: trimOrEmpty(item.companyName),
      position: trimOrEmpty(item.position),
      start: trimOrEmpty(item.start),
      end: trimOrEmpty(item.end),
    }))
    .filter(
      item =>
        !isBlank(item.companyName) ||
        !isBlank(item.position) ||
        !isBlank(item.start) ||
        !isBlank(item.end)
    )
}

function pruneEducation(education: EducationItem[]): EducationItem[] {
  return education
    .map(item => ({
      schoolName: trimOrEmpty(item.schoolName),
      major: trimOrEmpty(item.major),
      start: trimOrEmpty(item.start),
      end: trimOrEmpty(item.end),
    }))
    .filter(
      item =>
        !isBlank(item.schoolName) || !isBlank(item.major) || !isBlank(item.start) || !isBlank(item.end)
    )
}

function pruneCertificates(certificates: Certificate[]): Certificate[] {
  return certificates
    .map(c => ({ name: trimOrEmpty(c.name), link: trimOrEmpty(c.link) }))
    .filter(c => !isBlank(c.name) || !isBlank(c.link))
}

function pruneServices(services: ServiceItem[]): ServiceItem[] {
  return services
    .map(sv => ({
      icon: trimOrEmpty(sv.icon),
      title: trimOrEmpty(sv.title),
      description: trimOrEmpty(sv.description),
    }))
    .filter(sv => !isBlank(sv.icon) || !isBlank(sv.title) || !isBlank(sv.description))
}

function pruneProjects(projects: ProjectItem[]): ProjectItem[] {
  return projects
    .map(prj => {
      const title = trimOrEmpty(prj.title)
      const overview = trimOrEmpty(prj.overview)
      const techStack = (prj.techStack ?? []).map(item => trimOrEmpty(item)).filter(Boolean)
      const parts = (prj.parts ?? [])
        .map(part => ({
          image: trimOrEmpty(part.image),
          description: trimOrEmpty(part.description),
          link: trimOrEmpty(part.link),
        }))
        .filter(part => !isBlank(part.image) || !isBlank(part.description) || !isBlank(part.link))

      return { ...prj, title, overview, techStack, parts }
    })
    .filter(
      prj =>
        !isBlank(prj.title) ||
        !isBlank(prj.overview) ||
        (prj.techStack?.length ?? 0) > 0 ||
        (prj.parts?.length ?? 0) > 0
    )
}

/**
 * Trims the CV block and drops empty entries. Returns `undefined` when nothing is left,
 * so the key is omitted from the payload rather than blanking the stored CV via `$set`.
 */
function pruneResume(resume: Resume | undefined): Resume | undefined {
  if (!resume) return undefined

  const cleaned: Resume = {
    name: trimOrEmpty(resume.name),
    role: trimOrEmpty(resume.role),
    photo: trimOrEmpty(resume.photo),
    contact: {
      email: trimOrEmpty(resume.contact?.email),
      phone: trimOrEmpty(resume.contact?.phone),
      location: trimOrEmpty(resume.contact?.location),
      links: (resume.contact?.links ?? [])
        .map(link => ({
          label: trimOrEmpty(link.label),
          text: trimOrEmpty(link.text),
          href: trimOrEmpty(link.href),
        }))
        .filter(link => !isBlank(link.text) || !isBlank(link.href)),
    },
    summary: pruneTextBlock(resume.summary),
    education: pruneTextBlock(resume.education),
    skillBlocks: (resume.skillBlocks ?? [])
      .map(block => ({
        heading: trimOrEmpty(block.heading),
        rows: (block.rows ?? [])
          .map(row => ({ items: (row.items ?? []).map(trimOrEmpty).filter(Boolean) }))
          .filter(row => row.items.length > 0),
      }))
      .filter(block => !isBlank(block.heading) || block.rows.length > 0),
    certifications: {
      heading: trimOrEmpty(resume.certifications?.heading),
      groups: (resume.certifications?.groups ?? [])
        .map(group => ({
          issuer: trimOrEmpty(group.issuer),
          items: (group.items ?? [])
            .map(item => ({ name: trimOrEmpty(item.name), link: trimOrEmpty(item.link) }))
            .filter(item => !isBlank(item.name) || !isBlank(item.link)),
        }))
        .filter(group => !isBlank(group.issuer) || group.items.length > 0),
    },
    projectSections: (resume.projectSections ?? [])
      .map(section => ({
        heading: trimOrEmpty(section.heading),
        items: (section.items ?? [])
          .map(project => ({
            employer: trimOrEmpty(project.employer),
            title: trimOrEmpty(project.title),
            period: trimOrEmpty(project.period),
            details: (project.details ?? []).map(trimOrEmpty).filter(Boolean),
            highlights: (project.highlights ?? []).map(trimOrEmpty).filter(Boolean),
            demoLinks: (project.demoLinks ?? [])
              .map(link => ({ label: trimOrEmpty(link.label), href: trimOrEmpty(link.href) }))
              .filter(link => !isBlank(link.href)),
          }))
          .filter(project => !isBlank(project.title) || project.details.length > 0),
      }))
      .filter(section => !isBlank(section.heading) || section.items.length > 0),
    pageBreak: {
      sectionIndex: Math.max(0, Math.trunc(resume.pageBreak?.sectionIndex ?? 0)),
      projectIndex: Math.max(0, Math.trunc(resume.pageBreak?.projectIndex ?? 0)),
      highlightsOnFirstSheet: Math.max(
        0,
        Math.trunc(resume.pageBreak?.highlightsOnFirstSheet ?? 0)
      ),
    },
  }

  const isEmpty =
    isBlank(cleaned.name) &&
    isBlank(cleaned.role) &&
    cleaned.skillBlocks.length === 0 &&
    cleaned.projectSections.length === 0 &&
    cleaned.summary.lines.length === 0 &&
    cleaned.education.lines.length === 0 &&
    cleaned.certifications.groups.length === 0

  return isEmpty ? undefined : cleaned
}

function pruneTextBlock(block: ResumeTextBlock | undefined): ResumeTextBlock {
  return {
    heading: trimOrEmpty(block?.heading),
    lines: (block?.lines ?? []).map(trimOrEmpty).filter(Boolean),
  }
}

export function cleanProfileForSave(profile: Profile): Partial<Profile> {
  const cleaned: Partial<Profile> = {
    ...profile,
    fullName: trimOrEmpty(profile.fullName),
    username: trimOrEmpty(profile.username),
    description: trimOrEmpty(profile.description),
    avatar: trimOrEmpty(profile.avatar),
    backgroundImage: trimOrEmpty(profile.backgroundImage),

    socials: pruneSocials(profile.socials ?? []),
    profileHeading: trimOrEmpty(profile.profileHeading),
    profileSubHeading: trimOrEmpty(profile.profileSubHeading),
    stats: pruneStats(profile.stats ?? []),
    aboutMe: trimOrEmpty(profile.aboutMe),

    skills: pruneSkills(profile.skills ?? []),
    experience: pruneExperience(profile.experience ?? []),
    education: pruneEducation(profile.education ?? []),
    certificates: pruneCertificates(profile.certificates ?? []),

    serviceHeading: trimOrEmpty(profile.serviceHeading),
    serviceSubHeading: trimOrEmpty(profile.serviceSubHeading),
    briefServices: (profile.briefServices ?? []).map(s => trimOrEmpty(s)).filter(Boolean),
    services: pruneServices(profile.services ?? []),

    workHeading: trimOrEmpty(profile.workHeading),
    workSubHeading: trimOrEmpty(profile.workSubHeading),
    projects: pruneProjects(profile.projects ?? []),

    publicLocation: trimOrEmpty(profile.publicLocation),
    resume: pruneResume(profile.resume),
  }

  // Omit empty arrays/objects from payload (JSON.stringify drops `undefined` keys).
  if (!cleaned.socials?.length) delete cleaned.socials
  if (!cleaned.stats?.length) delete cleaned.stats
  if (!cleaned.skills?.length) delete cleaned.skills
  if (!cleaned.experience?.length) delete cleaned.experience
  if (!cleaned.education?.length) delete cleaned.education
  if (!cleaned.certificates?.length) delete cleaned.certificates
  if (!cleaned.briefServices?.length) delete cleaned.briefServices
  if (!cleaned.services?.length) delete cleaned.services
  if (!cleaned.projects?.length) delete cleaned.projects
  // Omitted rather than sent empty: an absent key leaves the stored resume alone, while
  // `resume: {}` would overwrite it. That is what stops any editor state that never
  // populated the CV tab from blanking a saved CV on the next save.
  if (!cleaned.resume) delete cleaned.resume

  return cleaned
}
