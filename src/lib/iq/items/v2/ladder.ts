import { ITEM_COUNT } from '@/lib/iq/items/config'
import { rng } from '@/lib/iq/items/random'
import { LAYOUTS, type LayoutId, type LayoutSpec } from '@/lib/iq/items/v2/layout'

/**
 * The difficulty ladder, and the reason a raw score means anything.
 *
 * ## What this replaces
 *
 * v1 had `RuleSpec.build(random, rung)` and all six rules ignored the `rung` argument.
 * Eligibility was `minRung <= rung`, so every easy family stayed eligible forever and the
 * generator picked uniformly among them - on seed 42, rung 25 drew the most trivial family
 * in the vocabulary and rung 26 the second most trivial. Measured across 60 seeds, the mean
 * number of simultaneously-varying dimensions rose by exactly 0.0 from the first half of the
 * test to the second.
 *
 * That matters beyond aesthetics. `lib/iq/scoring.ts` justifies mapping a raw total onto the
 * conventional scale with the claim that "later rungs allow rules that need two or three
 * dimensions tracked at once, so getting item 24 right genuinely is harder than item 2". The
 * claim was false, and it is published on `/iq/method`. This file is what makes it true, and
 * `tests/unit/iq-v2-ladder.test.ts` is what keeps it true.
 *
 * ## Why a table and not a formula
 *
 * The reference test's difficulty curve is a rising ENVELOPE WITH DIPS, not a ramp: items 12,
 * 18 and 21 are conspicuously easier than their neighbours. That is not sloppiness. A taker
 * who stalls on item 17 with nine to go behaves very differently from one who stalls on 17
 * and then gets something they can solve - the dip buys back the morale that a monotonic
 * ramp spends. No closed form produces that shape, and a table can be asserted row by row.
 */

/**
 * What a rung DEMANDS of whichever family fills it.
 *
 * Data, not a number to interpret. The reason all six v1 rules ignored `rung` is that there
 * was nothing useful to do with an integer without each rule inventing its own opinion about
 * what "17" means - six mappings that would immediately disagree with each other and with
 * the claim in `scoring.ts`. One table, decoded once, read by everybody.
 */
export type RungProfile = {
  rung: number
  /** How many dimensions must vary at once. */
  dimensions: 1 | 2 | 3
  /** Cell composition depth: 0 bare, 1 frame+inner, 2 lattice, 3 three element classes. */
  composition: 0 | 1 | 2 | 3
  layout: LayoutSpec
  /**
   * How obvious the steps may be.
   *
   * `plain` means unit, forward, unshifted - the reading a solver tries first. `oblique`
   * allows a negative direction, a non-unit step, and a non-zero phase, so the first guess
   * is wrong without the item being any less determined.
   *
   * The cheapest real difficulty knob there is: it raises SEARCH cost, not solution cost.
   * It also draws from the same enumerated parameter table under two filters, which is what
   * stops a family having an "easy variant" that exists only by accident - exactly how v1's
   * `size-scale` silently became growing-only.
   */
  stepStyle: 'plain' | 'oblique'
  /**
   * Element classes present but provably CONSTANT.
   *
   * Why reference items look far more complicated than their rules are. A decoy raises the
   * cost of finding which dimension matters without touching uniqueness - provided it really
   * is constant, which verification checks rather than trusts.
   *
   * Bounded by `composition`, and the bound is arithmetic rather than stylistic: depth `c`
   * provides `c + 1` element classes, at least one of which the rule must drive, so at most
   * `c` can be left constant. A row asking for more decoys than its depth affords is
   * unbuildable by every family at once - which reads as "the vocabulary is broken" and is
   * really "the ladder asked for something impossible". Asserted in the ladder test.
   */
  decoys: 0 | 1 | 2
}

type LadderRow = {
  d: 1 | 2 | 3
  c: 0 | 1 | 2 | 3
  l: LayoutId
  s: 'plain' | 'oblique'
  k: 0 | 1 | 2
}

