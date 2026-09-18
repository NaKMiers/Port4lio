import { MongoMemoryServer } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { SubscriberModel } from '@/models/Subscriber'

/**
 * `Subscriber`, and the two invariants that make the list defensible rather than a pile of
 * addresses other people typed.
 *
 * Double opt-in and a terminal unsubscribe are both held by indexes plus a status field, so
 * both are testable here. The handlers that drive them are covered in `tests/e2e`.
 */

let memory: MongoMemoryServer

beforeAll(async () => {
  memory = await MongoMemoryServer.create()
  process.env.MONGODB_URI = memory.getUri()
  await mongoose.connect(memory.getUri())
  await SubscriberModel.syncIndexes()
}, 120_000)

afterAll(async () => {
  await mongoose.disconnect()
  await memory.stop()
})

afterEach(async () => {
  await SubscriberModel.deleteMany({})
})

describe('double opt-in', () => {
  it('starts pending, with no consent recorded', async () => {
    const row = await SubscriberModel.create({ email: 'a@b.co', token: 't1' })

    expect(row.status).toBe('pending')
    expect(row.confirmedAt, 'a pending row must carry no consent timestamp').toBeNull()
  })

  it('refuses a second row for the same address', async () => {
    // What makes `unsubscribed` terminal. Without it, a later form submission creates a
    // second pending row and starts emailing somebody who already left.
    await SubscriberModel.create({ email: 'a@b.co', token: 't1' })
    await expect(SubscriberModel.create({ email: 'a@b.co', token: 't2' })).rejects.toThrow()
  })

  it('refuses a duplicate token', async () => {
    // Confirm and unsubscribe both look a row up by token alone, so a collision would act on
    // the wrong person's subscription.
    await SubscriberModel.create({ email: 'a@b.co', token: 'shared' })
    await expect(SubscriberModel.create({ email: 'c@d.co', token: 'shared' })).rejects.toThrow()
  })

  it('builds both unique indexes', async () => {
    const indexes = (await SubscriberModel.collection.indexes()) as Record<string, unknown>[]
    const unique = indexes.filter(index => index.unique === true).map(index => JSON.stringify(index.key))

    expect(unique).toContain(JSON.stringify({ email: 1 }))
    expect(unique).toContain(JSON.stringify({ token: 1 }))
  })
})

describe('retention', () => {
  it('has NO TTL index, deliberately', async () => {
    /**
     * The `ContactMessage` reasoning, not the `PostEvent` one.
     *
     * A subscription is a standing request, not a behavioural trace. Expiring it would
     * silently unsubscribe somebody who never asked to leave - and worse, it would free the
     * unique email index, so an unsubscribed address could be re-added by any later form
     * submission and start receiving confirmation emails again.
     *
     * Asserted so nobody restores symmetry with Attempt/TestEvent/PostEvent by pattern-match.
     */
    const ttl = ((await SubscriberModel.collection.indexes()) as Record<string, unknown>[]).find(
      index => index.expireAfterSeconds !== undefined
    )

    expect(
      ttl,
      'a TTL appeared on Subscriber - it expires consent and un-sticks unsubscribes'
    ).toBeUndefined()
  })
})
