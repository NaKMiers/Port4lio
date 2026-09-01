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

