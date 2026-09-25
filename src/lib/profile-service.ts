import 'server-only'

import { revalidateTag } from 'next/cache'

import { listUnsafe, unsafeUrls } from '@/lib/mcp/safe-urls'
import { connectDatabase } from '@/lib/mongodb'
import { normalizeProfile } from '@/lib/profile'
import { PUBLIC_PROFILE_CACHE_TAG } from '@/lib/profile-data'
import {
  PROFILE_SECTIONS,
  pickSection,
  sectionVersion,
  type ProfileSection,
} from '@/lib/profile-sections'
import { MAX_PROFILE_JSON_BYTES } from '@/lib/upload-limits'
import { PROFILE_DOCUMENT_ID, ProfileModel } from '@/models/Profile'
import type { Profile } from '@/types/profile'

/**
 * Profile writes: one for the settings editor, one for an agent - sharing the write and the
 * cache invalidation (premise 2, C8).
 *
 * ```
 *   POST /api/profile ──▶ replaceProfile(body)        the whole document, $set + upsert, unchanged
 *                            the editor's body no longer carries `resume` (multi-CV, below)
 *   update_profile    ──▶ patchProfileSection(section, value, version)
 *                            resume ──▶ refused: CVs are written by update_cv (cv-service)
 *                            keys   ──▶ exactly the section's fields, or refused
 *                            version ≠ hash of the stored section ──▶ refused, re-read   (R6)
 *                            normalizeProfile ──▶ $set IF updatedAt is still what was read
 *   after the write succeeds:
 *     replaceProfile      ──▶ revalidateTag(PUBLIC_PROFILE_CACHE_TAG, 'max')        stale once, then fresh
 *     patchProfileSection ──▶ revalidateTag(PUBLIC_PROFILE_CACHE_TAG, { expire: 0 }) fresh on the next load
 * ```
 *
 * ## Why the resume is not a section update_profile writes (R8, reversed by Phase 2)
 *
 * R8 kept the resume human-only: `/cv` is fixed A4 geometry (`height: 297mm; overflow:
 * hidden`), text that runs long is cut off at the bottom of the sheet with no signal, and
 * nothing on the server can tell whether a tailored CV still fits without rendering it.
 * multi-cv-plan.md Phase 2 lets agents write CVs anyway, at the owner's request - but through
 * `update_cv` (`mcp/tools/cv.ts` ──▶ `cv-service.saveCv`, actor 'agent'), not here. That path
 * tracks the risk instead of forbidding it: an agent's write sets `fitVerified: false`,
 * publishing an unverified CV answers with a warning, and the settings editor re-fits the
 * page and shows a banner until the owner's Save CV verifies it (P2-A). The `resume` section
 * here is still refused, pointing at `update_cv`.
 *
 * ## Where the CV is written now
 *
 * Not here. Since multi-CV the CVs live in the `cvs` collection and every CV write goes
 * through `lib/cv/cv-service.ts` (Save CV, Publish, Delete in the settings CV tab), which
 * does its own cache expiry. `profile.resume` is the legacy block: the migration source and
 * the pre-migration `/cv` fallback. `replaceProfile` still stores it if a body sends it -
 * `tests/api/profile-route.test.ts` pins that (R10) - but `cleanProfileForSave` never does,
 * and nothing reads it once "Main CV" exists (TODOS.md tracks removing it).
 *
 * ## Why a section is replaced whole, with a version
 *
 * Sections are never paged (C10), so an agent that read one has read all of it, and the
 * `version` it got back proves which copy it read. A stale version - the owner saved the
 * section in `/admin/settings` meanwhile - is refused rather than silently overwritten, and
 * the write itself is conditional on the `updatedAt` read alongside it, so a save landing
 * between the check and the write is refused too.
 *
 * ## Why the agent's write expires the cache and the editor's only marks it stale
 *
 * `'max'` is stale-while-revalidate: the first load after the write still serves the old
 * profile and refreshes it in the background. Measured in the acceptance walk (ask 6): an
 * agent fixed the headline, and `/` showed the typo once more. The owner in the editor sees
 * their own save in the form, but an agent's owner only sees the site, so `update_profile`
 * expires the entry outright (`{ expire: 0 }`, a blocking re-read on the next request).
 * The editor path keeps `'max'`, which `tests/api/profile-route.test.ts` pins (R10).
 *
 * `replaceProfile` is the settings editor's save exactly as `POST /api/profile` did it, which
 * `tests/api/profile-route.test.ts` pins field by field (R10).
 */

type OwnerProfileDocument = Record<string, unknown>

/**
 * `POST /api/profile`: the editor's whole-document save, moved unchanged.
 *
 * `base` is the stale-tab guard, the profile's version of R9: the `updatedAt` the settings
 * editor loaded. Given, the save lands only if the document is still that version, so an
 * agent's `update_profile` made while the tab sat open is not silently replaced; a miss is
 * `{ stale }`. Without it - every caller before the guard existed - the save is exactly what
 * it always was, which `tests/api/profile-route.test.ts` pins (R10).
 */
