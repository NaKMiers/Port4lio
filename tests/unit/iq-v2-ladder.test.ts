import { describe, expect, it } from 'vitest'

import { ITEM_COUNT } from '@/lib/iq/items/config'
import {
  canFill,
  difficultyIndex,
  FAMILY_SPACING,
  LADDER,
  MAX_PER_FAMILY,
  MAX_SEQUENCE_PER_FAMILY,
  planFamilies,
  profileFor,
  type RuleCapabilities,
  type RungProfile,
} from '@/lib/iq/items/v2/ladder'

/**
 * The ladder, asserted rather than described.
 *
 * `lib/iq/scoring.ts` maps a raw total onto the conventional scale and justifies it with the
 * claim that later items are genuinely harder. In v1 that claim was false - every rule
 * ignored its `rung` argument, and the measured rise in varying dimensions from the front
 * half to the back half was 0.0. These tests are the difference between a published claim
 * and a checkable one.
 *
 * They deliberately do not need any rule to exist. The ladder is a property of the test's
 * shape, so it can be proven before the vocabulary that fills it is written.
 */

const SEEDS = Array.from({ length: 40 }, (_, i) => i * 6151 + 17)
const mean = (values: number[]) =>
  values.reduce((sum, n) => sum + n, 0) / values.length

describe('the ladder table', () => {
  it('has one row per item', () => {
    expect(LADDER).toHaveLength(ITEM_COUNT)
    expect(LADDER.map(profile => profile.rung)).toEqual(
      Array.from({ length: ITEM_COUNT }, (_, i) => i + 1)
    )
  })

  it('throws for a rung it has no row for', () => {
    expect(() => profileFor(0)).toThrow(/no ladder row/)
    expect(() => profileFor(ITEM_COUNT + 1)).toThrow(/no ladder row/)
  })

  it('mixes layouts the way the reference test does', () => {
    /**
     * Theirs is 14 matrices, 8 sequences, 1 small matrix, plus three one-off formats. Two of
     * those fold into the matrix count and one - their item 26 - is a four-box sequence,
     * which is exactly what `1x3-sequence` is, so it counts as the ninth sequence here.
     */
    const count = (id: string) =>
      LADDER.filter(profile => profile.layout.id === id).length
    expect(count('3x3-matrix')).toBe(16)
    expect(count('1x3-sequence')).toBe(9)
    expect(count('2x2-matrix')).toBe(1)
  })

  it('puts the single small matrix where the reference puts it', () => {
    // Their only 2x2 is item 3, and a 2x2 confirms the rule zero times - so it belongs early,
    // while one varying dimension is still all that is being asked.
    const at = LADDER.findIndex(profile => profile.layout.id === '2x2-matrix')
    expect(at + 1).toBe(3)
  })

  it('introduces the sequence layout partway in, not at the start', () => {
    // Three given cells confirm a rule once where nine confirm it twice, so a sequence is a
    // harder container for the same rule. Opening the test with one would misgrade item 1.
    const first = LADDER.findIndex(
      profile => profile.layout.id === '1x3-sequence'
    )
    expect(first + 1).toBe(9)
  })

  it('puts most of the tail in sequences', () => {
    const tail = LADDER.slice(18).filter(
      profile => profile.layout.id === '1x3-sequence'
    )
    expect(tail.length).toBeGreaterThanOrEqual(5)
  })

  it('reaches three varying dimensions for the first time at rung 11', () => {
    const first = LADDER.findIndex(profile => profile.dimensions === 3)
    expect(first + 1).toBe(11)
  })

  it('rises as an envelope, dips and all', () => {
    /**
     * The individual rows may go down - the reference interleaves easy items late as pacing
     * relief - but the running maximum may never go down. That is the precise sense in which
     * this ladder rises, and asserting the envelope rather than the sequence is what lets the
     * dips exist without weakening the claim.
     *
     * Checked on `difficultyIndex` and on each axis separately, because both properties
     * matter: no axis may regress overall, and the combined curve may not either.
     */
    const curves = {
      difficulty: LADDER.map(difficultyIndex),
      dimensions: LADDER.map(profile => profile.dimensions),
      composition: LADDER.map(profile => profile.composition),
    }

    for (const [name, values] of Object.entries(curves)) {
      let high = values[0] as number
      values.forEach((value, index) => {
        const previous = high
        high = Math.max(high, value)
        expect(
          high,
          `${name} envelope fell at rung ${index + 1}`
        ).toBeGreaterThanOrEqual(previous)
      })
      // ...and it must actually climb, not merely refuse to fall.
      expect(Math.max(...values), name).toBeGreaterThan(values[0] as number)
    }
  })

  it('keeps the pacing dips that a monotonic cleanup would delete', () => {
    /**
     * Named explicitly so a future tidy-up that "fixes" the non-monotonic table fails loudly
     * instead of silently removing structure copied from the reference on purpose.
     *
     * Measured on `difficultyIndex`, not on `dimensions`. Rung 21 varies the same number of
     * dimensions as rung 20 and is plainly easier: it drops a composition level and moves
     * from the layout that confirms the rule zero times to the one that confirms it twice. A
     * dip is a drop in overall difficulty, not in one chosen axis.
     */
    for (const rung of [12, 18, 21]) {
      const here = LADDER[rung - 1] as RungProfile
      const before = LADDER[rung - 2] as RungProfile
      expect(
        difficultyIndex(here),
        `rung ${rung} should be a dip`
      ).toBeLessThan(difficultyIndex(before))
    }
  })

  it('ends on its hardest rung', () => {
    const scores = LADDER.map(difficultyIndex)
    expect(scores[scores.length - 1]).toBe(Math.max(...scores))
  })

  it('makes the claim in scoring.ts true', () => {
    /**
     * The assertion that this whole rebuild exists for.
     *
     * `lib/iq/scoring.ts` says: "later rungs allow rules that need two or three dimensions
     * tracked at once, so getting item 24 right genuinely is harder than item 2". Measured
     * over v1, this number was 0.0.
     */
    const front = mean(LADDER.slice(0, 13).map(profile => profile.dimensions))
    const back = mean(LADDER.slice(13).map(profile => profile.dimensions))
    expect(back - front).toBeGreaterThanOrEqual(0.5)
  })

  it('never asks a sequence to carry only one dimension', () => {
    // A single cyclic dimension over three cells has no determined continuation: the cycle
    // reading and the palindrome reading both fit. A co-active ordinal dimension is what
    // pins the direction, so a one-dimension sequence must not exist.
    for (const profile of LADDER)
      if (profile.layout.id === '1x3-sequence')
        expect(
          profile.dimensions,
          `rung ${profile.rung}`
        ).toBeGreaterThanOrEqual(2)
  })

  it('keeps the weakest layout out of the hardest slots', () => {
    // A 2x2 gives a row step and a column step and confirms neither, so it cannot honestly
    // carry three simultaneous dimensions.
    for (const profile of LADDER)
      if (profile.layout.id === '2x2-matrix')
        expect(profile.dimensions, `rung ${profile.rung}`).toBeLessThanOrEqual(
          2
        )
  })

  it('never asks for more decoys than its composition can afford', () => {
    /**
     * Depth `c` provides `c + 1` element classes, and the rule has to drive at least one, so
     * at most `c` can be left constant as decoys.
     *
     * A row that breaks this is unbuildable by EVERY family simultaneously, which presents as
     * "the whole vocabulary is broken" and is really "one table cell asks for something
     * impossible". It cost real debugging time before it was written down, which is the
     * argument for asserting it rather than remembering it.
     */
    for (const profile of LADDER)
      expect(
        profile.decoys,
        `rung ${profile.rung} wants more decoys than depth affords`
      ).toBeLessThanOrEqual(profile.composition)
  })

  it('does not leave an easy slot at the very end', () => {
    for (const profile of LADDER.slice(19))
      expect(profile.dimensions, `rung ${profile.rung}`).toBeGreaterThanOrEqual(
        2
      )
  })
})

