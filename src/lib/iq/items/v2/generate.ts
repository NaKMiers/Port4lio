import { ITEM_COUNT } from '@/lib/iq/items/config'
import { rng, shuffle } from '@/lib/iq/items/random'
import { cellKey, type Cell } from '@/lib/iq/items/v2/cell'
import { LADDER, MAX_PER_FAMILY, planFamilies, profileFor, type RungProfile } from '@/lib/iq/items/v2/ladder'
import type { CellGrid } from '@/lib/iq/items/v2/layout'
import {
  familyCanFill,
  FAMILY_WEIGHTS,
  RULES_BY_NAME,
  type Built,
  type Distractor,
} from '@/lib/iq/items/v2/rules'
import { verifyItem } from '@/lib/iq/items/v2/verify'

/**
 * One verified item per rung, from a seed.
 *
 * ```
 *   seed ──▶ planFamilies (all 26 at once) ──▶ per rung: build ──▶ verify ──┬─ ok ─▶ item
 *                                                   ▲                       │
 *                                                   └──── re-roll params ───┘
 *                                              (same family, up to N times)
 * ```
 *
 * ## Why retries stay inside the assigned family
 *
 * This is the second half of the fix for v1's nine-identical-items bug, and the less obvious
 * half. v1 re-picked the RULE on every failed attempt, so a family with tight constraints
 * kept losing its slots to a family with loose ones - which is how three families ended up
 * producing 68% of all items. Re-rolling parameters within the planned family keeps the
 * distribution the plan chose.
 *
 * Substitution still exists as a last resort, because a hard rung with an unlucky seed should
 * not fail the whole test. It is COUNTED on the item rather than silent, so a test can assert
 * the rate stays negligible. A silent substitution is the bug; a counted one is a metric.
 */

/**
 * A built item plus the bookkeeping the generator adds.
 *
 * Extends `Built` rather than restating a subset of it, so a generated item can be handed
 * straight back to `verifyItem`. That matters: re-verifying what actually shipped is a
 * stronger assertion than re-verifying a fresh build, and a narrower type would have made it
 * impossible to write.
 */
export type Item = Built & {
  /** Family that produced this item. */
  rule: string
  rung: number
  profile: RungProfile
  /** True when the planned family could not generate and another filled in. */
  substituted: boolean
  /** Attempts spent. Carried so the seed sweep can assert a bound on rejection rate. */
  attempts: number
}


/**
 * Parameter re-rolls before giving up on the planned family.
 *
 * Lower than v1's 40 on purpose. Because parameters now come from pre-filtered legal tables
 * rather than being drawn and rejected, a family that needs dozens of attempts is a family
 * that is mostly being rejected - which is a bug to find, not a budget to raise. v1's 40 was
 * itself evidence of how much work rejection sampling was doing.
 */
const MAX_ATTEMPTS = 12

function tryFamily(
  family: string,
  seed: number,
  rung: number,
  profile: RungProfile,
  offset: number
): { built: Built; attempts: number } | null {
  const rule = RULES_BY_NAME[family]
  if (!rule) return null

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const random = rng(seed * 7919 + rung * 104729 + (attempt + offset) * 31337)
    const built = rule.build(random, profile)
    if (built && verifyItem(built, profile).ok) return { built, attempts: attempt + 1 }
  }
  return null
}

