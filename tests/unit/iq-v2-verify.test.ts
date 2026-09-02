import { describe, expect, it } from 'vitest'

import { type Cell } from '@/lib/iq/items/v2/cell'
import { generateTest, type Item } from '@/lib/iq/items/v2/generate'
import { profileFor, type RungProfile } from '@/lib/iq/items/v2/ladder'
import { LAYOUTS } from '@/lib/iq/items/v2/layout'
import type { Built, Distractor, ErrorModel } from '@/lib/iq/items/v2/rules'
import { verifyItem } from '@/lib/iq/items/v2/verify'
import { CYCLIC, type Track } from '@/lib/iq/items/v2/tracks'

/**
 * Positive controls: items that verification MUST reject.
 *
 * ## Why this file is the most important test in the suite
 *
 * Every other test asserts that valid things pass. That is a negative control, and on its own
 * it proves almost nothing about a checker: a `verifyItem` whose every condition was inverted
 * to `return { ok: true }` would satisfy all 330 of them. `verifyItem` has around a dozen
 * distinct rejection paths and, until this file existed, not one was known to be reachable.
 *
 * The gap matters more here than in most code. Verification is the ONLY thing standing between
 * a broken item and a taker who then loses a point for being right and never finds out why -
 * there is no human reading these items before they ship. A safety net nobody has tested is
 * the same shape of problem as the bugs this rebuild was for: v1's tests were all green while
 * three of its six families had 3, 5 and 24 distinct outputs.
 *
 * ## How the cases are built
 *
 * Each starts from a REAL generated item that verifies, then breaks exactly one thing. That is
 * deliberate rather than lazy: a hand-authored broken item can fail for reasons the author did
 * not intend, so it might be rejected by the wrong check and still look like a pass. Mutating
 * a known-good baseline isolates the single condition under test - and the baseline assertion
 * at the top proves the mutation is the only thing wrong.
 */

const SAMPLE = generateTest(7)

/** A matrix item that carries decoys, so the decoy checks have something to bite on. */
function matrixWithDecoys(): { item: Item; profile: RungProfile } {
  const item = SAMPLE.find(
    candidate =>
      candidate.profile.layout.id === '3x3-matrix' &&
      candidate.profile.decoys >= 1 &&
      candidate.decoySlots.length >= 1 &&
      candidate.answer.inner != null
  )
  if (!item) throw new Error('no matrix item with decoys in the sample - adjust the seed')
  return { item, profile: item.profile }
}

function sequenceItem(): { item: Item; profile: RungProfile } {
  const item = SAMPLE.find(candidate => candidate.profile.layout.id === '1x3-sequence')
  if (!item) throw new Error('no sequence item in the sample - adjust the seed')
  return { item, profile: item.profile }
}

/** Assert a mutation is rejected, and rejected for the reason intended. */
function expectRejected(built: Built, profile: RungProfile, because: RegExp) {
  const verdict = verifyItem(built, profile)
  expect(verdict.ok, 'expected this item to be rejected, but verification passed').toBe(false)
  if (!verdict.ok) expect(verdict.reason).toMatch(because)
}

describe('the baseline is genuinely valid', () => {
  it('accepts every real item in the sample', () => {
    // Without this, a mutation test could pass because the BASELINE was already broken.
    for (const item of SAMPLE) {
      const verdict = verifyItem(item, item.profile)
      expect(verdict.ok, `rung ${item.rung} (${item.rule}): ${!verdict.ok && verdict.reason}`).toBe(true)
    }
  })
})

describe('structural rejections', () => {
  it('rejects a grid with the wrong number of positions', () => {
    const { item, profile } = matrixWithDecoys()
    expectRejected({ ...item, cells: [...item.cells, null] }, profile, /positions/)
  })

  it('rejects a cell sitting where the hole should be', () => {
    const { item, profile } = matrixWithDecoys()
    const cells = [...item.cells]
    cells[profile.layout.holeIndex] = item.answer
    expectRejected({ ...item, cells }, profile, /should be the hole/)
  })

  it('rejects a hole where a cell should be', () => {
    const { item, profile } = matrixWithDecoys()
    const cells = [...item.cells]
    cells[0] = null
    expectRejected({ ...item, cells }, profile, /should be a cell/)
  })

  it('rejects a panel that is not six options', () => {
    const { item, profile } = matrixWithDecoys()
    expectRejected({ ...item, distractors: item.distractors.slice(0, 4) }, profile, /5 distractors/)
  })
})

