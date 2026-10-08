import 'server-only'

import crypto from 'node:crypto'

import { readPublishedResumeSource } from '@/lib/cv/cv-service'
import { connectDatabase } from '@/lib/mongodb'
import { makeEmptyProfile, normalizeProfile } from '@/lib/profile'
import { deriveResume } from '@/lib/resume-view-model'
import { PROFILE_DOCUMENT_ID, ProfileModel } from '@/models/Profile'
import type { Profile } from '@/types/profile'

/**
 * The profile as agent-sized sections (mcp-plan.md C3), each with a version hash (R6).
 *
 * ```
 *   identity  fullName username jobTitle description avatar backgroundImage publicLocation socials
 *   about     profileHeading profileSubHeading stats aboutMe
 *   career    skills experience education certificates
 *   offering  serviceHeading serviceSubHeading briefServices services
 *   work      workHeading workSubHeading projects
 *   cvFile    cv                       the public CV file link
 *   resume    resume                   the private /cv block, the owner's contact details included
 *
 *   read:  one indexed findById, projected to the section's fields ──▶ normalizeProfile ──▶ pick
 *          resume: the PUBLISHED CV (cv-service.readPublishedResumeSource, the resolver /cv
 *                  uses, uncached here) ──▶ deriveResume, so "no CV yet" reads as the seed
 *   version = sha256(stable JSON of exactly what was returned), 16 hex chars
 * ```
 *
 * A section is always returned whole, never paged (C10), which is what lets `update_profile`
 * replace a whole section safely: the version proves the agent saw all of it.
 *
 * `resume` is the one private section, and reading it here is deliberate: the owner's own
 * contact details are inside the `read` scope because `/cv` already publishes them (premise
 * 5). See the `loadPublishedResume` comment in `profile-data.ts` for why this token-gated read
 * is the one machine-readable exception. Only the published CV is ever returned; the owner's
 * other CVs are not readable over MCP at all (multi-cv-plan.md, NOT in scope).
 *
 * ## Why `resume` comes from the published CV, with the legacy block as fallback
 *
 * CVs live in the `cvs` collection since multi-CV, and `/cv` prints whichever is published.
 * An agent reading `profile.resume` would describe a CV the site no longer shows. Before the
 * owner first opens the CV tab nothing is migrated, and the resolver falls back to
 * `profile.resume` exactly as `/cv` does, so both keep agreeing.
 *
 * ## Why `resume` is derived, not raw
 *
 * A profile that never had a CV block written has no `resume` field, and `/cv` then prints
 * the transcribed seed (`deriveResume`). The raw read returned `null` there, so `get_me` said
 * "no CV" about a page that shows one - found in the acceptance walk, ask 4. The resume is
 * never written through `update_profile` (CVs have their own tools, `mcp/tools/cv.ts`), so
 * its version guards nothing and deriving it costs nothing.
 */

export const PROFILE_SECTIONS = {
  identity: [
    'fullName',
    'username',
    'jobTitle',
    'description',
    'avatar',
    'backgroundImage',
    'publicLocation',
    'socials',
  ],
  about: ['profileHeading', 'profileSubHeading', 'stats', 'aboutMe'],
  career: ['skills', 'experience', 'education', 'certificates'],
  offering: [
    'serviceHeading',
    'serviceSubHeading',
    'briefServices',
    'services',
  ],
  work: ['workHeading', 'workSubHeading', 'projects'],
  cvFile: ['cv'],
  resume: ['resume'],
} as const satisfies Record<string, readonly (keyof Profile)[]>

export type ProfileSection = keyof typeof PROFILE_SECTIONS

export const PROFILE_SECTION_KEYS = Object.keys(
  PROFILE_SECTIONS
) as ProfileSection[]

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map(
        key =>
          `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`
      )
      .join(',')}}`
  return JSON.stringify(value) ?? 'null'
}

export function sectionVersion(value: unknown): string {
  return crypto
    .createHash('sha256')
    .update(stableStringify(value))
    .digest('hex')
    .slice(0, 16)
}

export function pickSection(
  profile: Profile,
  section: ProfileSection
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const field of PROFILE_SECTIONS[section])
    out[field] = profile[field] ?? null
  return out
}

/** Uncached on purpose: an agent that just wrote a section must read its own write back. */
export async function readProfileSection(section: ProfileSection): Promise<{
  value: Record<string, unknown>
  version: string
}> {
  if (section === 'resume') {
    // The avatar rides along: `/cv` falls back to it when the CV has no photo of its own,
    // and the agent must see (and version) the sheet `/cv` actually prints.
    const { resume, avatar } = await readPublishedResumeSource()
    const value = { resume: deriveResume({ resume }, avatar) }
    return { value, version: sectionVersion(value) }
  }

  await connectDatabase()
  const doc = await ProfileModel.findById(PROFILE_DOCUMENT_ID)
    .select(PROFILE_SECTIONS[section].join(' '))
    .lean()
  const profile = doc ? normalizeProfile(doc) : makeEmptyProfile()
  const value = pickSection(profile, section)
  return { value, version: sectionVersion(value) }
}
