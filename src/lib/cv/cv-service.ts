import 'server-only'

import { revalidateTag } from 'next/cache'

import { listUnsafe, unsafeUrls } from '@/lib/mcp/safe-urls'
import { connectDatabase } from '@/lib/mongodb'
import { makeEmptyResume, normalizeResume } from '@/lib/profile'
import { PUBLIC_PROFILE_CACHE_TAG } from '@/lib/profile-data'
import { deriveResume } from '@/lib/resume-view-model'
import { CV_LABEL_MAX, MAX_CV_JSON_BYTES, MAX_CVS } from '@/lib/upload-limits'
import { CvModel, LEGACY_CV_ID, type CvDocument } from '@/models/Cv'
import { PROFILE_DOCUMENT_ID, ProfileModel } from '@/models/Profile'
import type { CvDto, CvListDto } from '@/types/cv'
import type { Resume } from '@/types/profile'

/**
 * Every CV write, and the one read that decides which CV is live (multi-cv-plan.md).
 *
 * ```
 *   /api/admin/cvs/**  ──▶ cv-service ──▶ cvs collection        actor 'owner'
 *   (the settings CV tab)    │
 *   MCP tools/cv.ts    ──▶───┤                                    actor 'agent'
 *                            ├─ ensureMigrated   first thing in listCvs AND every mutating call
 *                            │    await CvModel.init()                  indexes built before a write
 *                            │    exists({}) ──▶ done
 *                            │    upsert _id: LEGACY_CV_ID, "Main CV", deriveResume(profile),
 *                            │           publishedAt: $currentDate      (legacy block, or the seed)
 *                            │    E11000 ──▶ another request won; nothing to do
 *                            ├─ createCv         cap ──▶ 409 cap · fromId's SAVED resume, or `resume`
 *                            │                   (exactly one) · publishedAt: null · labelKey taken ──▶ 409
 *                            ├─ saveCv           updatedAt still `base` (or '*') ──▶ $set
 *                            │                   miss + exists ──▶ 409 stale · miss ──▶ 404
 *                            │                   onlyIfUnpublished: the latest publish ──▶ 409 published
 *                            ├─ publishCv        $currentDate publishedAt, timestamps: false
 *                            └─ deleteCv         deleteOne only if NOT the latest publish
 *                                                miss + exists ──▶ 409 published · miss ──▶ 404
 *   after saveCv / publishCv succeed: revalidateTag(PUBLIC_PROFILE_CACHE_TAG, { expire: 0 })
 *
 *   actor, on every create and save                          (multi-cv-plan.md P2-A, IT11)
 *     owner  create, or a save with resume ──▶ fitVerified: true   the editor measures what it opens
 *            a rename (label only)         ──▶ fitVerified untouched
 *     agent  any write   ──▶ fitVerified: false   and: never '*', the whole resume or nothing,
 *                                                 new URLs through lib/mcp/safe-urls
 *
 *   list_cvs ──▶ listCvs · get_cv ──▶ getCv · create_cv / update_cv ──▶ publishedCvId
 *                                               (all three migrate, like listCvs)
 *   get_me cvs ──▶ listCvSummaries              (a read: never migrates, [] before migration)
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
 * Reads do not write. Until the owner first opens the CV tab - or an agent lists, reads or
 * writes CVs, which needs real CV ids - `/cv` keeps printing `profile.resume` exactly as
 * before the deploy. `get_me` is a summary read and does not migrate either.
 *
 * ## Why the agent rules live here and not in the tools
 *
 * The same reason revalidation does (AGENTS.md "one service per write"): a second agent
 * front door that forgot one would still succeed. `actor: 'agent'` is what turns them on -
 * `fitVerified: false`, no `'*'` overwrite, the resume replaced whole (a partial object
 * would be normalized into blanks over the rest of the CV), and the URL rule
 * `update_profile` already enforces. The one agent rule that stays in the tool is the scope
 * check, because scopes belong to the token, not to the data; the service backs it with
 * `onlyIfUnpublished`, checked at the write like delete, so a publish landing between the
 * tool's check and the write cannot let a write-only token edit the live CV.
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
const PUBLISHED =
  'This is the published CV. Publish another CV first, then delete this one.'

/** Who is writing. Decides `fitVerified` and turns the agent rules on (see the header). */
export type CvActor = 'owner' | 'agent'

