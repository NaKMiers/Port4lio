import type React from 'react'

import type { Resume } from '@/types/profile'

/**
 * The editor's tabs. Lives here rather than in the page so the preview rail can switch on
 * it without importing from a route module.
 */
export type SettingTabId = 'profile' | 'career' | 'offering' | 'cv'

export type IconPickerTarget =
  | { kind: 'skill'; groupIndex: number; itemIndex: number }
  | { kind: 'service'; serviceIndex: number }
  | { kind: 'social'; socialIndex: number }
  | null

export type UploadingState = {
  avatar: boolean
  background: boolean
  /** The downloadable CV file. */
  cv: boolean
  /** The photo printed on the `/cv` masthead, which is not the same asset. */
  cvPhoto: boolean
  projects: Record<number, boolean>
}

/**
 * What every reorderable CV section card takes. They are rendered from a lookup keyed by
 * `ResumeSectionKey`, so they have to agree on one prop shape.
 *
 * The card edits one CV's draft, not the profile: the CV tab edits whichever CV the picker
 * selected (`useCvEditor`), and that draft lives beside the profile rather than inside it.
 * `avatar` is the one profile field a card needs, for the photo fallback `/cv` applies.
 */
export type CvSectionProps = {
  resume: Resume
  setResume: React.Dispatch<React.SetStateAction<Resume>>
  /** The portfolio avatar, which an unset CV photo inherits. */
  avatar: string
  /** Drag grip supplied by the CV tab's `DragList`. */
  handle?: React.ReactNode
  /**
   * Re-measures the sheets and re-picks the page break. Call it after any reorder that
   * changes how much copy sits above the break; see `useCvPageBreakFit`.
   */
  onFitPageBreak?: () => void
}
