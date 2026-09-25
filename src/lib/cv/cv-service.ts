import 'server-only'

import { revalidateTag } from 'next/cache'

import { connectDatabase } from '@/lib/mongodb'
import { normalizeResume } from '@/lib/profile'
import { PUBLIC_PROFILE_CACHE_TAG } from '@/lib/profile-data'
import { deriveResume } from '@/lib/resume-view-model'
import { CV_LABEL_MAX, MAX_CVS } from '@/lib/upload-limits'
import { CvModel, LEGACY_CV_ID, type CvDocument } from '@/models/Cv'
import { PROFILE_DOCUMENT_ID, ProfileModel } from '@/models/Profile'
import type { CvDto, CvListDto } from '@/types/cv'
import type { Resume } from '@/types/profile'

/**
 * Every CV write, and the one read that decides which CV is live (multi-cv-plan.md).
 *
 * ```
 *   /api/admin/cvs/**  ──▶ cv-service ──▶ cvs collection
 *   (the settings CV tab)    │
 *                            ├─ ensureMigrated   first thing in listCvs AND every mutating call
 *                            │    await CvModel.init()                  indexes built before a write
 *                            │    exists({}) ──▶ done
 *                            │    upsert _id: LEGACY_CV_ID, "Main CV", deriveResume(profile),
 *                            │           publishedAt: $currentDate      (legacy block, or the seed)
 *                            │    E11000 ──▶ another request won; nothing to do
 *                            ├─ createCv         cap ──▶ 409 cap · copy of fromId's SAVED resume,
 *                            │                   publishedAt: null · labelKey taken ──▶ 409
 *                            ├─ saveCv           updatedAt still `base` (or '*') ──▶ $set
 *                            │                   miss + exists ──▶ 409 stale · miss ──▶ 404
 *                            ├─ publishCv        $currentDate publishedAt, timestamps: false
 *                            └─ deleteCv         deleteOne only if NOT the latest publish
 *                                                miss + exists ──▶ 409 published · miss ──▶ 404
 *   after saveCv / publishCv succeed: revalidateTag(PUBLIC_PROFILE_CACHE_TAG, { expire: 0 })
 *
 *   /cv, get_me, get_profile resume ──▶ readPublishedResumeSource
 *        findPublished(): publishedAt != null, sort { publishedAt: -1, _id: -1 }, first
 *        none (never migrated) ──▶ profile.resume, the legacy block (undefined ──▶ the seed)
 * ```
 *
 * ## Why "published" is the latest `publishedAt`, and publish uses `$currentDate`
 *
 * Publishing is one single-document write, so there is never a moment with zero or two
 * published CVs and no transaction is needed. `$currentDate` stamps the database's clock,
 * not whichever serverless instance handled the request, so two instances with skewed clocks
 * cannot publish out of order. Ties (same millisecond) break by `_id`, the same order every
 * reader uses, because every reader goes through `findPublished`.
 *
 * ## Why publish passes `timestamps: false`
 *
 * `updatedAt` is Save CV's stale-tab base. If Publish bumped it, the editor's very next Save
 * CV would be refused as stale by its own publish (OV-1). Publishing does not change what the
 * CV says, so it does not count as an edit.
 *
 * ## Why migration uses a fixed `_id`
 *
 * The first `GET` fires twice in dev (`reactStrictMode`), and two first loads racing is the
 * normal case, not an edge. The obvious guard - a unique `legacy` flag index - only works once
 * that index is built, and autoIndex builds it asynchronously, so the race can win before the
 * guard exists. `_id` is the one index Mongo always has. Both racers upsert the same
 * `LEGACY_CV_ID`; the loser gets E11000 and has nothing left to do (OV-2). The upsert's filter
 * requires `publishedAt` to be absent so it can never match - and so never re-publish - an
 * existing Main CV; it only ever inserts.
 *
 * ## Why public reads never migrate
 *
 * Reads do not write. Until the owner first opens the CV tab, `/cv` keeps printing
 * `profile.resume` exactly as before the deploy.
 *
 * ## Why delete is a conditional `deleteOne`
 *
 * Reading the published id and then deleting leaves a gap: a Publish of the same CV from a
 * second tab can land between them, and the just-published CV is deleted. The filter
 * "not published, or published before the current latest" is checked by Mongo at the write,
 * so a CV published in that gap is simply not matched, and the caller gets `published` (D10).
 *
 * ## Why saveCv revalidates even a CV that is not published
 *
 * Checking "is this the published one" is a read that can race a Publish the same way
 * delete can. An expired tag is one extra re-render of `/cv`; a skipped one is a stale `/cv`
 * for the whole ISR window (D10). `{ expire: 0 }` rather than `'max'`: the owner publishes and
 * then opens `/cv` to check, and stale-while-revalidate would show the old CV exactly once -
 * the trap `patchProfileSection` documents.
 */

// MARK: Results

