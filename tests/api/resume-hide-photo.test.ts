import { MongoMemoryServer } from 'mongodb-memory-server'
import mongoose, { Schema } from 'mongoose'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { pruneResumeForCv } from '@/components/settings/cleanProfileForSave'
import { listCvs, saveCv } from '@/lib/cv/cv-service'
import { compileModel } from '@/lib/mongoose-model'
import { loadPublishedResume } from '@/lib/profile-data'
import { RESUME_SEED } from '@/lib/resume-seed'
import { deriveResume } from '@/lib/resume-view-model'
import { CvModel } from '@/models/Cv'
import type { Resume } from '@/types/profile'

/**
 * `resume.hidePhoto`, verified against a real server rather than a mocked model.
 *
 * The settings editor toggles this client-side and the sheets react to it immediately,
 * which every unit test for `CvSheets` and `resume-view-model` already covers - but none
 * of those touch Mongo, so a schema field left off `resumeSchema`, or dropped by
 * `pruneResumeForCv`'s pruning, would still show a passing suite. This exercises the exact
 * three steps the settings CV tab and `/cv` perform since multi-CV: `pruneResumeForCv` (the
 * Save CV body the browser sends), `cv-service.saveCv` (what `PATCH /api/admin/cvs/<id>`
 * runs), and `loadPublishedResume`, the read `/cv` renders from.
 *
 * It used to go through `cleanProfileForSave` and `POST /api/profile`; the profile body no
 * longer carries the CV at all (multi-cv-plan.md CQ-1).
 */

vi.hoisted(() => {
  process.env.PROFILE_DOCUMENT_ID = 'resume-hide-photo-profile'
})

vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
  unstable_cache: <T>(fn: T) => fn,
}))

let memory: MongoMemoryServer
let mainId: string
let base: string

beforeAll(async () => {
  memory = await MongoMemoryServer.create()
  // `connectDatabase` (inside cv-service) reads the URI; the test connects to the same one.
  process.env.MONGODB_URI = memory.getUri()
  await mongoose.connect(memory.getUri())
  const { cvs, publishedId } = await listCvs()
  mainId = publishedId!
  base = cvs[0].updatedAt
}, 120_000)

afterAll(async () => {
  await mongoose.disconnect()
  await memory.stop()
})

/** What Save CV sends, round-tripped through JSON like the browser does. */
function saveCvBody(resume: Resume): Resume {
  const body = pruneResumeForCv(resume)
  return JSON.parse(JSON.stringify(body)) as Resume
}

describe('resume.hidePhoto', () => {
  it('is still true after a save/load round trip through the real Save CV path', async () => {
    const body = saveCvBody({ ...RESUME_SEED, hidePhoto: true })
    expect(body.hidePhoto).toBe(true)

    // What PATCH /api/admin/cvs/<id> writes.
    const saved = await saveCv(mainId, { resume: body, base: new Date(base) })
    expect(saved.ok).toBe(true)
    if (saved.ok) base = saved.value.updatedAt

    // The raw document, so a field the schema dropped cannot hide behind normalizeResume.
    const raw = await CvModel.collection.findOne({
      _id: new mongoose.Types.ObjectId(mainId),
    })
    expect((raw?.resume as Record<string, unknown>).hidePhoto).toBe(true)

    // What /cv renders.
    const { resume: stored, avatar } = await loadPublishedResume()
    expect(deriveResume({ resume: stored }, avatar).hidePhoto).toBe(true)
  })

  it('turning it back off and saving again clears it', async () => {
    const saved = await saveCv(mainId, {
      resume: saveCvBody({ ...RESUME_SEED, hidePhoto: false }),
      base: new Date(base),
    })
    expect(saved.ok).toBe(true)

    const raw = await CvModel.collection.findOne({
      _id: new mongoose.Types.ObjectId(mainId),
    })
    expect((raw?.resume as Record<string, unknown>).hidePhoto).toBe(false)
    expect((await loadPublishedResume()).resume?.hidePhoto).toBe(false)
  })
})

/**
 * The bug this file exists for was never in the save path - it was in model compilation.
 *
 * `mongoose.models.X ?? mongoose.model(...)` hands back the model compiled when the process
 * started, and Mongoose's default strict mode drops unknown paths from `$set` without
 * erroring. So a schema edit made while a dev server was running produced a 200 that wrote
 * no `hidePhoto` at all. `compileModel` is what makes the edit take effect.
 */
describe('compileModel', () => {
  it('picks up a field added to a schema after the first compile', async () => {
    const before = new Schema({
      _id: String,
      box: {
        type: new Schema({ a: String }, { _id: false }),
        default: undefined,
      },
    })
    compileModel('RecompileProbe', before)

    // Same model name, schema now one field wider - what editing a schema file does.
    const after = new Schema({
      _id: String,
      box: {
        type: new Schema({ a: String, b: Boolean }, { _id: false }),
        default: undefined,
      },
    })
    const Model = compileModel('RecompileProbe', after)

    await Model.findOneAndUpdate(
      { _id: 'p' },
      { $set: { box: { a: 'x', b: true } } },
      { upsert: true, returnDocument: 'after', lean: true, runValidators: true }
    )

    const raw = await mongoose.connection
      .db!.collection('recompileprobes')
      .findOne({ _id: 'p' as never })
    expect((raw as unknown as { box: Record<string, unknown> }).box.b).toBe(
      true
    )
  })
})
