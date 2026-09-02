import { describe, expect, it } from 'vitest'

import { LOCALES } from '@/lib/i18n'
import { rng } from '@/lib/iq/items/random'
import { IQ_LANDING_SECTIONS } from '@/lib/iq/content'
import { cellKey } from '@/lib/iq/items/v2/cell'
import { answerIndexFor, generateTest, optionsFor } from '@/lib/iq/items/v2/generate'
import { canFill, LADDER, MAX_PER_FAMILY } from '@/lib/iq/items/v2/ladder'
import { FAMILY_WEIGHTS, RULES, RULES_BY_NAME } from '@/lib/iq/items/v2/rules'
import { verifyItem } from '@/lib/iq/items/v2/verify'

/**
 * The vocabulary, measured rather than described.
 *
 * Every assertion here exists because v1 shipped without it. v1's tests proved that each
 * family COULD generate and that options were structurally distinct, and both were true while
 * three of its six families had 3, 5 and 24 distinct outputs respectively, one always answered
 * with a triangle, and 13 of 20 rotation parameter pairs were dead. Nothing was red.
 */

const SEEDS = Array.from({ length: 40 }, (_, i) => i * 5077 + 11)

describe('the published rule list', () => {
  it('names exactly as many rules as the test implements', () => {
    /**
     * The honesty guard for `/iq/method`.
     *
     * The page promises that the missing cell is always determined by at least one rule on
     * its list. An entry with no family behind it is a rule the test does not contain; a
     * family with no entry is a rule the taker was never warned about. Both break the promise,
     * and neither is visible without loading the page in both languages.
     *
     * This was not hypothetical: after the rebuild the list still said "the six rules" and
     * still named set logic, which had not been ported yet.
     */
    for (const locale of LOCALES) {
      expect(IQ_LANDING_SECTIONS[locale].rules, `${locale} rule list`).toHaveLength(RULES.length)
    }
  })

  it('describes every rule in both locales', () => {
    for (const locale of LOCALES) {
      for (const rule of IQ_LANDING_SECTIONS[locale].rules) {
        expect(rule.name.length, `${locale} name`).toBeGreaterThan(0)
        expect(rule.body.length, `${locale} body`).toBeGreaterThan(40)
      }
    }
  })

  it('publishes the direction invariant, which the sequence items depend on', () => {
    /**
     * Not documentation. Three cells reading outline, half, filled are consistent with the
     * cycle continuing AND with a palindrome turning back, so without a published promise
     * that a series never reverses, two of the six options are defensible and one is marked
     * wrong. `cellKey` cannot see it - the options are genuinely different pictures.
     */
    expect(IQ_LANDING_SECTIONS.en.rulesLead.toLowerCase()).toMatch(/same direction/)
    expect(IQ_LANDING_SECTIONS.vi.rulesLead.toLowerCase()).toMatch(/cùng một chiều/)
  })

  it('no longer claims every question is a 3x3 matrix', () => {
    // Nine of the 26 are sequences and one is a 2x2.
    expect(IQ_LANDING_SECTIONS.en.rulesLead).not.toMatch(/Each question is a 3x3/)
    expect(IQ_LANDING_SECTIONS.vi.rulesLead).not.toMatch(/Mỗi câu là một ma trận 3x3/)
  })
})

describe('rung coverage', () => {
  it('every family can actually build every rung it claims it can fill', () => {
    /**
     * The test v1 most needed and did not have.
     *
     * v1 asserted that each family generated SOMEWHERE across a seed sweep, which is exactly
     * what let three families ship one variant each: they were eligible everywhere, failed
     * almost everywhere, and the generator quietly substituted a different rule. A capability
     * claim that the family cannot honour is a lie the planner then builds on.
     */
    const shortfalls: string[] = []

    for (const rule of RULES) {
      const claimed = LADDER.filter(profile => canFill(rule.capabilities, profile))
      let delivered = 0

      for (const profile of claimed) {
        let built = false
        let reason = 'build returned null every time'
        for (let attempt = 0; attempt < 24 && !built; attempt += 1) {
          // A different stream per attempt, so this measures the family rather than one
          // lucky corner of the PRNG.
          const candidate = rule.build(rng(profile.rung * 104729 + attempt * 31337 + 17), profile)
          if (!candidate) continue
          const verdict = verifyItem(candidate, profile)
          if (verdict.ok) built = true
          else reason = verdict.reason
        }
        if (built) delivered += 1
        else shortfalls.push(`${rule.name} @ rung ${profile.rung}: ${reason}`)
      }

      /**
       * A high threshold rather than every single rung, and the distinction is deliberate.
       *
       * Whether a family can fill one specific rung depends on interactions this design cannot
       * express in a capability record - whether a base shape happens to be a circle (whose
       * rotation is invisible), whether a growing shape would swallow a corner marker, how
       * many distinct pictures a three-value dimension can supply for a six-option panel.
       * Several of those were found and fixed by this test; the residue is a long tail.
       *
       * What matters for a taker is covered elsewhere and absolutely: `generateTest` never
       * fails, every shipped item verifies, and no family dominates. This asserts the weaker
       * but still valuable property that a capability claim is broadly honest - v1's families
       * would have scored near zero here, because they were eligible everywhere and generated
       * almost nowhere.
       */
      expect(
        delivered / claimed.length,
        `${rule.name} delivers ${delivered}/${claimed.length} of its claimed rungs`
      ).toBeGreaterThanOrEqual(0.85)
    }

    // Printed, not swallowed: a growing tail should be visible even while the test is green.
    if (shortfalls.length) console.info(`rung coverage shortfalls:\n  ${shortfalls.join('\n  ')}`)
  })
})

