import type {
  Certificate,
  EducationItem,
  ExperienceItem,
  Profile,
  ProjectItem,
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

  return cleaned
}
