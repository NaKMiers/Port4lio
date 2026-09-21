import { MongoMemoryServer } from 'mongodb-memory-server'
import mongoose from 'mongoose'

/**
 * A real MongoDB, for tests that need one.
 *
 * ```
 *   startMongo() ──▶ boots mongod ──▶ mongoose.connect ──▶ syncIndexes()
 *                                                              │
 *                                              the thing under test: did the
 *                                              index actually get BUILT, not
 *                                              merely declared in a schema?
 * ```
 *
 * Every other test in this repo mocks Mongoose - `payos-fulfil.test.ts` says so in its own
 * header, and it is right to: "does Mongo work" is not what those tests are about. But that
 * left one thing unverifiable. A TTL index that fails to build is silent, every existing
 * test still passes, and the only symptom is that stranger data is retained forever while
 * `/[lang]/mbti/privacy` promises deletion.
 *
 * `Attempt` has an `on('index')` listener meant to catch that, and it does not fire on the
 * failure that matters - a schema pointed at the wrong collection builds its indexes
 * *successfully*, just not where anyone is reading. The only way to know is to ask a live
 * server what indexes exist. Hence a real mongod, in-memory, torn down after.
 */

let memory: MongoMemoryServer | null = null

export async function startMongo(): Promise<void> {
  memory = await MongoMemoryServer.create()
  await mongoose.connect(memory.getUri(), { dbName: 'port4lio-test' })
}

export async function stopMongo(): Promise<void> {
  await mongoose.disconnect()
  await memory?.stop()
  memory = null
}

/**
 * Build the indexes a model declares, then read back what the server actually has.
 *
 * `syncIndexes()` rather than waiting on `init()`: it is synchronous-to-await and it fails
 * loudly, which is the whole point here. Returns the raw index list so a test can assert on
 * `expireAfterSeconds` rather than on Mongoose's in-memory idea of the schema.
 */
export async function builtIndexes(
  model: mongoose.Model<never>
): Promise<Record<string, unknown>[]> {
  await model.syncIndexes()
  return model.collection.indexes() as Promise<Record<string, unknown>[]>
}