/**
 * One row per item. The dips at 12, 18 and 21 are deliberate - see the header.
 *
 * ## Aligned to the reference item for item
 *
 * Each row carries the reference question it mirrors. What is copied is the STRUCTURE - which
 * layout, how many dimensions vary, how deep the cell is, where the pacing dips fall - and
 * nothing else. The puzzles themselves are generated originals; the reference items are
 * someone else's copyrighted work and are not reproduced.
 *
 * The alignment is worth having because the reference's ordering encodes real judgement about
 * how a 26-item test should escalate, and that judgement is not copyrightable. So:
 *
 * ```
 *   item  3  the only 2x2 in the test          (theirs is item 3)
 *   item  9  the first sequence layout         (theirs is item 9)
 *   item 11  the first three-dimension item    (theirs is item 11)
 *   items 12, 18, 21  pacing dips              (theirs dip at 12, 18, 21)
 *   item 26  hardest, and a sequence           (theirs is a 4-cell sequence)
 * ```
 *
 * Layout mix: 16 matrices, 9 sequences, 1 small matrix. Theirs is 14 / 8 / 1 plus three
 * one-off formats - two of which are matrix-shaped and fold into the 16, and one of which
 * (their item 26) is a four-box sequence, which is literally what `1x3-sequence` is: four
 * boxes, three given.
 */
const LADDER_ROWS: readonly LadderRow[] = [
  //         d  c  layout          step       decoys   reference item this mirrors
  /*  1 */ { d: 1, c: 0, l: '3x3-matrix', s: 'plain', k: 0 },   // Q1  bare shape, one invariant
  /*  2 */ { d: 1, c: 0, l: '3x3-matrix', s: 'plain', k: 0 },   // Q2  element count, bare
  // Two dimensions, not one. A 2x2 confirms the rule ZERO times, so a single dimension there
  // leaves a solver nothing to cross-check against - and because the layout also demands an
  // ordinal track to pin its reading, one dimension means that track must be both the rule
  // and its own confirmation. Their item 3 reads as shape-count plus shape-identity anyway.
  /*  3 */ { d: 2, c: 0, l: '2x2-matrix', s: 'plain', k: 0 },   // Q3  their only 2x2, and it is item 3
  /*  4 */ { d: 2, c: 1, l: '3x3-matrix', s: 'plain', k: 0 },   // Q4  frame + inner starts here
  /*  5 */ { d: 2, c: 2, l: '3x3-matrix', s: 'plain', k: 1 },   // Q5  sub-elements inside the cell
  /*  6 */ { d: 2, c: 1, l: '3x3-matrix', s: 'plain', k: 0 },   // Q6  rotation + count
  /*  7 */ { d: 1, c: 0, l: '3x3-matrix', s: 'plain', k: 0 },   // Q7  permutation, one dimension
  /*  8 */ { d: 2, c: 2, l: '3x3-matrix', s: 'plain', k: 0 },   // Q8  overlay logic
  /*  9 */ { d: 2, c: 2, l: '1x3-sequence', s: 'plain', k: 1 }, // Q9  FIRST SEQUENCE - theirs too
  /* 10 */ { d: 2, c: 1, l: '3x3-matrix', s: 'plain', k: 0 },   // Q10 fill cycle + shape
  /* 11 */ { d: 3, c: 3, l: '1x3-sequence', s: 'plain', k: 1 }, // Q11 FIRST 3-DIMENSION - theirs too
  /* 12 */ { d: 1, c: 2, l: '3x3-matrix', s: 'plain', k: 1 },   // Q12 pacing dip, as theirs is
  /* 13 */ { d: 2, c: 2, l: '1x3-sequence', s: 'plain', k: 1 }, // Q13
  /* 14 */ { d: 2, c: 1, l: '3x3-matrix', s: 'oblique', k: 0 }, // Q14 back half opens
  /* 15 */ { d: 2, c: 1, l: '1x3-sequence', s: 'plain', k: 0 }, // Q15
  /* 16 */ { d: 2, c: 1, l: '3x3-matrix', s: 'oblique', k: 1 }, // Q16
  /* 17 */ { d: 3, c: 2, l: '3x3-matrix', s: 'plain', k: 1 },   // Q17 three-dimension cluster
  /* 18 */ { d: 1, c: 1, l: '3x3-matrix', s: 'plain', k: 0 },   // Q18 pacing dip, as theirs is
  /* 19 */ { d: 3, c: 3, l: '1x3-sequence', s: 'plain', k: 1 }, // Q19 three element classes at once
  /* 20 */ { d: 2, c: 2, l: '3x3-matrix', s: 'oblique', k: 1 }, // Q20
  /* 21 */ { d: 2, c: 1, l: '1x3-sequence', s: 'plain', k: 0 }, // Q21 pacing dip, as theirs is
  /* 22 */ { d: 3, c: 1, l: '3x3-matrix', s: 'oblique', k: 0 }, // Q22
  /* 23 */ { d: 2, c: 1, l: '1x3-sequence', s: 'oblique', k: 1 }, // Q23
  /* 24 */ { d: 2, c: 2, l: '1x3-sequence', s: 'oblique', k: 1 }, // Q24
  /* 25 */ { d: 3, c: 2, l: '3x3-matrix', s: 'oblique', k: 1 }, // Q25
  /* 26 */ { d: 3, c: 2, l: '1x3-sequence', s: 'oblique', k: 2 }, // Q26 hardest, and a sequence
]