type CvFailure = {
  ok: false
  status: number
  error: string
  /** Sent beside `error`: the conflict `code`, and `updatedAt` for a stale save. */
  extra?: Record<string, unknown>
}

export type CvResult<T> = { ok: true; value: T } | CvFailure

const failure = (
  status: number,
  error: string,
  extra?: Record<string, unknown>
): CvFailure => ({ ok: false, status, error, extra })

const success = <T>(value: T): CvResult<T> => ({ ok: true, value })

const NOT_FOUND = 'CV not found.'
const LABEL_TAKEN = 'Another CV already has this name. Pick a different one.'

/** A 24-hex ObjectId. `Types.ObjectId.isValid` also accepts any 12-character string. */
export function isCvId(id: string): boolean {
  return /^[0-9a-f]{24}$/i.test(id)
}

export function labelKeyOf(label: string): string {
  return label.trim().toLowerCase()
}

function checkLabel(raw: unknown): CvResult<string> {
  const label = typeof raw === 'string' ? raw.trim() : ''
  if (!label || label.length > CV_LABEL_MAX)
    return failure(400, `A CV name must be 1-${CV_LABEL_MAX} characters.`)
  return success(label)
}

function isDuplicateKey(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 11000
  )
}

function toDto(doc: CvDocument): CvDto {
  return {
    id: String(doc._id),
    label: doc.label,
    resume: normalizeResume(doc.resume),
    publishedAt: doc.publishedAt
      ? new Date(doc.publishedAt).toISOString()
      : null,
    updatedAt: new Date(doc.updatedAt).toISOString(),
  }
}

function expirePublicCv() {
  revalidateTag(PUBLIC_PROFILE_CACHE_TAG, { expire: 0 })
}

// MARK: Reads

/** The live CV: the greatest non-null `publishedAt`, ties by `_id`. Every reader uses this. */
export async function findPublished(): Promise<CvDocument | null> {
  await connectDatabase()
  return CvModel.findOne({ publishedAt: { $ne: null } })
    .sort({ publishedAt: -1, _id: -1 })
    .lean<CvDocument>()
}

export type PublishedResumeSource = {
  /** Absent only before migration, when the legacy block was never written - the seed then. */
  resume: Resume | undefined
  /** The portfolio avatar, which the CV photo falls back to when it is unset. */
  avatar: string
}

/**
 * What `/cv` and the site MCP print: the published CV, or before migration the legacy
 * `profile.resume`. Uncached; `profile-data.ts` wraps it for `/cv`. Never migrates.
 */
export async function readPublishedResumeSource(): Promise<PublishedResumeSource> {
  await connectDatabase()
  // `avatar` rides along on the profile read the fallback needs anyway: the CV masthead
  // inherits it whenever no CV-specific photo was uploaded.
  const [cv, profile] = await Promise.all([
    findPublished(),
    ProfileModel.findById(PROFILE_DOCUMENT_ID).select('resume avatar').lean(),
  ])
  const record = profile as Record<string, unknown> | null
  const legacy = record?.resume

  return {
    resume: cv
      ? normalizeResume(cv.resume)
      : legacy && typeof legacy === 'object'
        ? normalizeResume(legacy)
        : undefined,
    avatar: typeof record?.avatar === 'string' ? record.avatar : '',
  }
}

// MARK: Migration

/** Creates "Main CV" from the legacy block the first time the collection is empty. */
export async function ensureMigrated(): Promise<void> {
  await connectDatabase()
  await CvModel.init()
  // `exists`, not `estimatedDocumentCount`: the estimate is collection metadata, which can
  // read 0 after an unclean shutdown - and a false 0 here re-creates and PUBLISHES "Main CV"
  // from the stale legacy block over the owner's real CV. One `_id` index hit either way.
  if (await CvModel.exists({})) return

  const profile = await ProfileModel.findById(PROFILE_DOCUMENT_ID)
    .select('resume')
    .lean()
  const legacy = (profile as Record<string, unknown> | null)?.resume
  const resume = deriveResume({
    resume:
      legacy && typeof legacy === 'object'
        ? normalizeResume(legacy)
        : undefined,
  })
  const label = 'Main CV'

  try {
    await CvModel.updateOne(
      { _id: LEGACY_CV_ID, publishedAt: { $exists: false } },
      {
        $setOnInsert: { label, labelKey: labelKeyOf(label), resume },
        $currentDate: { publishedAt: true },
      },
      { upsert: true }
    )
  } catch (error) {
    // Another first load inserted it a moment ago. The collection is migrated either way.
    if (!isDuplicateKey(error)) throw error
  }
}

// MARK: Writes

export async function listCvs(): Promise<CvListDto> {
  await ensureMigrated()
  const [docs, top] = await Promise.all([
    CvModel.find().sort({ createdAt: 1, _id: 1 }).lean<CvDocument[]>(),
    findPublished(),
  ])
  return {
    cvs: docs.map(toDto),
    publishedId: top ? String(top._id) : null,
  }
}

