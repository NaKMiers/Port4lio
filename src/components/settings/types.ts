import type React from 'react'

import type { Profile } from '@/types/profile'

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
 */
export type CvSectionProps = {
  profile: Profile
  setProfile: React.Dispatch<React.SetStateAction<Profile>>
  /** Drag grip supplied by the CV tab's `DragList`. */
  handle?: React.ReactNode
  /**
   * Re-measures the sheets and re-picks the page break. Call it after any reorder that
   * changes how much copy sits above the break; see `useCvPageBreakFit`.
   */
  onFitPageBreak?: () => void
}
