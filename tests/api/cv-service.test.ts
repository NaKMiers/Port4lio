import { MongoMemoryServer } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import {
  createCv,
  deleteCv,
  findPublished,
  listCvs,
  publishCv,
  readPublishedResumeSource,
  saveCv,
} from '@/lib/cv/cv-service'
import { makeEmptyResume } from '@/lib/profile'
import { PUBLIC_PROFILE_CACHE_TAG } from '@/lib/profile-data'
import { RESUME_SEED } from '@/lib/resume-seed'
import { MAX_CV_JSON_BYTES, MAX_CVS } from '@/lib/upload-limits'
import { CvModel, LEGACY_CV_ID } from '@/models/Cv'
import { ProfileModel } from '@/models/Profile'
import type { Resume } from '@/types/profile'

/**
 * `cv-service`, every branch, against a real mongod (multi-cv-plan.md "3. Tests").
 *
 * ```
 *   ensureMigrated  legacy block ──▶ "Main CV" · no block ──▶ the seed · non-empty ──▶ no write
 *                   two first loads at once ──▶ one CV, with no syncIndexes() first  (OV-2)
 *   createCv        copy of fromId's saved resume, publishedAt null, own labelKey    (P1, OV-3)
 *                   unknown fromId 404 · taken label 409 · cap 409                   (D6, D8)
 *   saveCv          base ok ──▶ normalized · stale ──▶ 409 · always expire 0          (OV-5, D10)
 *   publishCv       latest wins · ties by _id · never bumps updatedAt                 (OV-1, OV-3)
 *   deleteCv        published 409 · other deleted · 404 · the publish/delete race     (R3, D10)
 * ```
 *
 * `next/cache` is mocked at the framework boundary, so the assertions follow the real
 * `revalidateTag` call the service makes rather than a mock of the service.
 */

const DOC_ID = 'cv-service-profile'

vi.hoisted(() => {
  process.env.PROFILE_DOCUMENT_ID = 'cv-service-profile'
})

const cache = vi.hoisted(() => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
}))
vi.mock('next/cache', () => ({
  revalidateTag: cache.revalidateTag,
  revalidatePath: cache.revalidatePath,
  unstable_cache: <T>(fn: T) => fn,
}))

let memory: MongoMemoryServer

beforeAll(async () => {
  memory = await MongoMemoryServer.create()
  process.env.MONGODB_URI = memory.getUri()
  await mongoose.connect(memory.getUri())
}, 120_000)

afterAll(async () => {
  await mongoose.disconnect()
  await memory.stop()
})

afterEach(async () => {
  vi.clearAllMocks()
  await CvModel.deleteMany({})
  await ProfileModel.deleteMany({})
})

const legacyResume = (): Resume => ({
  ...makeEmptyResume(),
  name: 'Legacy Name',
  role: 'Legacy Role',
})

const resumeNamed = (name: string): Resume => ({
  ...makeEmptyResume(),
  name,
})

/** A migrated collection, returning the Main CV's id and its updatedAt base. */
async function migrated() {
  const { cvs, publishedId } = await listCvs()
  return { main: cvs[0], publishedId }
}

async function created(label: string, fromId = String(LEGACY_CV_ID)) {
  const result = await createCv({ label, fromId })
  if (!result.ok) throw new Error(result.error)
  return result.value
}

describe('ensureMigrated (via listCvs)', () => {
  it('copies the legacy profile.resume into a published "Main CV" and leaves the profile alone', async () => {
    await ProfileModel.create({ _id: DOC_ID, resume: legacyResume() })

    const { cvs, publishedId } = await listCvs()

    expect(cvs).toHaveLength(1)
    expect(cvs[0].id).toBe(String(LEGACY_CV_ID))
    expect(cvs[0].label).toBe('Main CV')
    expect(cvs[0].resume.name).toBe('Legacy Name')
    expect(cvs[0].publishedAt).not.toBeNull()
    expect(publishedId).toBe(String(LEGACY_CV_ID))

    const profile = await ProfileModel.findById(DOC_ID).lean()
    expect((profile?.resume as Resume | undefined)?.name).toBe('Legacy Name')
  })

  it('with no legacy block, the Main CV is the seed /cv printed', async () => {
    await ProfileModel.create({ _id: DOC_ID, fullName: 'Ada' })

    const { cvs } = await listCvs()

    expect(cvs).toHaveLength(1)
    expect(cvs[0].resume).toEqual(RESUME_SEED)
  })

  it('does not write when the collection already has a CV', async () => {
    await CvModel.create({
      label: 'Existing',
      labelKey: 'existing',
      resume: resumeNamed('Existing'),
      publishedAt: new Date(),
    })

    const { cvs } = await listCvs()

    expect(cvs.map(cv => cv.label)).toEqual(['Existing'])
    expect(await CvModel.exists({ _id: LEGACY_CV_ID })).toBeNull()
  })

  it('two concurrent first loads create exactly one CV, with no syncIndexes() first', async () => {
    // Fresh collection, indexes dropped: the race the fixed _id exists for (OV-2).
    await CvModel.collection.drop().catch(() => undefined)
    await ProfileModel.create({ _id: DOC_ID, resume: legacyResume() })

    try {
      const [a, b, c] = await Promise.all([listCvs(), listCvs(), listCvs()])

      expect(await CvModel.countDocuments()).toBe(1)
      for (const result of [a, b, c]) {
        expect(result.cvs).toHaveLength(1)
        expect(result.publishedId).toBe(String(LEGACY_CV_ID))
      }
    } finally {
      // `CvModel.init()` runs once per model, so the dropped indexes would stay dropped for
      // every later test in this file. Production never drops them; restore them here.
      await CvModel.syncIndexes()
    }
  })

  it('a POST before any GET migrates first, and /cv never prints the unpublished copy (OV-3)', async () => {
    await ProfileModel.create({ _id: DOC_ID, resume: legacyResume() })

    const copy = await created('Before any GET')
    expect(copy.publishedAt).toBeNull()

    const source = await readPublishedResumeSource()
    expect(source.resume?.name).toBe('Legacy Name')
    expect((await findPublished())?._id.equals(LEGACY_CV_ID)).toBe(true)
  })
})

