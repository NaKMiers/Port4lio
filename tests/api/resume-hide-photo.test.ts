import mongoose, { Schema } from 'mongoose'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { cleanProfileForSave } from '@/components/settings/cleanProfileForSave'
import { compileModel } from '@/lib/mongoose-model'
import { makeEmptyProfile, normalizeProfile } from '@/lib/profile'
import { RESUME_SEED } from '@/lib/resume-seed'
import { deriveResume } from '@/lib/resume-view-model'
import { PROFILE_DOCUMENT_ID, ProfileModel } from '@/models/Profile'
import type { Profile } from '@/types/profile'

import { startMongo, stopMongo } from './setup-mongo'

/**
 * `resume.hidePhoto`, verified against a real server rather than a mocked model.
 *
 * The settings editor toggles this client-side and the sheets react to it immediately,
 * which every unit test for `CvSheets` and `resume-view-model` already covers - but none
 * of those touch Mongo, so a schema field left off `resumeSchema`, or dropped by
 * `cleanProfileForSave`'s pruning, would still show a passing suite. This exercises the
 * exact three steps `/settings` and `/cv` perform: `cleanProfileForSave` (what the browser
 * sends), `findOneAndUpdate` (what `POST /api/profile` runs), and the `.select('resume
 * avatar')` read `loadPublicResume` performs for the public route.
 */

beforeAll(async () => {
  await startMongo()
}, 120_000)

afterAll(async () => {
  await stopMongo()
})

describe('resume.hidePhoto', () => {
  it('is still true after a save/load round trip through the real API path', async () => {
    const editorProfile: Profile = {
      ...normalizeProfile(makeEmptyProfile()),
      resume: { ...RESUME_SEED, hidePhoto: true },
    }

    // What SettingEditor.onSave sends.
    const body = cleanProfileForSave(editorProfile)
    expect(body.resume?.hidePhoto).toBe(true)
    const sent = JSON.parse(JSON.stringify(body)) as Profile

    // What POST /api/profile writes.
    const now = new Date()
    await ProfileModel.findOneAndUpdate(
      { _id: PROFILE_DOCUMENT_ID },
      {
        $set: { ...sent, updatedAt: now },
        $setOnInsert: { _id: PROFILE_DOCUMENT_ID, createdAt: now },
      },
      { upsert: true, new: true, lean: true, runValidators: true }
    )

    // What loadPublicResume reads for /cv.
    const doc = await ProfileModel.findById(PROFILE_DOCUMENT_ID)
      .select('resume avatar')
      .lean()
    const raw = (doc as Record<string, unknown> | null)?.resume as Record<
      string,
      unknown
    >

    expect(raw.hidePhoto).toBe(true)
    expect(deriveResume({ resume: raw as never }).hidePhoto).toBe(true)
  })

  it('turning it back off and saving again clears it', async () => {
    const now = new Date()
    await ProfileModel.findOneAndUpdate(
      { _id: PROFILE_DOCUMENT_ID },
      {
        $set: {
          ...JSON.parse(
            JSON.stringify(
              cleanProfileForSave({
                ...normalizeProfile(makeEmptyProfile()),
                resume: { ...RESUME_SEED, hidePhoto: false },
              })
            )
          ),
          updatedAt: now,
        },
      },
      { upsert: true, new: true, lean: true, runValidators: true }
    )

    const doc = await ProfileModel.findById(PROFILE_DOCUMENT_ID)
      .select('resume')
      .lean()
    const raw = (doc as Record<string, unknown> | null)?.resume as Record<
      string,
      unknown
    >
    expect(raw.hidePhoto).toBe(false)
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
      { upsert: true, new: true, lean: true, runValidators: true }
    )

    const raw = await mongoose.connection
      .db!.collection('recompileprobes')
      .findOne({ _id: 'p' as never })
    expect((raw as unknown as { box: Record<string, unknown> }).box.b).toBe(
      true
    )
  })
})