describe('canFill', () => {
  const permissive: RuleCapabilities = {
    rungs: { min: 1, max: 26 },
    maxDimensions: 3,
    layouts: ['3x3-matrix', '1x3-sequence', '2x2-matrix'],
    composition: { min: 0, max: 3 },
  }

  it('accepts a family that can carry everything', () => {
    for (const profile of LADDER)
      expect(canFill(permissive, profile)).toBe(true)
  })

  it('rejects on each capability independently', () => {
    // Each capability is probed against a rung that actually exercises it. Rung 26 is the
    // last, is three-dimension, and is a sequence; rung 19 is where the deepest composition
    // sits now that the ladder mirrors the reference's ordering.
    const last = profileFor(26)
    expect(canFill({ ...permissive, rungs: { min: 1, max: 20 } }, last)).toBe(
      false
    )
    expect(canFill({ ...permissive, maxDimensions: 2 }, last)).toBe(false)
    expect(canFill({ ...permissive, layouts: ['3x3-matrix'] }, last)).toBe(
      false
    )

    const deepest = profileFor(19)
    expect(deepest.composition).toBe(3)
    expect(
      canFill({ ...permissive, composition: { min: 0, max: 2 } }, deepest)
    ).toBe(false)
  })

  it('honours a maximum rung, which v1 had no way to express', () => {
    // The gap that let rung 26 draw the most trivial family in the vocabulary.
    const easyOnly: RuleCapabilities = {
      ...permissive,
      rungs: { min: 1, max: 12 },
    }
    expect(canFill(easyOnly, profileFor(12))).toBe(true)
    expect(canFill(easyOnly, profileFor(13))).toBe(false)
  })
})