describe('readPublishedResumeSource (the /cv and MCP resolver)', () => {
  it('never migrates, and falls back to the legacy block', async () => {
    await ProfileModel.create({
      _id: DOC_ID,
      avatar: 'https://example.com/me.png',
      resume: legacyResume(),
    })

    const source = await readPublishedResumeSource()

    expect(source.resume?.name).toBe('Legacy Name')
    expect(source.avatar).toBe('https://example.com/me.png')
    expect(await CvModel.countDocuments()).toBe(0)
  })

  it('with nothing at all, resume is undefined so deriveResume prints the seed', async () => {
    expect((await readPublishedResumeSource()).resume).toBeUndefined()
  })

  it('the published CV wins over the legacy block', async () => {
    await ProfileModel.create({ _id: DOC_ID, resume: legacyResume() })
    await migrated()
    const other = await created('Frontend')
    const base = other.updatedAt
    await saveCv(other.id, {
      resume: resumeNamed('Frontend Name'),
      base: new Date(base),
    })
    await publishCv(other.id)

    expect((await readPublishedResumeSource()).resume?.name).toBe(
      'Frontend Name'
    )
  })
})

describe('createCv', () => {
  it('copies the SAVED resume of fromId, unpublished, with its own labelKey', async () => {
    await ProfileModel.create({ _id: DOC_ID, resume: legacyResume() })
    await migrated()

    const copy = await created('  Frontend CV  ')

    expect(copy.label).toBe('Frontend CV')
    expect(copy.resume.name).toBe('Legacy Name')
    expect(copy.publishedAt).toBeNull()
    expect(copy.id).not.toBe(String(LEGACY_CV_ID))
    const stored = await CvModel.findById(copy.id).lean()
    expect(stored?.labelKey).toBe('frontend cv')
    expect(stored?.publishedAt).toBeNull()
  })

  it('unknown or malformed fromId is 404', async () => {
    await migrated()
    const unknown = await createCv({
      label: 'X',
      fromId: new mongoose.Types.ObjectId().toHexString(),
    })
    expect(unknown).toMatchObject({ ok: false, status: 404 })
    const malformed = await createCv({ label: 'X', fromId: 'nope' })
    expect(malformed).toMatchObject({ ok: false, status: 404 })
  })

  it('a label taken ignoring case is 409 labelTaken', async () => {
    await migrated()
    await created('Frontend')

    const dup = await createCv({
      label: 'FRONTEND ',
      fromId: String(LEGACY_CV_ID),
    })

    expect(dup).toMatchObject({
      ok: false,
      status: 409,
      extra: { code: 'labelTaken' },
    })
  })

  it('an empty or over-60 label is 400', async () => {
    await migrated()
    for (const label of ['   ', 'x'.repeat(61), 42])
      expect(
        await createCv({ label, fromId: String(LEGACY_CV_ID) })
      ).toMatchObject({ ok: false, status: 400 })
  })

  it(`stops at MAX_CVS (${MAX_CVS}) with 409 cap`, async () => {
    await migrated()
    for (let i = 1; i < MAX_CVS; i += 1) await created(`CV ${i}`)
    expect(await CvModel.countDocuments()).toBe(MAX_CVS)

    const over = await createCv({
      label: 'One too many',
      fromId: String(LEGACY_CV_ID),
    })

    expect(over).toMatchObject({
      ok: false,
      status: 409,
      extra: { code: 'cap' },
    })
    expect(await CvModel.countDocuments()).toBe(MAX_CVS)
  })

  it('the bounds are the ones D8 approved', () => {
    expect(MAX_CVS).toBe(20)
    expect(MAX_CV_JSON_BYTES).toBe(256 * 1024)
  })
})

