import { normalizeResumeSectionOrder } from '@/lib/resume-sections'
import { RESUME_SEED } from '@/lib/resume-seed'
import type {
  Profile,
  Resume,
  ResumeCertificationGroup,
  ResumeLink,
  ResumeSkillRow,
} from '@/types/profile'

/** Vertical gap a section rule takes, chosen from what printed immediately above it. */
export type HeadingGap = 'gFirst' | 'gHead' | 'gHeadS'

/**
 * One printed block in the sheet stream. Sheets are slices of this flat list, which is
 * what lets a page break land inside a bullet list rather than only on a project boundary.
 *
 * Everything below the masthead is in here - summary, education, skills and certifications
 * as well as the projects - because {@link Resume.sectionOrder} can put those blocks in any
 * order, including after the page break.
 */
export type ResumePrintItem =
  | { kind: 'sectionHeading'; text: string; gap: HeadingGap }
  | { kind: 'text'; lines: string[]; justify: boolean }
  | { kind: 'skillRows'; rows: ResumeSkillRow[] }
  | { kind: 'certifications'; groups: ResumeCertificationGroup[] }
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
  /** Printed on sheet 1, below the masthead. */
  first: ResumePrintItem[]
  /** Printed on sheet 2. The first item carries the `gTop` margin. */
  second: ResumePrintItem[]
}

/**
 * Where a print item came from, so the splitter can find the break coordinate. Blocks that
 * are not projects carry `-1`, which no page-break coordinate can address.
 */
export type LocatedResumeItem = {
  item: ResumePrintItem
  sectionIndex: number
  projectIndex: number
}

const NOT_A_PROJECT = { sectionIndex: -1, projectIndex: -1 }

/**
 * The gap a section rule needs given what printed above it.
 *
 * The source document uses three different values here, and which one is right is a
 * function of the preceding block, not of the section's identity - a rule after a skill row
 * sits tighter than one after body copy, and the first rule on the page clears the masthead.
 * Deriving it is what keeps the typography exact under an arbitrary section order.
 */
function headingGap(previous: ResumePrintItem | undefined): HeadingGap {
  if (!previous) return 'gFirst'
  return previous.kind === 'skillRows' ? 'gHeadS' : 'gHead'
}

/**
 * Flattens the resume into the exact sequence of printed blocks, in `sectionOrder`.
 *
 * Empty `details` / `highlights` / `demoLinks` emit no item at all, so an emptied list
 * cannot leave a stray vertical gap on the sheet.
 */
export function flattenResume(resume: Resume): ResumePrintItem[] {
  return locateResumeItems(resume).map(entry => entry.item)
}

/**
 * The flat stream with each block's origin attached, in `sectionOrder`.
 *
 * Exported for the page-break fitter, which measures the rendered blocks and has to map a
 * DOM child back to the project coordinate that addresses it.
 */
export function locateResumeItems(resume: Resume): LocatedResumeItem[] {
  const out: LocatedResumeItem[] = []
  const push = (item: ResumePrintItem, at = NOT_A_PROJECT) =>
    out.push({ item, ...at })
  const lastItem = () => out[out.length - 1]?.item

  for (const key of normalizeResumeSectionOrder(resume.sectionOrder))
    switch (key) {
      case 'summary':
        push({
          kind: 'sectionHeading',
          text: resume.summary.heading,
          gap: headingGap(lastItem()),
        })
        push({ kind: 'text', lines: resume.summary.lines, justify: true })
        break

      case 'education':
        push({
          kind: 'sectionHeading',
          text: resume.education.heading,
          gap: headingGap(lastItem()),
        })
        push({ kind: 'text', lines: resume.education.lines, justify: false })
        break

      case 'skills':
        for (const block of resume.skillBlocks ?? []) {
          push({
            kind: 'sectionHeading',
            text: block.heading,
            gap: headingGap(lastItem()),
          })
          push({ kind: 'skillRows', rows: block.rows ?? [] })
        }
        break

      case 'certifications':
        push({
          kind: 'sectionHeading',
          text: resume.certifications.heading,
          gap: headingGap(lastItem()),
        })
        push({
          kind: 'certifications',
          groups: resume.certifications.groups ?? [],
        })
        break

      case 'projects':
        pushProjects(resume, push, lastItem)
        break
    }

  return out
}