describe('generated tests', () => {
  const tests = SEEDS.map(seed => ({ seed, items: generateTest(seed) }))

  it('produces 26 verified items for every seed', () => {
    for (const { seed, items } of tests) {
      expect(items, `seed ${seed}`).toHaveLength(LADDER.length)
      for (const item of items) {
        const verdict = verifyItem(item, item.profile)
        expect(verdict.ok, `seed ${seed} rung ${item.rung} (${item.rule}): ${!verdict.ok && verdict.reason}`).toBe(true)
      }
    }
  })

  it('always places the answer among exactly six distinct options', () => {
    for (const { seed, items } of tests) {
      items.forEach((item, index) => {
        const options = optionsFor(item, seed, index)
        expect(options, `seed ${seed} item ${index}`).toHaveLength(6)
        expect(new Set(options.map(cellKey)).size, `seed ${seed} item ${index}`).toBe(6)

        const answerIndex = answerIndexFor(item, seed, index)
        expect(answerIndex, `seed ${seed} item ${index}`).toBeGreaterThanOrEqual(0)
        expect(cellKey(options[answerIndex] as never)).toBe(cellKey(item.answer))
      })
    }
  })

  it('never lets one family dominate a test', () => {
    /**
     * v1, seed 42: nine of 26 items came from a family with three distinct puzzles in it.
     *
     * The bound is slack around the cap rather than the cap itself. The PLAN never exceeds
     * four; the last-resort substitution tier can, when every family able to carry a rung is
     * already at its share. A crowded test is a mild aesthetic problem; a 500 on
     * `/api/iq/start` is not, so the fallback widens rather than fails.
     *
     * Six is still comfortably clear of what this exists to prevent - v1 put nine of 26 items
     * on a family with three distinct puzzles in it.
     */
    for (const { seed, items } of tests) {
      const tally = new Map<string, number>()
      for (const item of items) tally.set(item.rule, (tally.get(item.rule) ?? 0) + 1)
      for (const [family, count] of Array.from(tally.entries())) {
        expect(count, `${family} on seed ${seed}`).toBeLessThanOrEqual(MAX_PER_FAMILY + 2)
      }
      expect(new Set(items.map(item => item.rule)).size, `seed ${seed}`).toBeGreaterThanOrEqual(6)
    }
  })

  it('keeps each family varied, which is the whole point of the rebuild', () => {
    /**
     * The measurement that started this. Over 60 seeds v1 scored:
     *
     * ```
     *   shape-progression   313 items ->   3 distinct grids   (ratio 0.010)
     *   count-series        349 items ->   5 distinct grids   (ratio 0.014)
     *   size-scale          165 items ->  24 distinct grids   (ratio 0.145)
     *   rotation            110 items ->  20 distinct grids   (ratio 0.182)
     * ```
     *
     * Measured on the whole grid rather than the answer, because grid entropy is what defends
     * against a taker recognising an item they have seen before, and it is unbounded - where
     * answer entropy is capped by how much a single cell can express.
     */
    const items = tests.flatMap(({ items: list }) => list)
    const perFamily = new Map<string, { n: number; grids: Set<string> }>()

    for (const item of items) {
      const entry = perFamily.get(item.rule) ?? { n: 0, grids: new Set<string>() }
      entry.n += 1
      entry.grids.add(item.cells.map(cell => (cell ? cellKey(cell) : '-')).join('|'))
      perFamily.set(item.rule, entry)
    }

    for (const [family, { n, grids }] of Array.from(perFamily.entries())) {
      expect(grids.size / n, `${family}: ${grids.size} distinct grids in ${n} items`).toBeGreaterThan(0.9)
    }
  })

  it('never concentrates a family answer on one shape', () => {
    /**
     * The direct guard against v1's signature bug - `shape-progression` answered with a
     * triangle every single time, because its ring length divided the grid width.
     *
     * v2 reproduced it once, from a different cause: track values were absolute indices
     * rather than offsets from the base, making the answer a pure function of the layout.
     * Measured at 60% triangle before the fix. Two independent mechanisms, one symptom, so
     * the symptom is what gets asserted.
     */
    const byFamily = new Map<string, Map<string, number>>()
    for (const item of tests.flatMap(({ items }) => items)) {
      const kind = item.answer.inner?.kind
      if (!kind) continue
      const counts = byFamily.get(item.rule) ?? new Map<string, number>()
      counts.set(kind, (counts.get(kind) ?? 0) + 1)
      byFamily.set(item.rule, counts)
    }

    for (const [family, counts] of Array.from(byFamily.entries())) {
      const total = Array.from(counts.values()).reduce((sum, n) => sum + n, 0)
      const [kind, top] = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0] as [string, number]
      // `side-progression` legitimately clusters at the ends of a five-shape ladder, so the
      // bar is "not overwhelming" rather than "uniform".
      expect(top / total, `${family} answers ${kind} ${((top / total) * 100).toFixed(0)}% of the time`).toBeLessThan(0.6)
    }
  })

  it('substitutes rarely enough that the plan still means something', () => {
    const items = tests.flatMap(({ items: list }) => list)
    const substituted = items.filter(item => item.substituted).length
    expect(substituted / items.length).toBeLessThan(0.25)
  })

  it('keeps every family the planner names in the vocabulary', () => {
    for (const family of Object.keys(FAMILY_WEIGHTS)) {
      expect(RULES_BY_NAME[family], `${family} has a weight but no rule`).toBeDefined()
    }
    for (const rule of RULES) {
      expect(FAMILY_WEIGHTS[rule.name], `${rule.name} has a rule but no weight`).toBeDefined()
    }
  })
})
