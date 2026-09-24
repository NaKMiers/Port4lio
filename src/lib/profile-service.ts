import 'server-only'

import { revalidateTag } from 'next/cache'

import { isAllowedImageUrl } from '@/lib/blog/rehype-restrict-image-hosts'
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
 *   update_profile    ──▶ patchProfileSection(section, value, version)
 *                            resume ──▶ refused: edited only in /admin/settings        (R8)
 *                            keys   ──▶ exactly the section's fields, or refused
 *                            version ≠ hash of the stored section ──▶ refused, re-read   (R6)
 *                            normalizeProfile ──▶ $set IF updatedAt is still what was read
 *   after the write succeeds:
 *     replaceProfile      ──▶ revalidateTag(PUBLIC_PROFILE_CACHE_TAG, 'max')        stale once, then fresh
 *     patchProfileSection ──▶ revalidateTag(PUBLIC_PROFILE_CACHE_TAG, { expire: 0 }) fresh on the next load
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

/** Keys whose string values are rendered as an image on `/`, and those rendered as a link. */
const IMAGE_KEYS = new Set(['avatar', 'backgroundImage', 'image'])
const LINK_KEYS = new Set(['link', 'href', 'cv'])

/** Every string under an image or link key, anywhere in a section value. */
function urlsIn(
  value: unknown,
  into = { images: new Set<string>(), links: new Set<string>() },
  depth = 0
) {
  if (depth > 12 || !value || typeof value !== 'object') return into
  for (const [key, entry] of Object.entries(value))
    if (typeof entry === 'string' && entry) {
      if (IMAGE_KEYS.has(key)) into.images.add(entry)
      else if (LINK_KEYS.has(key)) into.links.add(entry)
    } else urlsIn(entry, into, depth + 1)

  return into
}

function isSafeLink(value: string): boolean {
  try {
    return ['https:', 'http:', 'mailto:'].includes(new URL(value).protocol)
  } catch {
    return false
  }
}

/**
 * An agent's section is rendered on `/`. A URL it introduces - one not already in the stored
 * section - must be an image from this site's own Cloudinary (the same rule the blog
 * pipeline enforces on posts) or an http(s)/mailto link, never a third-party tracking pixel
 * or a `javascript:` href. URLs already stored pass: an agent re-sending the section with a
 * typo fixed must not be refused over an avatar the owner uploaded years ago.
 */
function unsafeUrls(next: unknown, current: unknown): string[] {
  const before = urlsIn(current)
  const after = urlsIn(next)
  return [
    ...[...after.images].filter(
      url => !before.images.has(url) && !isAllowedImageUrl(url)
    ),
    ...[...after.links].filter(
      url => !before.links.has(url) && !isSafeLink(url)
    ),
  ]
}

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
      error: `These URLs are not allowed on the profile: ${unsafe.map(url => JSON.stringify(url.slice(0, 120))).join(', ')}. Images must be uploaded to this site's Cloudinary (the owner does that in /admin/settings); links must be https, http or mailto. Nothing was changed.`,
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