export function generateItem(
  seed: number,
  rung: number,
  family: string,
  /**
   * Families that have already hit their per-test cap and must not be substituted in.
   *
   * Without this, substitution could push a family past `MAX_PER_FAMILY` - measured at six of
   * 26 on one seed, which is most of the way back to v1's nine. The planner respected the cap
   * and then the fallback quietly broke it, which is the same shape of bug as v1's
   * `rulesForRung` fallback: a constraint enforced in the obvious place and bypassed in the
   * error path.
   */
  uses: ReadonlyMap<string, number> = new Map()
): Item {
  const profile = profileFor(rung)

  const planned = tryFamily(family, seed, rung, profile, 0)
  if (planned) {
    return {
      ...planned.built,
      rule: family,
      rung,
      profile,
      substituted: false,
      attempts: planned.attempts,
    }
  }

  /**
   * Substitution, and only among families that satisfy the SAME rung profile.
   *
   * Never a fallback to a fixed easy family, which is what v1 did - `rulesForRung` ended in
   * `return eligible.length ? eligible : [shadingCycle]`, so an impossible rung silently
   * became the most trivial item in the vocabulary. A substitute has to carry the rung's
   * demands or the ladder is not what `scoring.ts` says it is.
   */
  const random = rng(seed * 31 + rung)
  const capable = Object.keys(FAMILY_WEIGHTS).filter(
    name => name !== family && familyCanFill(name, profile)
  )

  /**
   * Under-cap families first, then over-cap ones as a genuine last resort.
   *
   * The cap is a preference about how a test feels, in the same way spacing is - it exists so
   * no family dominates, not because a fifth appearance would be incorrect. Refusing to build
   * the test at all when every under-cap substitute fails trades a small aesthetic problem for
   * a 500 on `/api/iq/start`, which is not a trade worth making.
   *
   * What is NEVER relaxed is the rung's own demands: `familyCanFill` gates both tiers, so a
   * substitute always carries the dimensions, layout and composition the ladder asked for.
   * That is the line v1 crossed - its fallback was the easiest rule in the vocabulary
   * regardless of what the rung needed.
   */
  /**
   * Three tiers, widening only as far as it has to.
   *
   * Under the cap first, then one over, then anything that can carry the rung. The ordering is
   * what keeps the cap meaningful without ever letting it fail a test: the last tier is
   * reached only when every family capable of this rung is already at or past its share, which
   * is rare, and one crowded test beats a 500 on `/api/iq/start`.
   *
   * `familyCanFill` gates all three, so the widening never touches the rung's actual demands.
   * That is the line v1 crossed: its fallback was the easiest rule in the vocabulary
   * regardless of what the rung needed, which is how the published difficulty claim became
   * false.
   */
  const countOf = (name: string) => uses.get(name) ?? 0
  const tiers = [
    shuffle(random, capable.filter(name => countOf(name) < MAX_PER_FAMILY)),
    shuffle(random, capable.filter(name => countOf(name) === MAX_PER_FAMILY)),
    shuffle(random, capable),
  ]

  for (const tier of tiers) {
    for (const alternative of tier) {
      const built = tryFamily(alternative, seed, rung, profile, 977)
      if (built) {
        return {
          ...built.built,
          rule: alternative,
          rung,
          profile,
          substituted: true,
          attempts: built.attempts,
        }
      }
    }
  }

  // Every family capable of this rung failed. That is a bug in a rule or in the ladder, not
  // bad luck, and shipping an unverified item to a taker is worse than a loud failure.
  throw new Error(`[iq] no family could fill rung ${rung} for seed ${seed}`)
}

/** A whole test: 26 items on the ladder in `v2/ladder.ts`. */
export function generateTest(seed: number): Item[] {
  const plan = planFamilies(seed, { weights: FAMILY_WEIGHTS, eligible: familyCanFill })

  // Tallied as we go, so a substitution cannot take a family far past the cap the plan
  // respected. The plan never exceeds it; only the last-resort tier can, and by one.
  const uses = new Map<string, number>()

  return LADDER.map((profile, index) => {
    const item = generateItem(seed + index, profile.rung, plan[index] as string, uses)
    uses.set(item.rule, (uses.get(item.rule) ?? 0) + 1)
    return item
  })
}

/**
 * Options in display order, deterministic per seed so a re-render matches what was sat.
 *
 * Same shape and the same magic multiplier as v1, because the property that matters is
 * unchanged: the shuffle has to be a pure function of the seed and the item index.
 */
export function optionsFor(item: Item, seed: number, index: number): Cell[] {
  return shuffle(rng(seed + index * 977), [item.answer, ...item.distractors.map(d => d.cell)])
}

/**
 * Where the answer sits after shuffling. The scorer compares against this, never a label.
 *
 * Matched by key rather than by reference identity, which is deliberate: `indexOf` returns
 * -1 the moment anything between here and `optionsFor` maps or clones a cell, and a -1 answer
 * key marks every answer in the test wrong. Safe because verification has already proven the
 * six keys are distinct.
 */
export function answerIndexFor(item: Item, seed: number, index: number): number {
  const target = cellKey(item.answer)
  return optionsFor(item, seed, index).findIndex(cell => cellKey(cell) === target)
}

void ITEM_COUNT
