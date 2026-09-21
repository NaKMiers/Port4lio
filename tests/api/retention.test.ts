import mongoose from 'mongoose'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { ATTEMPT_TTL_DAYS, AttemptModel } from '@/models/Attempt'
import { IqAttemptModel } from '@/models/IqAttempt'
import { IqPaymentModel } from '@/models/IqPayment'
import { TestEventModel, testEventExpiryFrom } from '@/models/TestEvent'

import { builtIndexes, startMongo, stopMongo } from './setup-mongo'

/**
 * The retention promise, verified against a real server.
 *
 * `/[lang]/mbti/privacy` tells strangers their data is deleted after
 * `ATTEMPT_TTL_DAYS`. That promise is kept by exactly one mechanism - a Mongo TTL index -
 * and until this file existed, nothing in the repo could tell whether that index was ever
 * built. Twelve unit tests passed either way.
 *
 * These are the assertions that make the promise checkable rather than aspirational.
 */

beforeAll(async () => {
  await startMongo()
}, 120_000)

afterAll(async () => {
  await stopMongo()
})

function ttlIndexOf(indexes: Record<string, unknown>[]) {
  return indexes.find(index => {
    const key = index.key as Record<string, number> | undefined
    return key !== undefined && 'expireAt' in key
  })
}

describe('TTL retention indexes', () => {
  it('Attempt expires documents on expireAt', async () => {
    const ttl = ttlIndexOf(await builtIndexes(AttemptModel as never))

    expect(
      ttl,
      'Attempt has no TTL index - the privacy notice is not being kept'
    ).toBeDefined()
    // 0 means "delete once expireAt is in the past", not "delete 0 seconds after". A
    // missing or non-zero value here silently changes retention rather than breaking.
    expect(ttl?.expireAfterSeconds).toBe(0)
  })

  it('TestEvent expires documents on expireAt', async () => {
    const ttl = ttlIndexOf(await builtIndexes(TestEventModel as never))

    expect(
      ttl,
      'TestEvent has no TTL index - behavioural traces would be kept forever'
    ).toBeDefined()
    expect(ttl?.expireAfterSeconds).toBe(0)
  })

  it('TestEvent retention matches Attempt, so one sentence covers both', () => {
    const now = new Date('2026-09-02T00:00:00.000Z')
    const elapsedDays =
      (testEventExpiryFrom(now).getTime() - now.getTime()) / 86_400_000

    // Two different retention windows would mean the privacy notice needs two sentences,
    // and the second one is the one that goes stale.
    expect(elapsedDays).toBe(ATTEMPT_TTL_DAYS)
  })

  it('IqAttempt expires documents on expireAt', async () => {
    const ttl = ttlIndexOf(await builtIndexes(IqAttemptModel as never))

    expect(
      ttl,
      'IqAttempt has no TTL index - the IQ privacy notice is not being kept'
    ).toBeDefined()
    expect(ttl?.expireAfterSeconds).toBe(0)
  })

  it('IqPayment expires only unpaid checkouts', async () => {
    const ttl = ttlIndexOf(await builtIndexes(IqPaymentModel as never))

    // Same tiered trick as `Payment`: the index exists, and a paid row survives it by
    // carrying `expireAt: null`. An abandoned checkout holds an email and a name for a
    // purchase that never happened, so it has to go.
    expect(
      ttl,
      'IqPayment has no TTL index - abandoned checkouts would be kept forever'
    ).toBeDefined()
    expect(ttl?.expireAfterSeconds).toBe(0)
  })

  it('IqAttempt constrains certificateId with a PARTIAL, not sparse, unique index', async () => {
    const indexes = await builtIndexes(IqAttemptModel as never)
    const certificate = indexes.find(index => {
      const key = index.key as Record<string, number> | undefined
      return key?.certificateId !== undefined
    })

    expect(
      certificate,
      'IqAttempt is missing the certificateId unique index'
    ).toBeDefined()
    expect(certificate?.unique).toBe(true)

    /**
     * The distinction is load-bearing, and it cost a 500 on `/api/iq/start` to learn.
     *
     * `sparse` skips documents where the field is MISSING. The schema declares
     * `default: null`, so the field is present-and-null on every unsold attempt - and a
     * sparse unique index then reads the second `null` as a duplicate key and rejects the
     * second attempt ever created. The happy path passed; the second visitor did not.
     */
    expect(certificate?.sparse).toBeUndefined()
    expect(certificate?.partialFilterExpression).toEqual({
      certificateId: { $type: 'string' },
    })
  })

  it('TestEvent indexes the admin aggregation, not just uniqueness', async () => {
    const indexes = await builtIndexes(TestEventModel as never)
    const compound = indexes.find(index => {
      const key = index.key as Record<string, number> | undefined
      return (
        key?.product !== undefined &&
        key?.kind !== undefined &&
        key?.createdAt !== undefined
      )
    })

    // The composite `_id` makes writes idempotent but supports no grouping. Without this
    // the metrics page is a collection scan the first time there is real data.
    expect(
      compound,
      'TestEvent is missing the {product,kind,createdAt} read index'
    ).toBeDefined()
  })
})

describe('TestEvent idempotency', () => {
  it('counts one document per real-world event no matter how often it re-fires', async () => {
    const id = 'mbti:attribute:AbCd1234EfGh5678IjKl90:session-1'
    const now = new Date()

    // Three writes: StrictMode double-invoke plus a refresh. This is the exact sequence
    // that would otherwise triple the share rate - the failure that looks like success.
    for (let i = 0; i < 3; i += 1)
      await TestEventModel.findByIdAndUpdate(
        id,
        {
          $inc: { count: 1 },
          $setOnInsert: {
            product: 'mbti',
            kind: 'attribute',
            clientReported: true,
            createdAt: now,
            expireAt: testEventExpiryFrom(now),
          },
        },
        { upsert: true, lean: true }
      )

    const docs = await TestEventModel.find({ kind: 'attribute' }).lean()
    expect(docs).toHaveLength(1)
    // `count` records the re-fires as a diagnostic. Rates count documents, never this.
    expect(docs[0]?.count).toBe(3)

    await mongoose.connection.collection('testEvents').deleteMany({})
  })
})