const RESUME_KEYS = Object.keys(makeEmptyResume())

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

/** A resume body: an object, under the route's size cap, whole when an agent sends it. */
function checkResume(raw: unknown, actor: CvActor): CvResult<Resume> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return failure(400, '`resume` must be the whole CV object.')
  // The owner's route caps the whole body; this cap is for the agent path, which has none.
  if (Buffer.byteLength(JSON.stringify(raw)) > MAX_CV_JSON_BYTES)
    return failure(
      413,
      `This CV is over the ${MAX_CV_JSON_BYTES / 1024} KB limit.`
    )
  if (actor === 'agent') {
    const keys = Object.keys(raw)
    const unknown = keys.filter(key => !RESUME_KEYS.includes(key))
    const missing = RESUME_KEYS.filter(key => !keys.includes(key))
    if (unknown.length || missing.length)
      return failure(
        400,
        [
          `\`resume\` is replaced whole: send exactly ${RESUME_KEYS.join(', ')}, as get_cv returned them with your edits.`,
          unknown.length ? `Not in a CV: ${unknown.join(', ')}.` : '',
          missing.length ? `Missing: ${missing.join(', ')}.` : '',
        ]
          .filter(Boolean)
          .join(' ')
      )
  }
  return success(normalizeResume(raw))
}

function staleFailure(updatedAt: Date): CvFailure {
  return failure(
    409,
    'This CV changed since you opened it - in another tab, or by an agent. Reload to see it, or overwrite it with what you have.',
    { code: 'stale', updatedAt }
  )
}

/**
 * "Not the latest publish", in exactly findPublished's order: an earlier publishedAt, or
 * the same millisecond with a lower `_id` - the loser of a tie is not the published CV. A CV
 * published after `top` was read is newer than it, so it never matches either.
 */
function notLatestPublish(top: CvDocument | null) {
  return [
    { publishedAt: null },
    ...(top?.publishedAt
      ? [
          { publishedAt: { $lt: top.publishedAt } },
          { publishedAt: top.publishedAt, _id: { $lt: top._id } },
        ]
      : []),
  ]
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
    // Absent on a CV written before the field existed: migrated or editor-saved, so true.
    fitVerified: doc.fitVerified !== false,
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
        $setOnInsert: {
          label,
          labelKey: labelKeyOf(label),
          resume,
          fitVerified: true,
        },
        $currentDate: { publishedAt: true },
      },
      { upsert: true }
    )
  } catch (error) {
    // Another first load inserted it a moment ago. The collection is migrated either way.
    if (!isDuplicateKey(error)) throw error
  }
}

// MARK: Agent reads

/** The published CV's id, migrating first so an id an agent was given always exists. */
export async function publishedCvId(): Promise<string | null> {
  await ensureMigrated()
  const top = await findPublished()
  return top ? String(top._id) : null
}

/**
 * `get_cv`: one CV as STORED (`photo: ''` means "inherits the avatar"), with the avatar
 * beside it. Never `deriveResume`: a derived copy carries the avatar URL in `photo`, and an
 * agent writing it back would freeze the CV to today's avatar for good. Absent `id` is the
 * published CV.
 */