/** A new CV, copied from the SAVED resume of `fromId` (the CV the picker had open, P1). */
export async function createCv({
  label: rawLabel,
  fromId,
}: {
  label: unknown
  fromId: unknown
}): Promise<CvResult<CvDto>> {
  const label = checkLabel(rawLabel)
  if (!label.ok) return label
  if (typeof fromId !== 'string' || !isCvId(fromId))
    return failure(404, 'The CV to copy was not found.')

  await ensureMigrated()
  if ((await CvModel.countDocuments()) >= MAX_CVS)
    return failure(
      409,
      `You already have ${MAX_CVS} CVs, the most the editor keeps. Delete a CV first.`,
      { code: 'cap' }
    )

  const source = await CvModel.findById(fromId)
    .select('resume')
    .lean<Pick<CvDocument, 'resume'>>()
  if (!source) return failure(404, 'The CV to copy was not found.')

  try {
    // Explicit fields, never a spread of the source: a copy must not inherit its `_id`,
    // its `labelKey` or - above all - its `publishedAt`, which would make it live (OV-3).
    const created = await CvModel.create({
      label: label.value,
      labelKey: labelKeyOf(label.value),
      resume: normalizeResume(source.resume),
      publishedAt: null,
    })
    return success(toDto(created.toObject()))
  } catch (error) {
    if (isDuplicateKey(error))
      return failure(409, LABEL_TAKEN, { code: 'labelTaken' })
    throw error
  }
}

/**
 * Save CV and Rename. `base` is the `updatedAt` the editor loaded, or `'*'` for "Overwrite
 * anyway" (OV-5). The answer carries the new `updatedAt`, which is the editor's next base.
 */
export async function saveCv(
  id: string,
  {
    resume,
    label: rawLabel,
    base,
  }: { resume?: unknown; label?: unknown; base: Date | '*' }
): Promise<CvResult<CvDto>> {
  if (!isCvId(id)) return failure(404, NOT_FOUND)

  const $set: Record<string, unknown> = {}
  if (resume !== undefined) {
    if (!resume || typeof resume !== 'object' || Array.isArray(resume))
      return failure(400, '`resume` must be the whole CV object.')
    $set.resume = normalizeResume(resume)
  }
  if (rawLabel !== undefined) {
    const label = checkLabel(rawLabel)
    if (!label.ok) return label
    $set.label = label.value
    $set.labelKey = labelKeyOf(label.value)
  }
  if (!Object.keys($set).length)
    return failure(400, 'Send `resume`, `label`, or both.')

  await ensureMigrated()
  let saved: CvDocument | null
  try {
    saved = await CvModel.findOneAndUpdate(
      base === '*' ? { _id: id } : { _id: id, updatedAt: base },
      { $set },
      { returnDocument: 'after', runValidators: true }
    ).lean<CvDocument>()
  } catch (error) {
    if (isDuplicateKey(error))
      return failure(409, LABEL_TAKEN, { code: 'labelTaken' })
    throw error
  }

  if (!saved) {
    const current = await CvModel.findById(id)
      .select('updatedAt')
      .lean<Pick<CvDocument, 'updatedAt'>>()
    if (!current) return failure(404, NOT_FOUND)
    return failure(
      409,
      'This CV changed since you opened it - probably in another tab. Reload to see it, or overwrite it with what you have.',
      { code: 'stale', updatedAt: current.updatedAt }
    )
  }

  expirePublicCv()
  return success(toDto(saved))
}

export async function publishCv(
  id: string
): Promise<CvResult<{ publishedId: string }>> {
  if (!isCvId(id)) return failure(404, NOT_FOUND)

  await ensureMigrated()
  const result = await CvModel.updateOne(
    { _id: id },
    { $currentDate: { publishedAt: true } },
    { timestamps: false }
  )
  if (!result.matchedCount) return failure(404, NOT_FOUND)

  expirePublicCv()
  return success({ publishedId: id })
}

/** The published CV can never be deleted (R3): publish another CV first. */
export async function deleteCv(id: string): Promise<CvResult<{ ok: true }>> {
  if (!isCvId(id)) return failure(404, NOT_FOUND)

  await ensureMigrated()
  const top = await findPublished()
  // "Not the latest publish", in exactly findPublished's order: an earlier publishedAt, or
  // the same millisecond with a lower `_id` - the loser of a tie is not the published CV.
  const result = await CvModel.deleteOne({
    _id: id,
    $or: [
      { publishedAt: null },
      ...(top?.publishedAt
        ? [
            { publishedAt: { $lt: top.publishedAt } },
            { publishedAt: top.publishedAt, _id: { $lt: top._id } },
          ]
        : []),
    ],
  })
  if (result.deletedCount) return success({ ok: true })

  if (await CvModel.exists({ _id: id }))
    return failure(
      409,
      'This is the published CV. Publish another CV first, then delete this one.',
      { code: 'published' }
    )
  return failure(404, NOT_FOUND)
}
