import 'server-only'

import { revalidateTag } from 'next/cache'

import { connectDatabase } from '@/lib/mongodb'
import { normalizeProfile } from '@/lib/profile'
import { PUBLIC_PROFILE_CACHE_TAG } from '@/lib/profile-data'
import {
  PROFILE_SECTIONS,
  pickSection,
  sectionVersion,
  type ProfileSection,
} from '@/lib/profile-sections'
import { PROFILE_DOCUMENT_ID, ProfileModel } from '@/models/Profile'
import type { Profile } from '@/types/profile'

/**
 * Profile writes: one for the settings editor, one for an agent - sharing the write and the
 * cache invalidation (premise 2, C8).
 *
 * ```
 *   POST /api/profile ──▶ replaceProfile(body)        the whole document, $set + upsert, unchanged
 *   update_profile    ──▶ patchProfileSection(section, value, version)
 *                            resume ──▶ refused: edited only in /admin/settings        (R8)
 *                            keys   ──▶ exactly the section's fields, or refused
 *                            version ≠ hash of the stored section ──▶ refused, re-read   (R6)
 *                            normalizeProfile ──▶ $set IF updatedAt is still what was read
 *   both ──▶ revalidateTag(PUBLIC_PROFILE_CACHE_TAG, 'max')     after the write succeeds
 * ```
 *
 * ## Why the resume is never agent-written (R8)
 *
 * `/cv` is fixed A4 geometry (`height: 297mm; overflow: hidden`): text that runs long is cut
 * off at the bottom of the sheet with no signal, and nothing on the server can tell whether a
 * tailored CV still fits without rendering it. The settings editor is the one place the owner
 * sees the page. So `tailor-cv` returns markdown and the owner pastes what they keep.
 *
 * ## Why a section is replaced whole, with a version
 *
 * Sections are never paged (C10), so an agent that read one has read all of it, and the
 * `version` it got back proves which copy it read. A stale version - the owner saved the
 * section in `/admin/settings` meanwhile - is refused rather than silently overwritten, and
 * the write itself is conditional on the `updatedAt` read alongside it, so a save landing
 * between the check and the write is refused too.
 *
 * `replaceProfile` is the settings editor's save exactly as `POST /api/profile` did it, which
 * `tests/api/profile-route.test.ts` pins field by field (R10).
 */

type OwnerProfileDocument = Record<string, unknown>

/** `POST /api/profile`: the editor's whole-document save, moved unchanged. */
export async function replaceProfile(
  parsed: Profile
): Promise<OwnerProfileDocument | null> {
  await connectDatabase()
  const now = new Date()
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
        'The CV (resume) is edited only in /admin/settings: /cv is a fixed A4 page, and the server cannot tell whether new text still fits. Give the owner the text instead. Nothing was changed.',
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

  revalidateTag(PUBLIC_PROFILE_CACHE_TAG, 'max')

  const saved = pickSection(normalizeProfile(updated), section)
  return { ok: true, section, version: sectionVersion(saved), value: saved }
}