/** The rung a 1-based item index demands. */
export function profileFor(rung: number): RungProfile {
  const row = LADDER_ROWS[rung - 1]
  if (!row) throw new Error(`[iq] no ladder row for rung ${rung}`)
  return {
    rung,
    dimensions: row.d,
    composition: row.c,
    layout: LAYOUTS[row.l],
    stepStyle: row.s,
    decoys: row.k,
  }
}

export const LADDER: readonly RungProfile[] = LADDER_ROWS.map((_, index) => profileFor(index + 1))

/**
 * How hard a rung is, as one number.
 *
 * Difficulty here is genuinely multi-axis - a rung can get harder by varying more dimensions,
 * by stacking more elements into a cell, by moving to a layout that confirms the rule fewer
 * times, by hiding the step behind a non-obvious phase, or by adding constant decoys to
 * search past. Reasoning about the shape of the ladder one axis at a time gets it wrong: rung
 * 21 varies as many dimensions as rung 20 and is clearly easier, because it drops a
 * composition level AND moves from the layout that confirms nothing to the one that confirms
 * twice.
 *
 * The weights are ordinal, not measured. Nothing is calibrated against real takers - that is
 * the same honesty `scoring.ts` states about the band table - and this number is never shown
 * to anyone or used to score. It exists so the ladder's SHAPE can be asserted, which is the
 * one thing v1 could not do.
 *
 * Dimensions dominate deliberately: tracking a third simultaneous rule is a bigger step than
 * any single presentational change.
 */
export function difficultyIndex(profile: RungProfile): number {
  return (
    profile.dimensions * 3 +
    profile.composition +
    (2 - profile.layout.confirmations) +
    (profile.stepStyle === 'oblique' ? 1 : 0) +
    profile.decoys
  )
}

/**
 * What a family can carry, checked against what a rung asks for.
 *
 * The inversion from v1's `minRung <= rung` is the whole point. That predicate could only
 * say "this rule is allowed this late"; it had no way to say "this slot NEEDS three
 * dimensions", and no rule had any way to answer. `rungs.max` in particular has no v1
 * equivalent, and it is what stops the tail drawing a family that cannot carry it.
 */
export type RuleCapabilities = {
  rungs: { min: number; max: number }
  /**
   * Fewest dimensions this family can vary, defaulting to one.
   *
   * Needed because some families have a FIXED arity rather than a range. `set-logic` varies
   * exactly two - inferring an operator means holding both operands in mind - and cannot be
   * asked to vary one. Without a floor it was eligible for one-dimension rungs, built its two
   * anyway, and every item was rejected for delivering more than the rung asked for.
   */
  minDimensions?: 1 | 2 | 3
  maxDimensions: 1 | 2 | 3
  layouts: readonly LayoutId[]
  composition: { min: 0 | 1 | 2 | 3; max: 0 | 1 | 2 | 3 }
}