function pushProjects(
  resume: Resume,
  push: (
    item: ResumePrintItem,
    at?: { sectionIndex: number; projectIndex: number }
  ) => void,
  lastItem: () => ResumePrintItem | undefined
) {
  ;(resume.projectSections ?? []).forEach((section, sectionIndex) => {
    const items = Array.isArray(section.items) ? section.items : []
    if (section.heading)
      push(
        {
          kind: 'sectionHeading',
          text: section.heading,
          gap: headingGap(lastItem()),
        },
        { sectionIndex, projectIndex: 0 }
      )

    items.forEach((project, projectIndex) => {
      const at = { sectionIndex, projectIndex }
      push(
        {
          kind: 'projectHead',
          employer: project.employer ?? '',
          title: project.title ?? '',
          period: project.period ?? '',
          gap: projectIndex === 0 ? 'gBody' : 'gProj',
        },
        at
      )

      const details = (project.details ?? []).filter(Boolean)
      if (details.length > 0) push({ kind: 'details', lines: details }, at)

      const highlights = (project.highlights ?? []).filter(Boolean)
      if (highlights.length > 0)
        push({ kind: 'highlights', lines: highlights }, at)

      const links = (project.demoLinks ?? []).filter(link => link?.href)
      if (links.length > 0) push({ kind: 'demo', links }, at)
    })
  })
}

/**
 * Splits the flat item list at {@link Resume.pageBreak}, cutting the addressed
 * `highlights` block in two when the break lands mid bullet list.
 *
 * An out-of-range coordinate clamps to the nearest whole-project boundary rather than
 * throwing - a bad number in the admin should misplace the break, not blank the page.
 */
export function planResumeSheets(resume: Resume): ResumeSheetPlan {
  const located = locateResumeItems(resume)
  const { sectionIndex, projectIndex, highlightsOnFirstSheet } =
    resume.pageBreak ?? {
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
          (entry.sectionIndex === sectionIndex &&
            entry.projectIndex >= projectIndex))
    )
    const cut = fallback === -1 ? located.length : fallback
    return {
      first: located.slice(0, cut).map(entry => entry.item),
      second: located.slice(cut).map(entry => entry.item),
    }
  }

  const target = located[breakAt].item
  const lines = target.kind === 'highlights' ? target.lines : []
  const keep = Math.max(
    0,
    Math.min(Math.trunc(highlightsOnFirstSheet) || 0, lines.length)
  )

  const first = located.slice(0, breakAt).map(entry => entry.item)
  const second: ResumePrintItem[] = []

  if (keep > 0) first.push({ kind: 'highlights', lines: lines.slice(0, keep) })
  if (keep < lines.length)
    second.push({ kind: 'highlights', lines: lines.slice(keep) })

  second.push(...located.slice(breakAt + 1).map(entry => entry.item))

  return { first, second }
}

/**
 * Stored resume when the document has one, otherwise the transcribed seed.
 *
 * The seed lives here in the derived layer, deliberately not in `normalizeProfile` -
 * that function is documented as defensive coercion that never invents content, and
 * keeping it out preserves `undefined` as the "never written" signal.
 *
 * `fallbackPhoto` is the portfolio avatar. An empty `resume.photo` means "inherit it",
 * so the CV tracks the profile picture by default and only diverges when a CV-specific
 * photo was uploaded. The bundled last resort is applied at the `/cv` masthead instead of
 * here, so callers that only need the stored intent - the settings editor, which saves
 * whatever this returns - keep seeing the empty "inherit" value.
 */
export function deriveResume(
  profile: Pick<Profile, 'resume'>,
  fallbackPhoto?: string
): Resume {
  const resume = profile.resume ?? RESUME_SEED
  const photo = resume.photo || fallbackPhoto || ''

  return photo === resume.photo ? resume : { ...resume, photo }
}
