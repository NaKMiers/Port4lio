import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { answerKeyFor, CURRENT_GENERATOR_VERSION, renderTest } from '@/lib/iq/items'
import { ITEM_COUNT } from '@/lib/iq/items/config'
import { answerIndexFor, generateTest, optionsFor } from '@/lib/iq/items/v1/generate'
import { renderMatrix, renderOption } from '@/lib/iq/items/v1/render'

/**
 * Generator v1, pinned byte-for-byte.
 *
 * ```
 *   seed ──▶ generateTest ──▶ renderMatrix + optionsFor + answerIndexFor ──▶ sha256
 *                                                                             │
 *                                              any drift here rescores a taker
 * ```
 *
 * ## What this is defending
 *
 * A test in flight when a deploy lands was rendered by the generator that was live when it
 * started, and is scored by whatever is live when it is submitted. `/api/iq/submit`
 * recomputes the answer key from the stored seed, so if the generator's output for that
 * seed has moved, the taker answered one test and is graded against another. The number
 * they get looks completely plausible and means nothing.
 *
 * ## Why a hash and not a spot check
 *
 * The fragile surface is not the types and not the rendered SVG - it is the RULE PICK, per
 * rung, per attempt index. `generateItem` loops `attempt = 0..40`, builds a candidate, and
 * accepts the first that passes `verifyItem`. So a change that makes verification stricter
 * or looser anywhere - a new distinctness rule, a tightened symmetry table, a bug fix in a
 * rule nobody is touching - shifts which attempt wins, which shifts the rule, which shifts
 * the answer key. There is no local edit that "obviously cannot" reach this.
 *
 * That is also why the hash covers `answerIndexFor` and not only the markup. The markup is
 * what the taker sees; the index is what they are scored against, and it is the one that
 * has to be stable.
 *
 * ## When this test fails
 *
 * Do not update the constants to make it pass. A red run here means v1 changed, and v1
 * exists precisely so it cannot. Either revert the edit, or - if the change is genuinely
 * wanted - it belongs in a NEW generator version behind `items/index.ts`, leaving v1 alone.
 * The only legitimate reason to touch this table is deleting v1 outright, once no attempt
 * old enough to need it can still be scored (`withinTimeLimit` caps that at
 * `TEST_DURATION_SECONDS`).
 */

/** Twenty seeds, spread by a prime stride so no two share a low-order pattern. */
const GOLDEN: readonly [seed: number, sha256Prefix: string][] = [
  [13, '1d099f81329e1b1b'],
  [7730, 'a1132292244e3e3f'],
  [15447, '6b7528e49fd205b3'],
  [23164, '3ff05af4ca5fbb83'],
  [30881, '66dfc717548f264f'],
  [38598, 'd2a2c40667ed0aef'],
  [46315, 'dd348956fba412fc'],
  [54032, '61d39cd243f50b29'],
  [61749, '296eddead2e423df'],
  [69466, 'b4877bbb7d0879de'],
  [77183, 'bba62d8e7c437a89'],
  [84900, 'fac459fee62b7ae3'],
  [92617, 'fbeae87067157d07'],
  [100334, 'bc1ae4fca9d599ee'],
  [108051, '7b286c5fc318e700'],
  [115768, '617486389d42ffee'],
  [123485, 'b229c0f6f0605f27'],
  [131202, 'd5e0c0bad2dcab49'],
  [138919, '1523c9320207c98a'],
  [146636, 'ce92a879d2ccd9b8'],
]

/**
 * Exactly what `/api/iq/start` builds, plus what `/api/iq/submit` scores against.
 *
 * The label and the option `uid` are copied from `start/route.ts` deliberately rather than
 * simplified. They feed `aria-label` and the clip-path ids, so they are part of the bytes a
 * taker's browser receives - and a uid scheme change that silently cross-clipped two cells
 * would be exactly the kind of "cannot possibly matter" edit this is here to catch.
 */
function fingerprint(seed: number): string {
  const items = generateTest(seed)
  const payload = items.map((item, index) => ({
    matrix: renderMatrix(item, `${index + 1} / ${items.length}`),
    options: optionsFor(item, seed, index).map((option, optionIndex) =>
      renderOption(option, `q${index}o${optionIndex}`)
    ),
    answer: answerIndexFor(item, seed, index),
    rule: item.rule,
  }))

  return createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 16)
}

describe('generator v1', () => {
  it.each(GOLDEN)('renders seed %i unchanged', (seed, expected) => {
    expect(fingerprint(seed)).toBe(expected)
  })

  it('is deterministic within a single process', () => {
    // Cheap, and it catches the one failure the golden table cannot: state leaking between
    // calls. A module-level accumulator in a rule would still hash correctly on the first
    // call of a fresh process and drift on the second.
    for (const [seed] of GOLDEN.slice(0, 5)) {
      expect(fingerprint(seed)).toBe(fingerprint(seed))
    }
  })
})

/**
 * The facade at version 1 must BE version 1.
 *
 * The golden table above proves the v1 modules are unchanged. It says nothing about whether
 * the facade routes to them correctly - a mis-wired case would sail past it while sending
 * takers a different test than the scorer grades. These two assertions close that gap from
 * both ends: the markup a taker receives, and the key they are scored against.
 */
describe('the version facade', () => {
  it.each(GOLDEN.map(([seed]) => seed))('routes seed %i to the v1 engine', seed => {
    const items = generateTest(seed)

    expect(renderTest(seed, 1)).toEqual(
      items.map((item, index) => ({
        matrix: renderMatrix(item, `${index + 1} / ${items.length}`),
        options: optionsFor(item, seed, index).map((option, optionIndex) =>
          renderOption(option, `q${index}o${optionIndex}`)
        ),
        aspect: 1,
      }))
    )

    expect(answerKeyFor(seed, 1)).toEqual(
      items.map((item, index) => answerIndexFor(item, seed, index))
    )
  })

  it('throws on a version it has no generator for', () => {
    // Loud beats plausible. Falling back to the newest generator would score the attempt
    // against a different test and return a real-looking number, which is the entire
    // failure mode this scheme exists to prevent.
    expect(() => renderTest(13, 99)).toThrow(/no generator for version 99/)
    expect(() => answerKeyFor(13, 99)).toThrow(/no generator for version 99/)
  })

  it('stamps new attempts with a version it can actually serve', () => {
    expect(() => renderTest(13, CURRENT_GENERATOR_VERSION)).not.toThrow()
    expect(answerKeyFor(13, CURRENT_GENERATOR_VERSION)).toHaveLength(ITEM_COUNT)
  })
})