export function canFill(capabilities: RuleCapabilities, profile: RungProfile): boolean {
  return (
    profile.rung >= capabilities.rungs.min &&
    profile.rung <= capabilities.rungs.max &&
    profile.dimensions >= (capabilities.minDimensions ?? 1) &&
    profile.dimensions <= capabilities.maxDimensions &&
    capabilities.layouts.includes(profile.layout.id) &&
    profile.composition >= capabilities.composition.min &&
    profile.composition <= capabilities.composition.max
  )
}

/**
 * No family may fill more than this many of the 26 slots.
 *
 * The single constraint that would have prevented the bug this rebuild started from: on seed
 * 42, nine of 26 items came from one family, and that family had only three distinct items in
 * its entire output space.
 */
export const MAX_PER_FAMILY = 4

/** No family may fill more than this many of the eight sequence slots. */
export const MAX_SEQUENCE_PER_FAMILY = 3

/** A family may not appear twice inside any window of this many consecutive rungs. */
export const FAMILY_SPACING = 4

/**
 * Plan the whole test at once, then fill the slots.
 *
 * ## Why planning beats picking
 *
 * v1 chose a rule per item, independently and uniformly from whatever was eligible. Two
 * things follow from that and both were measured. Globally, 68% of items came from the three
 * most repetitive families, because independent uniform sampling has variance and nothing
 * corrects it. Locally, one family could land nine times.
 *
 * A per-family cap plus proportional balancing fixes both, and does it in one linear pass -
 * see `weights` below for why an exact-count version had to be abandoned.
 *
 * ## What may relax and what may not
 *
 * Spacing may relax: how far apart two items of one family sit is a statement about how the
 * test feels, and three apart instead of four is not a defect worth refusing to build a test
 * over. The per-family CAP may not relax, because that is the constraint standing between
 * this and v1's nine-of-twenty-six. Nor may the rung's own demands - a family that cannot
 * carry three dimensions is never substituted into a three-dimension slot, which is the
 * difference between this and v1's `rulesForRung` fallback to the easiest rule in the
 * vocabulary.
 */
export type FamilyQuota = Record<string, number>

type PlanInput = {
  /**
   * Relative share, NOT an exact count.
   *
   * The distinction is the whole design of this function, and it was learned the hard way.
   * An exact-count version of this - "family X fills exactly 4 slots" - turns planning into a
   * rigid combinatorial puzzle: combined with the no-repeat-within-four-rungs rule and the
   * per-rung eligibility, a deterministic exhaustive search needed 3.8 MILLION nodes to find
   * the first solution, and the solutions it found were forced into a near-periodic
   * `a, b, c, d, a, b, c, d` pattern. A quarter of seeds could not be planned inside any
   * budget worth spending on a request.
   *
   * Nothing actually wanted exactness. The goals are that no family dominates, that the mix
   * is broad, and that repeats are spaced - all of which a proportional target delivers with
   * an enormously larger solution space and no search at all.
   */
  weights: FamilyQuota
  /** Whether a family can fill a given rung at all. */
  eligible: (family: string, profile: RungProfile) => boolean
}

