import { RESUME_SEED } from '@/lib/resume-seed'
import type { Profile, Resume, ResumeLink, ResumeProjectSection } from '@/types/profile'

/**
 * One printed block in the project stream. Sheets are slices of this flat list, which is
 * what lets a page break land inside a bullet list rather than only on a project boundary.
 */
export type ResumePrintItem =
  | { kind: 'sectionHeading'; text: string }
  | {
      kind: 'projectHead'
      employer: string
      title: string
      period: string
      /** First project after a heading uses the tighter `gBody`; later ones use `gProj`. */
      gap: 'gBody' | 'gProj'
    }
  | { kind: 'details'; lines: string[] }
  | { kind: 'highlights'; lines: string[] }
  | { kind: 'demo'; links: ResumeLink[] }

export type ResumeSheetPlan = {
  /** Printed on sheet 1, below the masthead / summary / skills / certifications blocks. */
  first: ResumePrintItem[]
  /** Printed on sheet 2. The first item carries the `gTop` margin. */
  second: ResumePrintItem[]
}

/** Where a print item came from, so the splitter can find the break coordinate. */
type LocatedItem = {
  item: ResumePrintItem
  sectionIndex: number
  projectIndex: number
}

/**
 * Flattens sections and projects into the exact sequence of printed blocks.
 *
 * Empty `details` / `highlights` / `demoLinks` emit no item at all, so an emptied list
 * cannot leave a stray vertical gap on the sheet.
 */
export function flattenResumeProjects(sections: ResumeProjectSection[]): ResumePrintItem[] {
  return locateResumeProjects(sections).map(entry => entry.item)
}

function locateResumeProjects(sections: ResumeProjectSection[]): LocatedItem[] {
  const out: LocatedItem[] = []

  sections.forEach((section, sectionIndex) => {
    const items = Array.isArray(section.items) ? section.items : []
    if (section.heading) {
      out.push({ item: { kind: 'sectionHeading', text: section.heading }, sectionIndex, projectIndex: 0 })
    }

    items.forEach((project, projectIndex) => {
      const at = { sectionIndex, projectIndex }
      out.push({
        item: {
          kind: 'projectHead',
          employer: project.employer ?? '',
          title: project.title ?? '',
          period: project.period ?? '',
          gap: projectIndex === 0 ? 'gBody' : 'gProj',
        },
        ...at,
      })

      const details = (project.details ?? []).filter(Boolean)
      if (details.length > 0) out.push({ item: { kind: 'details', lines: details }, ...at })

      const highlights = (project.highlights ?? []).filter(Boolean)
      if (highlights.length > 0) out.push({ item: { kind: 'highlights', lines: highlights }, ...at })

      const links = (project.demoLinks ?? []).filter(link => link?.href)
      if (links.length > 0) out.push({ item: { kind: 'demo', links }, ...at })
    })
  })

  return out
}

/**
 * Splits the flat item list at {@link Resume.pageBreak}, cutting the addressed
 * `highlights` block in two when the break lands mid bullet list.
 *
 * An out-of-range coordinate clamps to the nearest whole-project boundary rather than
 * throwing - a bad number in the admin should misplace the break, not blank the page.
 */
export function planResumeSheets(resume: Resume): ResumeSheetPlan {
  const located = locateResumeProjects(resume.projectSections ?? [])
  const { sectionIndex, projectIndex, highlightsOnFirstSheet } = resume.pageBreak ?? {
    sectionIndex: 0,
    projectIndex: 0,
    highlightsOnFirstSheet: 0,
  }

  const breakAt = located.findIndex(
    entry =>
      entry.sectionIndex === sectionIndex &&
      entry.projectIndex === projectIndex &&
      entry.item.kind === 'highlights'
  )

  // No such coordinate: fall back to the last project boundary that exists.
  if (breakAt === -1) {
    const fallback = located.findIndex(
      entry =>
        entry.item.kind === 'projectHead' &&
        (entry.sectionIndex > sectionIndex ||
          (entry.sectionIndex === sectionIndex && entry.projectIndex >= projectIndex))
    )
    const cut = fallback === -1 ? located.length : fallback
    return {
      first: located.slice(0, cut).map(entry => entry.item),
      second: located.slice(cut).map(entry => entry.item),
    }
  }

  const target = located[breakAt].item
  const lines = target.kind === 'highlights' ? target.lines : []
  const keep = Math.max(0, Math.min(Math.trunc(highlightsOnFirstSheet) || 0, lines.length))

  const first = located.slice(0, breakAt).map(entry => entry.item)
  const second: ResumePrintItem[] = []

  if (keep > 0) first.push({ kind: 'highlights', lines: lines.slice(0, keep) })
  if (keep < lines.length) second.push({ kind: 'highlights', lines: lines.slice(keep) })

  second.push(...located.slice(breakAt + 1).map(entry => entry.item))

  return { first, second }
}

/**
 * Stored resume when the document has one, otherwise the transcribed seed.
 *
 * The seed lives here in the derived layer, deliberately not in `normalizeProfile` -
 * that function is documented as defensive coercion that never invents content, and
 * keeping it out preserves `undefined` as the "never written" signal.
 */
export function deriveResume(profile: Pick<Profile, 'resume'>): Resume {
  return profile.resume ?? RESUME_SEED
}
