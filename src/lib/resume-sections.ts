import type { ResumeSectionKey } from '@/types/profile'

/**
 * The movable blocks of printed sheet 1, in the order the original PDF used.
 *
 * The masthead is deliberately absent: it is the page header, absolutely positioned
 * against the sheet's own top edge, so "move it below SUMMARY" is not a thing the layout
 * can express. Everything else is normal flow and can be reordered freely.
 */
export const RESUME_SECTION_KEYS = [
  'summary',
  'education',
  'skills',
  'certifications',
  'projects',
] as const

export const DEFAULT_RESUME_SECTION_ORDER: ResumeSectionKey[] = [...RESUME_SECTION_KEYS]

/** Editor-facing names, so the settings tab and the print order stay in sync. */
export const RESUME_SECTION_LABELS: Record<ResumeSectionKey, string> = {
  summary: 'CV Summary',
  education: 'CV Education',
  skills: 'CV Skills',
  certifications: 'CV Certifications',
  projects: 'CV Projects',
}

function isSectionKey(value: unknown): value is ResumeSectionKey {
  return (RESUME_SECTION_KEYS as readonly string[]).includes(String(value))
}

/**
 * Coerces a stored order into one that names every section exactly once.
 *
 * Unknown and duplicate keys are dropped, and anything missing is appended in the default
 * order - so a resume saved before this field existed, or one written by an older build
 * that did not know about a section, still prints every block it has.
 */
export function normalizeResumeSectionOrder(raw: unknown): ResumeSectionKey[] {
  const seen = new Set<ResumeSectionKey>()
  const order: ResumeSectionKey[] = []

  for (const entry of Array.isArray(raw) ? raw : []) {
    if (isSectionKey(entry) && !seen.has(entry)) {
      seen.add(entry)
      order.push(entry)
    }
  }

  for (const key of RESUME_SECTION_KEYS) {
    if (!seen.has(key)) order.push(key)
  }

  return order
}

/** Moves one entry of a list to another index, returning a new list. */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= list.length || to < 0 || to >= list.length) return list
  const next = [...list]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}