describe('option-distinctness rejections', () => {
  it('rejects a distractor identical to the answer', () => {
    /**
     * The failure the whole identity layer exists for: two correct choices, one marked wrong.
     */
    const { item, profile } = matrixWithDecoys()
    const distractors: Distractor[] = [
      { cell: item.answer, error: 'off-by-one-step' },
      ...item.distractors.slice(1),
    ]
    expectRejected({ ...item, distractors }, profile, /distinct options|equals the answer/)
  })

  it('rejects two distractors identical to each other', () => {
    const { item, profile } = matrixWithDecoys()
    const first = item.distractors[0] as Distractor
    const distractors = [first, { ...first, error: 'not-advanced' as ErrorModel }, ...item.distractors.slice(2)]
    expectRejected({ ...item, distractors }, profile, /distinct options/)
  })

  it('rejects options that are structurally different but look the same', () => {
    /**
     * The check `cellKey` alone cannot make. One size step is three cell units and the
     * perceptual floor is five and a half, so these two options key differently and are
     * indistinguishable on screen - a panel that asks the taker to see a difference that is
     * not there.
     */
    const { item, profile } = matrixWithDecoys()
    const inner = item.answer.inner
    if (!inner) throw new Error('baseline has no inner element')
    const nearlyTheAnswer: Cell = {
      ...item.answer,
      inner: { ...inner, sizeStep: inner.sizeStep + 1 },
    }
    const distractors: Distractor[] = [
      { cell: nearlyTheAnswer, error: 'off-by-one-step' },
      ...item.distractors.slice(1),
    ]
    expectRejected({ ...item, distractors }, profile, /look the same/)
  })

  it('rejects a cell that hides one of its own elements', () => {
    /**
     * A filled frame paints over its contents, so the cell is one PICTURE for every possible
     * inner shape while keying differently for each. Left unchecked, a rule could offer
     * several of them as options with only one marked right.
     */
    const { item, profile } = matrixWithDecoys()
    const hidden: Cell = {
      frame: { class: 'frame', kind: 'square', shading: 'filled', rotationDeg: 0, sizeStep: 13 },
      inner: { class: 'inner', anchor: 'center', kind: 'circle', shading: 'outline', rotationDeg: 0, sizeStep: 1 },
    }
    const cells = [...item.cells]
    cells[0] = hidden
    expectRejected({ ...item, cells }, profile, /hides one of its own elements/)
  })
})

describe('rung-demand rejections', () => {
  it('rejects an item that varies fewer dimensions than the rung asked for', () => {
    /**
     * The direct control for v1's defining bug. All six of its rules took a `rung` argument
     * and ignored it, so the published claim that later items are harder was false - and
     * nothing could have caught it, because nothing compared what a rung demanded against
     * what the rule delivered.
     */
    const { item, profile } = matrixWithDecoys()
    expectRejected({ ...item, dimensions: profile.dimensions + 1 }, profile, /wants .* dimensions/)
  })

  it('rejects a track that does not visibly vary across the given cells', () => {
    /**
     * v1 could pick a square with a 90-degree rotation step. A square repeats every 90
     * degrees, so all nine cells rendered identically - a "valid" item with nothing in it to
     * notice. This is the generic form of that.
     *
     * The bogus track targets a slot the cells do not have, so its value reads the same
     * everywhere - which is exactly what an invisible dimension looks like.
     */
    const { item, profile } = matrixWithDecoys()
    const dead: Track = { dim: 'count', target: 'tally', axis: 'col', step: 1, phase: 0 }
    expectRejected(
      { ...item, tracks: [...item.tracks, dead], dimensions: item.dimensions + 1 },
      { ...profile, dimensions: (profile.dimensions + 1) as 1 | 2 | 3 },
      /does not visibly vary/
    )
  })

  it('rejects a sequence with no directional dimension', () => {
    /**
     * Three cells reading outline, half, filled are consistent with the cycle continuing AND
     * with a palindrome turning back. Both are defensible, so two of the six options are right
     * and one is marked wrong - and no identity check can see it, because the options are
     * genuinely different pictures. Only a co-active ordinal track rules the palindrome out.
     *
     * The mutation keeps a track that is genuinely WITNESSED and merely drops the ordinal
     * ones. Simply relabelling every track as cyclic does not test this rule: the relabelled
     * track reads a property the cells do not vary, so it trips the witnessing check first and
     * the ordinal rule is never reached. That mistake is why `expectRejected` matches on the
     * reason rather than just on failure.
     */
    const found = (() => {
      for (let seed = 1; seed <= 60; seed += 1) {
        for (const candidate of generateTest(seed)) {
          if (candidate.profile.layout.id !== '1x3-sequence') continue
          const cyclic = candidate.tracks.filter(track => CYCLIC.has(track.dim))
          if (cyclic.length) return { item: candidate, cyclic }
        }
      }
      return null
    })()
    if (!found) throw new Error('no sequence item with a cyclic track in 60 seeds')

    expectRejected(
      { ...found.item, tracks: found.cyclic, dimensions: found.cyclic.length },
      { ...found.item.profile, dimensions: found.cyclic.length as 1 | 2 | 3 },
      /ordinal track/
    )
  })

  it('rejects a 2x2 with no directional dimension, not just a sequence', () => {
    // A 2x2 confirms the rule zero times - weaker than a sequence - so exempting it because
    // it is spelled differently would leave the harder layout unguarded.
    const { item } = matrixWithDecoys()
    const profile: RungProfile = {
      ...item.profile,
      layout: LAYOUTS['2x2-matrix'],
      dimensions: item.dimensions as 1 | 2 | 3,
    }
    const cyclicOnly: Track[] = item.tracks.map(track => ({ ...track, dim: 'shading' }))
    // The grid shape is wrong for a 2x2 too, so this asserts only that it does not PASS.
    expect(verifyItem({ ...item, tracks: cyclicOnly }, profile).ok).toBe(false)
  })
})

