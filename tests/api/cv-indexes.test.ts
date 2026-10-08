import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { CvModel } from '@/models/Cv'

import { builtIndexes, startMongo, stopMongo } from './setup-mongo'

/**
 * The two `cvs` indexes, verified as BUILT on a real server, not merely declared
 * (pattern: `retention.test.ts`).
 *
 * ```
 *   labelKey  unique          what makes labels unique ignoring case (D6); a missing index
 *                             lets two "Frontend" CVs in with every request returning 201
 *   { publishedAt: -1, _id: -1 }   serves findPublished, the read every /cv render makes
 * ```
 */

beforeAll(async () => {
  await startMongo()
}, 120_000)

afterAll(async () => {
  await stopMongo()
})

function indexOn(
  indexes: Record<string, unknown>[],
  key: Record<string, number>
) {
  return indexes.find(
    index => JSON.stringify(index.key) === JSON.stringify(key)
  )
}

describe('cvs indexes', () => {
  it('labelKey is a unique index', async () => {
    const index = indexOn(await builtIndexes(CvModel as never), {
      labelKey: 1,
    })

    expect(index, 'no labelKey index - CV labels are not unique').toBeDefined()
    expect(index?.unique).toBe(true)
  })

  it('findPublished has its { publishedAt: -1, _id: -1 } index', async () => {
    const index = indexOn(await builtIndexes(CvModel as never), {
      publishedAt: -1,
      _id: -1,
    })

    expect(index).toBeDefined()
  })

  it('the model points at the cvs collection', () => {
    expect(CvModel.collection.collectionName).toBe('cvs')
  })
})