export async function replaceProfile(
  parsed: Profile,
  { base }: { base?: Date } = {}
): Promise<OwnerProfileDocument | { stale: Date | null } | null> {
  await connectDatabase()
  const now = new Date()
  if (base) {
    const guarded = await ProfileModel.findOneAndUpdate(
      { _id: PROFILE_DOCUMENT_ID, updatedAt: base },
      { $set: { ...parsed, updatedAt: now } },
      { returnDocument: 'after', lean: true, runValidators: true }
    )
    if (!guarded) {
      const current = await ProfileModel.findById(PROFILE_DOCUMENT_ID)
        .select('updatedAt')
        .lean<{ updatedAt?: Date }>()
      return { stale: current?.updatedAt ?? null }
    }
    revalidateTag(PUBLIC_PROFILE_CACHE_TAG, 'max')
    return guarded as OwnerProfileDocument
  }
  const updatedDoc = await ProfileModel.findOneAndUpdate(
    { _id: PROFILE_DOCUMENT_ID },
    {
      $set: {
        ...parsed,
        updatedAt: now,
      },
      $setOnInsert: {
        _id: PROFILE_DOCUMENT_ID,
        createdAt: now,
      },
    },
    { upsert: true, returnDocument: 'after', lean: true, runValidators: true }
  )

  if (!updatedDoc) return null

  revalidateTag(PUBLIC_PROFILE_CACHE_TAG, 'max')
  return updatedDoc as OwnerProfileDocument
}

export type SectionPatchResult =
  | {
      ok: true
      section: ProfileSection
      version: string
      value: Record<string, unknown>
    }
  | { ok: false; reason: 'resume' | 'invalid' | 'conflict'; error: string }

/** `update_profile`: replace one section, given the version the agent read. */
export async function patchProfileSection(
  section: ProfileSection,
  value: Record<string, unknown>,
  version: string
): Promise<SectionPatchResult> {
  if (section === 'resume')
    return {
      ok: false,
      reason: 'resume',
      error:
        'The CV (resume) is not a profile section: the owner keeps several CVs, and /cv prints the published one. Edit a CV with update_cv (list_cvs and get_cv give you its id and version); the owner checks the page fit in /admin/settings. Nothing was changed.',
    }

  const fields: readonly string[] = PROFILE_SECTIONS[section]
  const unknown = Object.keys(value).filter(key => !fields.includes(key))
  const missing = fields.filter(key => !(key in value))
  if (unknown.length || missing.length)
    return {
      ok: false,
      reason: 'invalid',
      error: [
        `The ${section} section is replaced whole: send exactly ${fields.join(', ')}, as get_profile returned them with your edits.`,
        unknown.length ? `Not in this section: ${unknown.join(', ')}.` : '',
        missing.length ? `Missing: ${missing.join(', ')}.` : '',
        'Nothing was changed.',
      ]
        .filter(Boolean)
        .join(' '),
    }

  // The owner's editor is capped at the route; this path must not be the way around it.
  if (Buffer.byteLength(JSON.stringify(value)) > MAX_PROFILE_JSON_BYTES)
    return {
      ok: false,
      reason: 'invalid',
      error: `The ${section} section is over the ${MAX_PROFILE_JSON_BYTES / (1024 * 1024)} MB profile limit. Nothing was changed.`,
    }

  await connectDatabase()
  const stored = await ProfileModel.findById(PROFILE_DOCUMENT_ID)
    .select(`${fields.join(' ')} updatedAt`)
    .lean<Record<string, unknown> & { updatedAt?: Date }>()
  const current = pickSection(normalizeProfile(stored ?? {}), section)
  if (sectionVersion(current) !== version)
    return {
      ok: false,
      reason: 'conflict',
      error: `The ${section} section changed since you read it (or the version is wrong). Call get_profile again and retry with the new version. Nothing was changed.`,
    }

  const next = pickSection(normalizeProfile(value), section)
  const unsafe = unsafeUrls(next, current)
  if (unsafe.length)
    return {
      ok: false,
      reason: 'invalid',
      error: `These URLs are not allowed on the profile: ${listUnsafe(unsafe)}. Images must be uploaded to this site's Cloudinary (the owner does that in /admin/settings); links must be https, http or mailto. Nothing was changed.`,
    }
  const now = new Date()
  const updated = await ProfileModel.findOneAndUpdate(
    stored
      ? { _id: PROFILE_DOCUMENT_ID, updatedAt: stored.updatedAt ?? null }
      : { _id: PROFILE_DOCUMENT_ID },
    {
      $set: { ...next, updatedAt: now },
      $setOnInsert: { _id: PROFILE_DOCUMENT_ID, createdAt: now },
    },
    {
      upsert: !stored,
      returnDocument: 'after',
      lean: true,
      runValidators: true,
    }
  )
  if (!updated)
    return {
      ok: false,
      reason: 'conflict',
      error: `The profile was saved by someone else a moment ago. Call get_profile again and retry. Nothing was changed.`,
    }

  revalidateTag(PUBLIC_PROFILE_CACHE_TAG, { expire: 0 })

  const saved = pickSection(normalizeProfile(updated), section)
  return { ok: true, section, version: sectionVersion(saved), value: saved }
}