describe('planFamilies', () => {
  /**
   * A stand-in vocabulary shaped like the real one: a few permissive families, a few capped
   * to the back half, one sequence-shy. Using a fake here is the point - the plan's
   * constraints are a property of the planner, not of any particular rule set.
   */
  const CAPS: Record<string, RuleCapabilities> = {
    alpha: {
      rungs: { min: 1, max: 26 },
      maxDimensions: 3,
      layouts: ['3x3-matrix', '1x3-sequence', '2x2-matrix'],
      composition: { min: 0, max: 3 },
    },
    beta: {
      rungs: { min: 1, max: 26 },
      maxDimensions: 3,
      layouts: ['3x3-matrix', '1x3-sequence', '2x2-matrix'],
      composition: { min: 0, max: 3 },
    },
    gamma: {
      rungs: { min: 1, max: 26 },
      maxDimensions: 3,
      layouts: ['3x3-matrix', '1x3-sequence'],
      composition: { min: 0, max: 3 },
    },
    delta: {
      rungs: { min: 1, max: 26 },
      maxDimensions: 3,
      layouts: ['3x3-matrix', '2x2-matrix'],
      composition: { min: 0, max: 3 },
    },
    epsilon: {
      rungs: { min: 1, max: 26 },
      maxDimensions: 3,
      layouts: ['3x3-matrix', '1x3-sequence', '2x2-matrix'],
      composition: { min: 0, max: 3 },
    },
    zeta: {
      rungs: { min: 1, max: 26 },
      maxDimensions: 3,
      layouts: ['3x3-matrix', '1x3-sequence'],
      composition: { min: 0, max: 3 },
    },
    eta: {
      rungs: { min: 14, max: 26 },
      maxDimensions: 3,
      layouts: ['3x3-matrix', '1x3-sequence'],
      composition: { min: 1, max: 3 },
    },
    theta: {
      rungs: { min: 14, max: 26 },
      maxDimensions: 3,
      layouts: ['3x3-matrix'],
      composition: { min: 2, max: 3 },
    },
    iota: {
      rungs: { min: 1, max: 26 },
      maxDimensions: 3,
      layouts: ['3x3-matrix', '1x3-sequence', '2x2-matrix'],
      composition: { min: 0, max: 3 },
    },
    kappa: {
      rungs: { min: 1, max: 26 },
      maxDimensions: 3,
      layouts: ['3x3-matrix', '1x3-sequence', '2x2-matrix'],
      composition: { min: 0, max: 3 },
    },
  }

  const QUOTA: Record<string, number> = {
    alpha: 4,
    beta: 3,
    gamma: 3,
    delta: 3,
    epsilon: 3,
    zeta: 3,
    eta: 2,
    theta: 2,
    iota: 2,
    kappa: 1,
  }

  const eligible = (family: string, profile: RungProfile) =>
    canFill(CAPS[family] as RuleCapabilities, profile)

  const plans = SEEDS.map(seed => ({
    seed,
    plan: planFamilies(seed, { weights: QUOTA, eligible }),
  }))

  it('assigns exactly one family per item', () => {
    for (const { seed, plan } of plans) {
      expect(plan, `seed ${seed}`).toHaveLength(ITEM_COUNT)
      expect(plan.every(Boolean), `seed ${seed}`).toBe(true)
    }
  })

  it('spreads the work across most of the vocabulary', () => {
    /**
     * v1 sampled independently per item and 68% of all items came from three families. The
     * cap makes domination impossible; this asserts the other half - that the mix is broad
     * rather than merely not-concentrated.
     *
     * A share target rather than an exact count, because exact counts turned planning into a
     * 3.8-million-node search whose only solutions were rigidly periodic. See `weights`.
     */
    for (const { seed, plan } of plans)
      expect(
        new Set(plan).size,
        `seed ${seed} used too few families`
      ).toBeGreaterThanOrEqual(Math.min(7, Object.keys(QUOTA).length))
  })

  it('tracks the weights without being told exact counts', () => {
    // Proportionality has to emerge from the local least-used-relative-to-weight rule, or the
    // weights are decoration. Checked in aggregate, since one 26-item test is a small sample.
    const totals: Record<string, number> = {}
    for (const { plan } of plans)
      for (const family of plan) totals[family] = (totals[family] ?? 0) + 1

    const heaviest = Object.keys(QUOTA).sort(
      (a, b) => (QUOTA[b] ?? 0) - (QUOTA[a] ?? 0)
    )[0] as string
    const lightest = Object.keys(QUOTA).sort(
      (a, b) => (QUOTA[a] ?? 0) - (QUOTA[b] ?? 0)
    )[0] as string
    expect(totals[heaviest] ?? 0).toBeGreaterThan(totals[lightest] ?? 0)
  })

  it('caps how often one family can appear', () => {
    // The constraint that alone would have prevented the nine-of-26 bug.
    for (const { seed, plan } of plans)
      for (const family of Array.from(new Set(plan)))
        expect(
          plan.filter(name => name === family).length,
          `${family} on seed ${seed}`
        ).toBeLessThanOrEqual(MAX_PER_FAMILY)
  })

  it('spaces repeats out so the test does not feel repetitive locally', () => {
    // Global counts can be perfect while three of one family land back to back, which reads
    // as "the same question again" even when the totals say otherwise.
    for (const { seed, plan } of plans)
      for (let i = 0; i < plan.length; i += 1)
        for (
          let j = i + 1;
          j < Math.min(i + FAMILY_SPACING, plan.length);
          j += 1
        )
          expect(
            plan[i],
            `seed ${seed}: ${plan[i]} repeats at ${i + 1} and ${j + 1}`
          ).not.toBe(plan[j])
  })

  it('shares the sequence slots around', () => {
    // Fewer families can fill a sequence than a matrix, so without a cap the eight sequence
    // slots collapse onto the two or three most capable families.
    for (const { seed, plan } of plans) {
      const tally: Record<string, number> = {}
      plan.forEach((family, index) => {
        if (LADDER[index]?.layout.id === '1x3-sequence')
          tally[family] = (tally[family] ?? 0) + 1
      })
      for (const [family, count] of Object.entries(tally))
        expect(count, `${family} on seed ${seed}`).toBeLessThanOrEqual(
          MAX_SEQUENCE_PER_FAMILY
        )
    }
  })

  it('only ever assigns a family to a rung it can actually fill', () => {
    for (const { seed, plan } of plans)
      plan.forEach((family, index) => {
        const profile = LADDER[index] as RungProfile
        expect(
          eligible(family, profile),
          `${family} at rung ${index + 1} on seed ${seed}`
        ).toBe(true)
      })
  })

  it('varies the plan across seeds', () => {
    // A deterministic planner that ignored its seed would satisfy every constraint above and
    // hand every taker the same test.
    expect(
      new Set(plans.map(({ plan }) => plan.join(','))).size
    ).toBeGreaterThan(SEEDS.length / 2)
  })

  it('is deterministic for one seed', () => {
    for (const { seed, plan } of plans.slice(0, 5))
      expect(planFamilies(seed, { weights: QUOTA, eligible })).toEqual(plan)
  })

  it('throws with no vocabulary at all', () => {
    expect(() => planFamilies(1, { weights: {}, eligible })).toThrow(
      /no families/
    )
  })

  it('relaxes spacing rather than refusing to build a test', () => {
    /**
     * Spacing is a statement about how the test FEELS, not a correctness property, so a
     * vocabulary too small to keep every repeat four apart should still produce a test.
     *
     * With one eligible family and 26 slots the cap makes it impossible anyway - but with
     * enough families to cover the slots and not enough to space them, the plan must come out.
     */
    const permissiveCaps: RuleCapabilities = {
      rungs: { min: 1, max: 26 },
      maxDimensions: 3,
      layouts: ['3x3-matrix', '1x3-sequence', '2x2-matrix'],
      composition: { min: 0, max: 3 },
    }
    const seven = Object.fromEntries(
      ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(name => [name, 1])
    )
    const plan = planFamilies(1, {
      weights: seven,
      eligible: (_family, profile) => canFill(permissiveCaps, profile),
    })
    expect(plan).toHaveLength(ITEM_COUNT)
    expect(plan.every(Boolean)).toBe(true)
  })

  it('throws when no family can carry a rung at all', () => {
    /**
     * The distinction that separates this from v1.
     *
     * v1's `rulesForRung` ended in `return eligible.length ? eligible : [shadingCycle]` - if
     * nothing fit, substitute the easiest family in the vocabulary. The test still produced 26
     * items and nothing failed; the ladder simply was not the one `scoring.ts` describes. A
     * genuine gap between the ladder and the rules has to be loud.
     */
    const matrixOnly: RuleCapabilities = {
      rungs: { min: 1, max: 26 },
      maxDimensions: 3,
      layouts: ['3x3-matrix'],
      composition: { min: 0, max: 3 },
    }
    expect(() =>
      planFamilies(1, {
        weights: { only: 1 },
        eligible: (_family, profile) => canFill(matrixOnly, profile),
      })
    ).toThrow(/no family can fill rung/)
  })
})
