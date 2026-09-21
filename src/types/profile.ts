export type SocialLink = {
  link: string
  icon: string
  name: string
}

export type Stat = {
  label: string
  value: number
}

export type SkillItem = {
  icon: string
  name: string
}

export type SkillGroup = {
  groupName: string
  items: SkillItem[]
}

export type ExperienceItem = {
  companyName: string
  position: string
  start: string // ISO
  end: string // ISO
}

export type EducationItem = {
  schoolName: string
  major: string
  start: string
  end: string
}

export type Certificate = {
  link: string
  name: string
}

export type ServiceItem = {
  icon: string
  title: string
  description: string
}

export type ProjectPart = {
  image: string
  description: string
  link: string
}

export type ProjectItem = {
  title: string
  /** Short editorial summary of what the project is. Rendered as the card overview. */
  overview?: string
  /** Notable frameworks, databases, and services. Rendered as chips under the overview. */
  techStack?: string[]
  parts: ProjectPart[]
}

/**
 * CV copy carries `**bold**` runs, rendered by `renderInlineBold` in
 * `src/lib/resume-inline.tsx`. Everything else is literal - no markdown, no entity
 * decoding, no smart quotes. The A4 grid is width sensitive, so anything that rewrites
 * characters is out of scope.
 */
export type ResumeContactLink = {
  /** Prefix printed before the anchor, e.g. `Portfolio`. Empty renders the anchor alone. */
  label: string
  /** Exact anchor text. The masthead pipe gaps are measured against its width. */
  text: string
  href: string
}

export type ResumeContact = {
  email: string
  phone: string
  location: string
  /** Second contact row: labelled links separated by vector pipes. */
  links: ResumeContactLink[]
}

/** A rule heading plus body lines. Covers the SUMMARY and EDUCATION blocks. */
export type ResumeTextBlock = {
  heading: string
  /** One printed line each; `**x**` renders bold. */
  lines: string[]
}

/** One printed skill row. Spans justify edge to edge, so row membership is layout. */
export type ResumeSkillRow = {
  items: string[]
}

export type ResumeSkillBlock = {
  heading: string
  rows: ResumeSkillRow[]
}

export type ResumeCertificationGroup = {
  /** Bolded prefix before the link list, e.g. `Anthropic, 2026`. Colon added on render. */
  issuer: string
  items: Certificate[]
}

export type ResumeCertificationBlock = {
  heading: string
  groups: ResumeCertificationGroup[]
}

export type ResumeLink = {
  label: string
  href: string
}

export type ResumeProject = {
  /**
   * Underlined employer prefix (`Rikkeisoft`), printed inside the bold title run. Empty
   * for personal projects, whose title carries its own `**` markers instead.
   */
  employer: string
  /** Head row copy. `**x**` renders bold. */
  title: string
  /** Right-aligned italic date, e.g. `02/2025 - current` or `4 months`. */
  period: string
  /** Level-1 rows, one printed line each (`**Position: ...**`, `**Description: **body`). */
  details: string[]
  /** Level-2 bullets printed under the last detail row. */
  highlights: string[]
  /** Trailing level-1 `Demo:` row. Empty hides the row entirely. */
  demoLinks: ResumeLink[]
}

export type ResumeProjectSection = {
  heading: string
  items: ResumeProject[]
}

/**
 * One reorderable block of printed sheet 1. See `src/lib/resume-sections.ts`.
 *
 * `skills` covers every entry of {@link Resume.skillBlocks} as a unit - the blocks print
 * consecutively and are reordered among themselves, not interleaved with other sections.
 * `projects` is the stream that spills onto sheet 2; sections placed after it therefore
 * print after the page break.
 */
export type ResumeSectionKey =
  'summary' | 'education' | 'skills' | 'certifications' | 'projects'

/**
 * Where sheet 1 ends. The source splits mid bullet list, so the coordinate addresses a
 * highlight inside a project, not a project boundary. Out-of-range values clamp rather
 * than throw - see `planResumeSheets`.
 */
export type ResumePageBreak = {
  /** Index into `projectSections`. */
  sectionIndex: number
  /** Index into that section's `items`. */
  projectIndex: number
  /**
   * How many of that project's `highlights` print on sheet 1. `0` moves the whole bullet
   * list to sheet 2; `highlights.length` keeps the project whole on sheet 1.
   */
  highlightsOnFirstSheet: number
}

/**
 * Print copy for the fixed-geometry `/cv` route.
 *
 * Deliberately independent of the portfolio fields: `/cv` is length-capped by
 * `height: 297mm; overflow: hidden`, the portfolio is not. Sharing one string between
 * surfaces with conflicting length budgets means a portfolio edit can silently clip the
 * last line of CV page 2.
 */
export type Resume = {
  name: string
  role: string
  photo: string
  /**
   * Hides the masthead photo and lets the name/role/rule/contact block reclaim its width.
   * The stored `photo` (and any CV-specific upload) is untouched - toggling this back on
   * restores it exactly, rather than requiring a re-upload.
   */
  hidePhoto: boolean
  contact: ResumeContact
  /**
   * Print order of the blocks below the masthead. Normalised to name every section
   * exactly once - see `normalizeResumeSectionOrder`.
   */
  sectionOrder: ResumeSectionKey[]
  summary: ResumeTextBlock
  education: ResumeTextBlock
  /** TECHNICAL SKILLS / AI ENGINEERING / SOFT SKILLS, in print order. */
  skillBlocks: ResumeSkillBlock[]
  certifications: ResumeCertificationBlock
  /** PERSONAL PROJECTS then WORK PROJECTS. */
  projectSections: ResumeProjectSection[]
  pageBreak: ResumePageBreak
}

export type Profile = {
  cv?: string

  /**
   * Print copy for `/cv`. Absent on documents written before the CV became data-driven -
   * that absence is the seed signal, see `deriveResume`. Contains contact details, so it
   * is NOT on the public allowlist in `src/lib/profile-public.ts`.
   */
  resume?: Resume

  fullName: string
  username: string
  jobTitle: string[]
  description: string

  avatar?: string
  backgroundImage?: string

  /**
   * City-level location safe to publish (e.g. `Ho Chi Minh City`). Deliberately separate
   * from any street-level address so "show where I work" can never reach for a home address.
   */
  publicLocation?: string

  socials: SocialLink[]

  profileHeading: string
  profileSubHeading: string
  stats: Stat[]

  aboutMe: string

  skills: SkillGroup[]
  experience: ExperienceItem[]
  education: EducationItem[]
  certificates: Certificate[]

  serviceHeading: string
  serviceSubHeading: string
  briefServices: string[]
  services: ServiceItem[]

  workHeading: string
  workSubHeading: string
  projects: ProjectItem[]
}