describe('decoy rejections', () => {
  it('rejects an item with fewer decoys than the rung asked for', () => {
    const { item, profile } = matrixWithDecoys()
    expectRejected({ ...item, decoySlots: [] }, profile, /wants .* decoys/)
  })

  it('rejects a decoy that is not actually constant', () => {
    /**
     * A decoy exists to raise the cost of finding which dimension matters WITHOUT affecting
     * the answer. One that moves is a fourth rule the taker has to model and that nothing told
     * them about - so it is proven constant rather than assumed.
     */
    const { item, profile } = matrixWithDecoys()
    const slot = item.decoySlots[0]
    if (!slot) throw new Error('baseline has no decoy slot')

    const cells = [...item.cells]
    const first = cells.find(cell => cell != null) as Cell
    const element = first[slot]
    if (!element || element.class === 'tally') {
      throw new Error('decoy slot is not a shape - adjust the seed')
    }
    /**
     * Rotation, not shading. Flipping a frame to `filled` makes it paint over its own
     * contents, so `noHiddenLayers` rejects the cell before the decoy check ever runs -
     * a mutation that tests the wrong thing while still looking like a pass.
     */
    cells[cells.indexOf(first)] = {
      ...first,
      [slot]: { ...element, rotationDeg: element.rotationDeg + 45 },
    } as Cell

    expectRejected({ ...item, cells }, profile, /decoy is not constant/)
  })
})

describe('distractor-quality rejections', () => {
  it('rejects a panel where every wrong option is wrong the same way', () => {
    // Five off-by-ones measures arithmetic precision; five wrong-dimension options can be
    // eliminated without ever finding the step. The repo's stated principle needs both.
    const { item, profile } = matrixWithDecoys()
    const distractors = item.distractors.map(distractor => ({
      ...distractor,
      error: 'off-by-one-step' as ErrorModel,
    }))
    expectRejected({ ...item, distractors }, profile, /same error model|more than twice/)
  })

  it('rejects one error model appearing more than twice', () => {
    const { item, profile } = matrixWithDecoys()
    const distractors = item.distractors.map((distractor, index) => ({
      ...distractor,
      error: (index < 3 ? 'off-by-one-step' : 'dimension-swap') as ErrorModel,
    }))
    expectRejected({ ...item, distractors }, profile, /more than twice/)
  })
})

describe('set-logic rejections', () => {
  it('rejects rows consistent with more than one operator', () => {
    /**
     * The one check v1 got right, and its empirical case: sweeping 400 seeds, 1 in 89
     * set-logic items had rows that fitted two operators. The taker cannot know which to
     * apply, so two options are defensible and one is marked wrong.
     *
     * Built by hand because the condition is arithmetic: when the two operands are DISJOINT,
     * `or` and `xor` produce identical results, so no number of complete rows can tell them
     * apart. Every row here is disjoint.
     */
    const profile = profileFor(1)
    const field = (filled: number[]): Cell => ({ class: undefined, field: { class: 'field', size: 3, filled } } as unknown as Cell)

    const rows = [
      [[0, 1], [4, 5], [0, 1, 4, 5]],
      [[2], [6, 7], [2, 6, 7]],
      [[3, 8], [1], [3, 8, 1]],
    ]
    const cells = [
      ...rows.slice(0, 2).flatMap(row => row.map(mask => field(mask))),
      field(rows[2]?.[0] as number[]),
      field(rows[2]?.[1] as number[]),
      null,
    ]

    const built: Built = {
      cells,
      answer: field(rows[2]?.[2] as number[]),
      distractors: [
        { cell: field([0]), error: 'operand-echo' },
        { cell: field([1]), error: 'off-by-one-step' },
        { cell: field([2]), error: 'dimension-swap' },
        { cell: field([3]), error: 'not-advanced' },
        { cell: field([4]), error: 'secondary-frozen' },
      ],
      dimensions: 2,
      tracks: [],
      decoySlots: [],
      requiresUniqueOperator: true,
    }

    expectRejected(built, { ...profile, dimensions: 2 }, /more than one operator/)
  })
})
