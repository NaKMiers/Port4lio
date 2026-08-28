import type React from 'react'

import { makeEmptyResume } from '@/lib/profile'
import type { Profile, Resume } from '@/types/profile'

/** The stored CV block, or an empty one - `resume` is optional on `Profile`. */
export function resumeOf(profile: Profile): Resume {
  return profile.resume ?? makeEmptyResume()
}

/** Applies a change to the CV block without every caller repeating the fallback. */
export function updateResume(
  setProfile: React.Dispatch<React.SetStateAction<Profile>>,
  mutate: (resume: Resume) => Resume
) {
  setProfile(p => ({ ...p, resume: mutate(p.resume ?? makeEmptyResume()) }))
}

/** Replaces one entry of an array field, leaving the rest untouched. */
export function replaceAt<T>(list: T[], index: number, patch: Partial<T>): T[] {
  const next = [...list]
  next[index] = { ...next[index], ...patch }
  return next
}

/** A textarea holds one list entry per line; blank lines are dropped on the way in. */
export const linesToText = (lines: string[]) => lines.join('\n')
export const textToLines = (text: string) =>
  text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)

/** Note shown wherever `**bold**` is accepted, so the syntax is discoverable. */
export const BOLD_HINT = 'Wrap text in **double asterisks** to print it bold.'