export async function getCv(
  id?: string
): Promise<CvResult<{ cv: CvDto; published: boolean; avatar: string }>> {
  if (id !== undefined && !isCvId(id)) return failure(404, NOT_FOUND)

  await ensureMigrated()
  const [top, profile] = await Promise.all([
    findPublished(),
    ProfileModel.findById(PROFILE_DOCUMENT_ID).select('avatar').lean(),
  ])
  const doc =
    id === undefined ? top : await CvModel.findById(id).lean<CvDocument>()
  if (!doc) return failure(404, NOT_FOUND)

  const avatar = (profile as Record<string, unknown> | null)?.avatar
  return success({
    cv: toDto(doc),
    published: !!top && String(top._id) === String(doc._id),
    avatar: typeof avatar === 'string' ? avatar : '',
  })
}

/** `get_me`'s `cvs`: names only, and a read - so `[]` until the collection is migrated. */
export async function listCvSummaries(): Promise<
  { id: string; label: string; published: boolean }[]
> {
  await connectDatabase()
  const [docs, top] = await Promise.all([
    CvModel.find()
      .select('label')
      .sort({ createdAt: 1, _id: 1 })
      .lean<Pick<CvDocument, '_id' | 'label'>[]>(),
    findPublished(),
  ])
  const publishedId = top ? String(top._id) : null
  return docs.map(doc => ({
    id: String(doc._id),
    label: doc.label,
    published: String(doc._id) === publishedId,
  }))
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

/**
 * A new CV, unpublished. Its content is exactly one of: a copy of the SAVED resume of
 * `fromId` (New, from the CV the picker had open, P1; `create_cv`), or `resume` (the
 * editor's Save as new CV, when the CV it was editing was deleted meanwhile, P2-D).
 */
export async function createCv({
  label: rawLabel,
  fromId,
  resume,
  actor,
}: {
  label: unknown
  fromId?: unknown
  resume?: unknown
  actor: CvActor
}): Promise<CvResult<CvDto>> {
  const label = checkLabel(rawLabel)
  if (!label.ok) return label
  if ((fromId === undefined) === (resume === undefined))
    return failure(
      400,
      'Send either `fromId` (the CV to copy) or `resume` (its content), not both.'
    )

  let content: Resume | null = null
  if (resume !== undefined) {
    const checked = checkResume(resume, actor)
    if (!checked.ok) return checked
    content = checked.value
  } else if (typeof fromId !== 'string' || !isCvId(fromId))
    return failure(404, 'The CV to copy was not found.')

  await ensureMigrated()
  if ((await CvModel.countDocuments()) >= MAX_CVS)
    return failure(
      409,
      `You already have ${MAX_CVS} CVs, the most the editor keeps. Delete a CV first.`,
      { code: 'cap' }
    )

  if (!content) {
    const source = await CvModel.findById(fromId)
      .select('resume')
      .lean<Pick<CvDocument, 'resume'>>()
    if (!source) return failure(404, 'The CV to copy was not found.')
    content = normalizeResume(source.resume)
  }

  try {
    // Explicit fields, never a spread of the source: a copy must not inherit its `_id`,
    // its `labelKey` or - above all - its `publishedAt`, which would make it live (OV-3).
    const created = await CvModel.create({
      label: label.value,
      labelKey: labelKeyOf(label.value),
      resume: content,
      publishedAt: null,
      fitVerified: actor === 'owner',
    })
    return success(toDto(created.toObject()))
  } catch (error) {
    if (isDuplicateKey(error))
      return failure(409, LABEL_TAKEN, { code: 'labelTaken' })
    throw error
  }
}

/**
 * Save CV, Rename and `update_cv`. `base` is the `updatedAt` the caller read, or `'*'` for
 * the editor's "Overwrite anyway" (OV-5; never an agent's). The answer carries the new
 * `updatedAt`, which is the caller's next base. `onlyIfUnpublished` refuses the write if
 * this CV is the published one at the moment it lands (a token without publish, P2-B).
 */
export async function saveCv(
  id: string,
  {
    resume,
    label: rawLabel,
    base,
    actor,
    onlyIfUnpublished = false,
  }: {
    resume?: unknown
    label?: unknown
    base: Date | '*'
    actor: CvActor
    onlyIfUnpublished?: boolean
  }
): Promise<CvResult<CvDto>> {
  if (!isCvId(id)) return failure(404, NOT_FOUND)
  if (actor === 'agent' && base === '*')
    return failure(400, 'An agent must send the version it read.')

  const $set: Record<string, unknown> = {}
  if (resume !== undefined) {
    const checked = checkResume(resume, actor)
    if (!checked.ok) return checked
    $set.resume = checked.value
    // Only a Save CV proves the fit: a rename leaves whatever the content had.
    if (actor === 'owner') $set.fitVerified = true
  }
  if (rawLabel !== undefined) {
    const label = checkLabel(rawLabel)
    if (!label.ok) return label
    $set.label = label.value
    $set.labelKey = labelKeyOf(label.value)
  }
  if (!Object.keys($set).length)
    return failure(400, 'Send `resume`, `label`, or both.')
  if (actor === 'agent') $set.fitVerified = false

  await ensureMigrated()
  if (actor === 'agent' && $set.resume) {
    // New URLs are judged against what THIS CV stores, read at the version the agent sent:
    // a different version is stale anyway, and saying so first keeps the refusal honest.
    const stored = await CvModel.findById(id)
      .select('resume updatedAt')
      .lean<Pick<CvDocument, 'resume' | 'updatedAt'>>()
    if (!stored) return failure(404, NOT_FOUND)
    if (base !== '*' && new Date(stored.updatedAt).getTime() !== base.getTime())
      return staleFailure(stored.updatedAt)
    const unsafe = unsafeUrls($set.resume, normalizeResume(stored.resume))
    if (unsafe.length)
      return failure(
        400,
        `These URLs are not allowed on the CV: ${listUnsafe(unsafe)}. Images must be uploaded to this site's Cloudinary (the owner does that in /admin/settings); links must be https, http or mailto.`
      )
  }

  const filter: Record<string, unknown> =
    base === '*' ? { _id: id } : { _id: id, updatedAt: base }
  if (onlyIfUnpublished) filter.$or = notLatestPublish(await findPublished())

  let saved: CvDocument | null
  try {
    saved = await CvModel.findOneAndUpdate(
      filter,
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
    const versionHeld =
      base === '*' || new Date(current.updatedAt).getTime() === base.getTime()
    // The version still matches, so the filter that missed is onlyIfUnpublished.
    if (onlyIfUnpublished && versionHeld)
      return failure(409, 'This is the published CV.', { code: 'published' })
    return staleFailure(current.updatedAt)
  }

  expirePublicCv()
  return success(toDto(saved))
}

/** `fitVerified` rides along for `publish_cv`'s warning (P2-A); the route sends only the id. */
export async function publishCv(
  id: string
): Promise<CvResult<{ publishedId: string; fitVerified: boolean }>> {
  if (!isCvId(id)) return failure(404, NOT_FOUND)

  await ensureMigrated()
  const published = await CvModel.findOneAndUpdate(
    { _id: id },
    { $currentDate: { publishedAt: true } },
    { timestamps: false, projection: { fitVerified: 1 } }
  ).lean<Pick<CvDocument, 'fitVerified'>>()
  if (!published) return failure(404, NOT_FOUND)

  expirePublicCv()
  return success({
    publishedId: id,
    fitVerified: published.fitVerified !== false,
  })
}

/** The published CV can never be deleted (R3): publish another CV first. */
export async function deleteCv(id: string): Promise<CvResult<{ ok: true }>> {
  if (!isCvId(id)) return failure(404, NOT_FOUND)

  await ensureMigrated()
  const result = await CvModel.deleteOne({
    _id: id,
    $or: notLatestPublish(await findPublished()),
  })
  if (result.deletedCount) return success({ ok: true })

  if (await CvModel.exists({ _id: id }))
    return failure(409, PUBLISHED, { code: 'published' })
  return failure(404, NOT_FOUND)
}
