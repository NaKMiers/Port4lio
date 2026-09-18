import { MongoMemoryServer } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { aggregatePostMetrics, recordPostEvent } from '@/lib/blog/post-events'
import { ATTEMPT_TTL_DAYS } from '@/models/Attempt'
import { BLOG_EVENT_TTL_DAYS, PostEventModel, postEventExpiryFrom } from '@/models/PostEvent'
import { testEventExpiryFrom } from '@/models/TestEvent'

/**
 * `PostEvent`, and the counting rule that makes its numbers mean anything.
 *
 * The rule is inherited from `TestEvent` and is the kind of thing that reads like a missed
 * optimisation to whoever touches the aggregation next: `count` exists, it is a number, and
 * summing it is one character shorter than counting documents. Doing so would report one
 * reader who refreshed five times as five readers.
 */

let memory: MongoMemoryServer

beforeAll(async () => {
  memory = await MongoMemoryServer.create()
  // `recordPostEvent` calls `connectDatabase()` itself, exactly as it does in production, so
  // the env var has to be set rather than the connection opened behind its back.
  process.env.MONGODB_URI = memory.getUri()
  await mongoose.connect(memory.getUri())
  await PostEventModel.syncIndexes()
}, 120_000)

afterAll(async () => {
  await mongoose.disconnect()
  await memory.stop()
})

afterEach(async () => {
  await PostEventModel.deleteMany({})
})

describe('the counting rule', () => {
  it('a repeat view updates ONE document rather than adding a second', async () => {
    // Idempotence by construction: the subject is in the `_id`, so duplicates are
    // arithmetically impossible rather than filtered out by a query somebody has to write.
    for (let i = 0; i < 5; i += 1) {
      await recordPostEvent({ kind: 'view', slug: 'a-post', subject: 'a-post:session-1' })
    }

    expect(await PostEventModel.countDocuments({})).toBe(1)
    const row = await PostEventModel.findById('blog:view:a-post:session-1').lean()
    expect(row?.count, 'count should record the re-fires as a diagnostic').toBe(5)
  })

  it('counts DOCUMENTS, not the sum of count - one refresher is not five readers', async () => {
    for (let i = 0; i < 5; i += 1) {
      await recordPostEvent({ kind: 'view', slug: 'a-post', subject: 'a-post:session-1' })
    }
    await recordPostEvent({ kind: 'view', slug: 'a-post', subject: 'a-post:session-2' })

    const metrics = await aggregatePostMetrics()
    expect(
      metrics.get('a-post')?.views,
      'the aggregation summed $count - one reader refreshing now reads as five'
    ).toBe(2)
  })

  it('keeps the three kinds apart', async () => {
    await recordPostEvent({ kind: 'view', slug: 'p', subject: 'p:s1' })
    await recordPostEvent({ kind: 'share', slug: 'p', subject: 'token-1' })
    await recordPostEvent({ kind: 'attribute', slug: 'p', subject: 'token-1:s2' })
    await recordPostEvent({ kind: 'attribute', slug: 'p', subject: 'token-1:s3' })

    const metrics = await aggregatePostMetrics()
    expect(metrics.get('p')).toEqual({ slug: 'p', views: 1, shares: 1, attributions: 2 })
  })

  it('does not move createdAt or expireAt on a re-fire', async () => {
    // A popular post must not have its retention window extended indefinitely by being
    // popular, and "when did this start being read" must not decay into "when was it last
    // read".
    await recordPostEvent({ kind: 'view', slug: 'p', subject: 'p:s1' })
    const first = await PostEventModel.findById('blog:view:p:s1').lean()

    await new Promise(resolve => setTimeout(resolve, 15))
    await recordPostEvent({ kind: 'view', slug: 'p', subject: 'p:s1' })
    const second = await PostEventModel.findById('blog:view:p:s1').lean()

    expect(second?.createdAt).toEqual(first?.createdAt)
    expect(second?.expireAt).toEqual(first?.expireAt)
  })
})

describe('retention', () => {
  it('is 180 days, deliberately NOT the 21 TestEvent uses', async () => {
    expect(BLOG_EVENT_TTL_DAYS).toBe(180)

    const now = new Date('2026-01-01T00:00:00.000Z')
    const days = (postEventExpiryFrom(now).getTime() - now.getTime()) / 86_400_000
    expect(days).toBe(180)

    // The whole reason this is a second collection (D4). A test result is a behavioural trace
    // that must not outlive the result it describes; the blog's question - did writing
    // anything change anything - is asked over months.
    const testEventDays = (testEventExpiryFrom(now).getTime() - now.getTime()) / 86_400_000
    expect(testEventDays).toBe(ATTEMPT_TTL_DAYS)
    expect(days).not.toBe(testEventDays)
  })

  it('builds the TTL index, because a failed build is silent', async () => {
    const indexes = (await PostEventModel.collection.indexes()) as Record<string, unknown>[]
    const ttl = indexes.find(index => index.expireAfterSeconds !== undefined)

    expect(
      ttl,
      'PostEvent has no TTL index - a browsing trace of every reader would be kept forever while /blog/privacy says 180 days'
    ).toBeDefined()
    expect(ttl?.expireAfterSeconds).toBe(0)
  })

  it('indexes the aggregation the board actually runs', async () => {
    const keys = ((await PostEventModel.collection.indexes()) as Record<string, unknown>[]).map(
      index => JSON.stringify(index.key)
    )
    expect(keys).toContain(JSON.stringify({ slug: 1, kind: 1, createdAt: -1 }))
  })
})

describe('fire-and-forget', () => {
  it('never throws, even with the connection closed', async () => {
    // The doctrine from `test-events.ts`: these rows are worth nothing next to the page they
    // instrument. A Mongo blip must never blank a post somebody arrived at from a cross-post.
    const uri = process.env.MONGODB_URI
    process.env.MONGODB_URI = ''
    await mongoose.disconnect()

    await expect(
      recordPostEvent({ kind: 'view', slug: 'p', subject: 'p:s1' })
    ).resolves.toBeUndefined()

    process.env.MONGODB_URI = uri
    await mongoose.connect(uri as string)
  })
})