export function planFamilies(seed: number, { weights, eligible }: PlanInput): string[] {
  const families = Object.keys(weights)
  if (!families.length) throw new Error('[iq] no families to plan with')

  const random = rng(seed * 2654435761)

  /**
   * Per-family tie-break weights, drawn once up front.
   *
   * Drawing inside the loop instead would make a rung's choice depend on how many draws had
   * happened before it, which couples every rung to every earlier rung for no benefit and
   * makes a surprising plan much harder to reason about.
   */
  const jitter = new Map(families.map(family => [family, random()]))

  const uses = new Map(families.map(family => [family, 0]))
  const sequenceUses = new Map(families.map(family => [family, 0]))
  const placed = new Map<number, string>()

  /**
   * Spacing checked in BOTH directions, because rungs are no longer filled in order.
   *
   * Looking only backwards was correct while the loop ran 1..26; with scarcest-first ordering
   * a later rung can be placed before an earlier one, and a one-sided check would let two of
   * a family land adjacent without noticing.
   */
  const spacingHolds = (family: string, rung: number, spacing: number): boolean => {
    for (let offset = 1; offset < spacing; offset += 1) {
      if (placed.get(rung - offset) === family) return false
      if (placed.get(rung + offset) === family) return false
    }
    return true
  }

  /**
   * Scarcest rungs first, then rung order.
   *
   * Filling in reading order spends the sequence-capable families on early sequence slots and
   * arrives at rung 26 - which only four families can carry at all - with every one of them
   * already at its cap. That showed up as a 10% outright failure rate, and the error pointed
   * at rung 26 when the mistake was made twenty rungs earlier.
   *
   * Counting eligibility once, up front, is enough: it does not change as the plan fills, and
   * the greedy pass has no backtracking to mislead. This is the same most-constrained-first
   * idea that a search would use, applied where it costs nothing.
   */
  const order = [...LADDER]
    .map(profile => ({
      profile,
      candidates: families.filter(family => eligible(family, profile)).length,
    }))
    .sort((a, b) => a.candidates - b.candidates || a.profile.rung - b.profile.rung)
    .map(entry => entry.profile)

  for (const profile of order) {
    const isSequence = profile.layout.id === '1x3-sequence'

    /**
     * Spacing relaxes rather than fails.
     *
     * Four rungs apart is a preference about how the test FEELS - three of one family in
     * quick succession reads as "the same question again" even when the totals are fine. It
     * is not a correctness property, so when a rung's eligibility leaves nothing four apart,
     * accepting three apart is obviously better than refusing to build the test. The loop
     * gives up ground one rung at a time and records nothing, because a plan that used
     * spacing 3 somewhere is still a good plan.
     */
    let chosen: string | null = null
    for (let spacing = FAMILY_SPACING; spacing >= 1 && !chosen; spacing -= 1) {
      const candidates = families.filter(family => {
        if (!eligible(family, profile)) return false
        if ((uses.get(family) ?? 0) >= MAX_PER_FAMILY) return false
        if (isSequence && (sequenceUses.get(family) ?? 0) >= MAX_SEQUENCE_PER_FAMILY) return false
        return spacingHolds(family, profile.rung, spacing)
      })

      if (!candidates.length) continue

      /**
       * Least-used-relative-to-weight wins.
       *
       * This is what makes the mix track the weights without demanding exact counts: a family
       * with twice the weight is picked once its share falls twice as far behind. Balance
       * emerges from a local rule instead of being imposed by a global constraint, which is
       * why this version is linear where the exact-count version was a search.
       */
      chosen = candidates.sort((a, b) => {
        const shareA = (uses.get(a) ?? 0) / (weights[a] ?? 1)
        const shareB = (uses.get(b) ?? 0) / (weights[b] ?? 1)
        return shareA - shareB || (jitter.get(a) ?? 0) - (jitter.get(b) ?? 0)
      })[0] as string
    }

    if (!chosen) {
      // Not a tight-constraints problem - no family in the vocabulary can build this rung at
      // all. That is a real gap between the ladder and the rules, and it has to be loud.
      throw new Error(
        `[iq] no family can fill rung ${profile.rung} (${profile.layout.id}, ${profile.dimensions}d, composition ${profile.composition})`
      )
    }

    placed.set(profile.rung, chosen)
    uses.set(chosen, (uses.get(chosen) ?? 0) + 1)
    if (isSequence) sequenceUses.set(chosen, (sequenceUses.get(chosen) ?? 0) + 1)
  }

  return Array.from({ length: ITEM_COUNT }, (_, index) => placed.get(index + 1) as string)
}