describe('saveCv', () => {
  it('saves when base matches, normalizes the resume, and returns the new base', async () => {
    const { main } = await migrated()

    const result = await saveCv(main.id, {
      resume: { name: 'Only a name' },
      base: new Date(main.updatedAt),
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.resume).toEqual({
      ...makeEmptyResume(),
      name: 'Only a name',
    })
    expect(result.value.updatedAt).not.toBe(main.updatedAt)

    const again = await saveCv(main.id, {
      resume: resumeNamed('Second save'),
      base: new Date(result.value.updatedAt),
    })
    expect(again.ok).toBe(true)
  })

  it('a stale base is 409 stale with the current updatedAt, and writes nothing', async () => {
    const { main } = await migrated()
    const first = await saveCv(main.id, {
      resume: resumeNamed('Other tab'),
      base: new Date(main.updatedAt),
    })
    if (!first.ok) throw new Error(first.error)

    const stale = await saveCv(main.id, {
      resume: resumeNamed('This tab'),
      base: new Date(main.updatedAt),
    })

    expect(stale).toMatchObject({
      ok: false,
      status: 409,
      extra: { code: 'stale' },
    })
    if (stale.ok) return
    expect(new Date(stale.extra!.updatedAt as Date).toISOString()).toBe(
      first.value.updatedAt
    )
    expect((await CvModel.findById(main.id).lean())?.resume.name).toBe(
      'Other tab'
    )
  })

  it("base '*' overwrites whatever is stored", async () => {
    const { main } = await migrated()
    await saveCv(main.id, {
      resume: resumeNamed('Other tab'),
      base: new Date(main.updatedAt),
    })

    const overwrite = await saveCv(main.id, {
      resume: resumeNamed('Owner wins'),
      base: '*',
    })

    expect(overwrite.ok).toBe(true)
    expect((await CvModel.findById(main.id).lean())?.resume.name).toBe(
      'Owner wins'
    )
  })

  it('unknown id is 404; a null resume is 400; an empty body is 400', async () => {
    const { main } = await migrated()
    expect(
      await saveCv(new mongoose.Types.ObjectId().toHexString(), {
        resume: resumeNamed('x'),
        base: '*',
      })
    ).toMatchObject({ ok: false, status: 404 })
    expect(await saveCv(main.id, { resume: null, base: '*' })).toMatchObject({
      ok: false,
      status: 400,
    })
    expect(await saveCv(main.id, { base: '*' })).toMatchObject({
      ok: false,
      status: 400,
    })
  })

  it('rename to a label taken ignoring case is 409 labelTaken', async () => {
    const { main } = await migrated()
    await created('Frontend')

    const clash = await saveCv(main.id, { label: 'frontend', base: '*' })

    expect(clash).toMatchObject({
      ok: false,
      status: 409,
      extra: { code: 'labelTaken' },
    })
  })

  it('rename sets label and labelKey and leaves the resume alone', async () => {
    const { main } = await migrated()

    const renamed = await saveCv(main.id, {
      label: 'Backend',
      base: new Date(main.updatedAt),
    })

    expect(renamed.ok).toBe(true)
    const stored = await CvModel.findById(main.id).lean()
    expect(stored?.label).toBe('Backend')
    expect(stored?.labelKey).toBe('backend')
    expect(stored?.resume.name).toBe(RESUME_SEED.name)
  })

  it('always expires the public tag with { expire: 0 }, published or not (D10)', async () => {
    const { main } = await migrated()
    const other = await created('Not published')
    vi.clearAllMocks()

    await saveCv(other.id, { resume: resumeNamed('x'), base: '*' })
    expect(cache.revalidateTag).toHaveBeenCalledWith(PUBLIC_PROFILE_CACHE_TAG, {
      expire: 0,
    })

    vi.clearAllMocks()
    await saveCv(main.id, { resume: resumeNamed('y'), base: '*' })
    expect(cache.revalidateTag).toHaveBeenCalledWith(PUBLIC_PROFILE_CACHE_TAG, {
      expire: 0,
    })
  })

  it('a refused save does not revalidate', async () => {
    const { main } = await migrated()
    vi.clearAllMocks()
    await saveCv(main.id, {
      resume: resumeNamed('x'),
      base: new Date('2000-01-01'),
    })
    expect(cache.revalidateTag).not.toHaveBeenCalled()
  })
})

describe('publishCv', () => {
  it('makes the CV the latest publish and expires the public tag', async () => {
    await migrated()
    const other = await created('Frontend')
    vi.clearAllMocks()

    const result = await publishCv(other.id)

    expect(result).toEqual({ ok: true, value: { publishedId: other.id } })
    expect((await listCvs()).publishedId).toBe(other.id)
    expect(cache.revalidateTag).toHaveBeenCalledWith(PUBLIC_PROFILE_CACHE_TAG, {
      expire: 0,
    })
  })

  it('publish then save succeeds: publishing never bumps updatedAt (OV-1)', async () => {
    const { main } = await migrated()
    const other = await created('Frontend')

    await publishCv(other.id)
    await publishCv(main.id)

    const stored = await CvModel.findById(main.id).lean()
    expect(stored?.updatedAt.toISOString()).toBe(main.updatedAt)
    const saved = await saveCv(main.id, {
      resume: resumeNamed('After publish'),
      base: new Date(main.updatedAt),
    })
    expect(saved.ok).toBe(true)
  })

  it('unknown or malformed id is 404 and does not revalidate', async () => {
    await migrated()
    vi.clearAllMocks()
    expect(
      await publishCv(new mongoose.Types.ObjectId().toHexString())
    ).toMatchObject({ ok: false, status: 404 })
    expect(await publishCv('nope')).toMatchObject({ ok: false, status: 404 })
    expect(cache.revalidateTag).not.toHaveBeenCalled()
  })

  it('a same-millisecond tie resolves by _id, the same for every reader (OV-3)', async () => {
    const at = new Date('2026-09-25T10:00:00.000Z')
    const [low, high] = [
      new mongoose.Types.ObjectId('100000000000000000000000'),
      new mongoose.Types.ObjectId('200000000000000000000000'),
    ]
    await CvModel.create([
      {
        _id: high,
        label: 'High',
        labelKey: 'high',
        resume: resumeNamed('High'),
        publishedAt: at,
      },
      {
        _id: low,
        label: 'Low',
        labelKey: 'low',
        resume: resumeNamed('Low'),
        publishedAt: at,
      },
    ])

    expect((await findPublished())?._id.equals(high)).toBe(true)
    expect((await listCvs()).publishedId).toBe(String(high))
    expect((await readPublishedResumeSource()).resume?.name).toBe('High')

    // Delete agrees with the same order: the tie's winner is refused, its loser can go.
    expect(await deleteCv(String(high))).toMatchObject({
      ok: false,
      status: 409,
      extra: { code: 'published' },
    })
    expect(await deleteCv(String(low))).toEqual({
      ok: true,
      value: { ok: true },
    })
  })
})

describe('deleteCv', () => {
  it('refuses the published CV with 409 published', async () => {
    const { main } = await migrated()

    expect(await deleteCv(main.id)).toMatchObject({
      ok: false,
      status: 409,
      extra: { code: 'published' },
    })
    expect(await CvModel.exists({ _id: main.id })).not.toBeNull()
  })

  it('deletes a CV that is not published, including a previously published one', async () => {
    const { main } = await migrated()
    const never = await created('Never published')
    const next = await created('Next')
    await publishCv(next.id)

    expect(await deleteCv(never.id)).toEqual({ ok: true, value: { ok: true } })
    // Main CV was published once; it is no longer the latest, so it can go.
    expect(await deleteCv(main.id)).toEqual({ ok: true, value: { ok: true } })
    expect((await listCvs()).cvs.map(cv => cv.id)).toEqual([next.id])
  })

  it('unknown or malformed id is 404', async () => {
    await migrated()
    expect(
      await deleteCv(new mongoose.Types.ObjectId().toHexString())
    ).toMatchObject({ ok: false, status: 404 })
    expect(await deleteCv('nope')).toMatchObject({ ok: false, status: 404 })
  })

  it('a publish landing between the published read and the delete is refused, not deleted (D10)', async () => {
    await migrated()
    const target = await created('Being published elsewhere')

    // The second tab's Publish lands after deleteCv read the latest publish and before its
    // deleteOne runs - exactly the gap a read-then-delete would lose the CV in.
    const realDeleteOne = CvModel.deleteOne.bind(CvModel)
    vi.spyOn(CvModel, 'deleteOne').mockImplementationOnce(((
      filter: Parameters<typeof CvModel.deleteOne>[0]
    ) =>
      (async () => {
        await CvModel.updateOne(
          { _id: target.id },
          { $currentDate: { publishedAt: true } },
          { timestamps: false }
        )
        return realDeleteOne(filter)
      })()) as never)

    expect(await deleteCv(target.id)).toMatchObject({
      ok: false,
      status: 409,
      extra: { code: 'published' },
    })
    expect(await CvModel.exists({ _id: target.id })).not.toBeNull()
    expect((await listCvs()).publishedId).toBe(target.id)
  })
})
