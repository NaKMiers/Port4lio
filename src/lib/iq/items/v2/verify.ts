import { cellKey, noHiddenLayers, perceptuallyDistinct, type Cell } from '@/lib/iq/items/v2/cell'
import type { RungProfile } from '@/lib/iq/items/v2/ladder'
import { coordsOf, positionCount } from '@/lib/iq/items/v2/layout'
import { ORDINAL, trackIsWitnessed } from '@/lib/iq/items/v2/tracks'
import type { Built } from '@/lib/iq/items/v2/rules'

/**
 * Prove an item is answerable before anyone sees it.
 *
 * A hand-authored test gets read by a human before it ships. A generated one does not: a
 * broken item goes straight to a taker, who loses a point for being right and never finds
 * out why. This is the only thing standing in that gap.
 *
 * ## What v1 checked, and what it missed
 *
 * v1 proved the six options were structurally distinct, plus one special case for set-logic.
 * That is necessary and nowhere near sufficient. Everything below except the first two checks
 * is new, and each corresponds to a way an item can be broken that structural distinctness
 * cannot see:
 *
 * ```
 *   two options render alike        ─▶ perceptual distinctness, not just cellKey
 *   a cell hides its own contents   ─▶ noHiddenLayers
 *   a "varying" dimension is static ─▶ track witnessing
 *   a "constant" decoy moves        ─▶ decoy constancy
 *   the rung asked for 3 dims,
 *     the rule delivered 1          ─▶ the profile-match check
 *   a sequence with no direction    ─▶ the ordinal-track requirement
 * ```
 *
 * The last two are the ones that make the published difficulty claim honest rather than
 * decorative, and the profile-match check is the direct test for v1's defining bug - six
 * rules that took a `rung` argument and ignored it.
 */

export type VerifyResult = { ok: true } | { ok: false; reason: string }

const OPS = {
  and: (a: boolean, b: boolean) => a && b,
  or: (a: boolean, b: boolean) => a || b,
  xor: (a: boolean, b: boolean) => a !== b,
}

/**
 * Exactly one operator explains every complete row.
 *
 * Reads the lattices straight off the cells rather than trusting what the family says it
 * built, which is the whole point of putting it here.
 */
function operatorIsUnique(built: Built): boolean {
  const rows: [Set<number>, Set<number>, Set<number>][] = []
  const cols = 3

  for (let row = 0; row < 3; row += 1) {
    const trio = [0, 1, 2].map(col => built.cells[row * cols + col]?.field)
    // The last row is the incomplete one; only complete rows are evidence.
    if (trio.some(field => !field)) continue
    rows.push(trio.map(field => new Set(field?.filled ?? [])) as [Set<number>, Set<number>, Set<number>])
  }

  if (rows.length < 2) return false

  const total = 9
  const consistent = (Object.keys(OPS) as (keyof typeof OPS)[]).filter(op =>
    rows.every(([a, b, c]) => {
      for (let i = 0; i < total; i += 1) {
        if (OPS[op](a.has(i), b.has(i)) !== c.has(i)) return false
      }
      return true
    })
  )

  return consistent.length === 1
}

function fail(reason: string): VerifyResult {
  return { ok: false, reason }
}

export function verifyItem(built: Built, profile: RungProfile): VerifyResult {
  const { layout } = profile
  const positions = positionCount(layout)

  if (built.cells.length !== positions) {
    return fail(`${layout.id} has ${positions} positions, got ${built.cells.length}`)
  }

  for (let index = 0; index < positions; index += 1) {
    const filled = built.cells[index] != null
    if (filled === (index === layout.holeIndex)) {
      return fail(`position ${index} should be ${index === layout.holeIndex ? 'the hole' : 'a cell'}`)
    }
  }

  if (built.distractors.length !== 5) {
    return fail(`expected 5 distractors, got ${built.distractors.length}`)
  }

  const options: Cell[] = [built.answer, ...built.distractors.map(d => d.cell)]

  // Sorting the key throws away paint order, which is only sound while no element can hide
  // another - so this check is what licenses the key, not an extra nicety.
  for (const [index, cell] of Array.from(built.cells.entries())) {
    if (cell && !noHiddenLayers(cell)) return fail(`cell ${index} hides one of its own elements`)
  }
  for (const cell of options) {
    if (!noHiddenLayers(cell)) return fail('an option hides one of its own elements')
  }

  const keys = new Set(options.map(cellKey))
  if (keys.size !== 6) return fail(`expected 6 distinct options, got ${keys.size}`)

  /**
   * Structural distinctness is necessary but NOT sufficient.
   *
   * Two cells one size step apart, or ten degrees of rotation apart, key differently and look
   * identical at render size. A panel built on `cellKey` alone can be perfectly valid and
   * still ask the taker to see a difference that is not there.
   */
  for (let i = 0; i < options.length; i += 1) {
    for (let j = i + 1; j < options.length; j += 1) {
      if (!perceptuallyDistinct(options[i] as Cell, options[j] as Cell)) {
        return fail(`options ${i} and ${j} are structurally different but look the same`)
      }
    }
  }

  // The rung's demand, met rather than ignored. v1's whole vocabulary failed this.
  if (built.dimensions !== profile.dimensions) {
    return fail(`rung ${profile.rung} wants ${profile.dimensions} dimensions, got ${built.dimensions}`)
  }

  /**
   * For set logic, the operator has to be inferable from the two COMPLETE rows.
   *
   * Distinct options are not enough here, and this is the one check v1 got right. If rows 1
   * and 2 are consistent with both OR and XOR, the taker cannot know which to apply to row 3,
   * so two of the six options are defensible and one is marked wrong. The item punishes
   * correct reasoning, which is worse than an item that is merely hard.
   *
   * v1 found this empirically: sweeping 400 seeds, 1 in 89 set-logic items was ambiguous this
   * way - roughly one unfair question per three takers over a 26-item test.
   */
  if (built.requiresUniqueOperator && !operatorIsUnique(built)) {
    return fail('the given rows are consistent with more than one operator')
  }

  for (const track of built.tracks) {
    if (!trackIsWitnessed(track, layout, built.cells)) {
      return fail(`the ${track.dim} track does not visibly vary across the given cells`)
    }
  }

  /**
   * A layout that confirms the rule fewer than twice needs a directional dimension.
   *
   * Without one, three cells showing `outline, half, filled` are consistent with the cycle
   * continuing to `outline` AND with a palindrome turning back to `half`. Both are
   * defensible, so two of the six options are right and one of them is marked wrong - and no
   * identity check can see it, because the options are genuinely distinct pictures.
   *
   * Applied by `confirmations`, not by layout name. The 1x3 sequence is the obvious case, but
   * a 2x2 is weaker still - it gives a row step and a column step and confirms NEITHER - so
   * exempting it because it is spelled differently would leave the harder layout unguarded.
   */
  if (layout.confirmations < 2 && !built.tracks.some(track => ORDINAL.has(track.dim))) {
    return fail(`${layout.id} confirms the rule ${layout.confirmations} times, so it needs an ordinal track to pin the reading direction`)
  }

  if (built.decoySlots.length < profile.decoys) {
    return fail(`rung ${profile.rung} wants ${profile.decoys} decoys, got ${built.decoySlots.length}`)
  }

  /**
   * A decoy that varies is an undeclared dimension.
   *
   * The point of a decoy is that it raises the cost of finding which dimension matters
   * WITHOUT affecting the answer. One that moves is a fourth rule the taker has to model and
   * that nothing told them about, so it has to be proven constant rather than assumed.
   */
  for (const slot of built.decoySlots) {
    const values = new Set<string>()
    for (const cell of built.cells) {
      if (cell) values.add(JSON.stringify(cell[slot] ?? null))
    }
    values.add(JSON.stringify(built.answer[slot] ?? null))
    if (values.size > 1) return fail(`the ${slot} decoy is not constant`)
  }

  /**
   * Both failure modes on the panel.
   *
   * A panel of five off-by-ones measures arithmetic precision; a panel of five
   * wrong-dimension options can be eliminated without ever finding the step. The repo's
   * stated distractor principle only holds if both are present, so it is checked.
   */
  const models = new Set(built.distractors.map(distractor => distractor.error))
  if (models.size < 2) return fail('every distractor uses the same error model')

  const tally = new Map<string, number>()
  for (const { error } of built.distractors) {
    tally.set(error, (tally.get(error) ?? 0) + 1)
    if ((tally.get(error) ?? 0) > 2) return fail(`the ${error} error model appears more than twice`)
  }

  /**
   * The answer must not be reachable by a distractor's own mistake.
   *
   * If applying an error model to the correct reasoning lands back on the answer, then that
   * "wrong" option is a second right answer - and the taker who made the mistake is marked
   * correct while the panel is one option short of the six it claims.
   */
  const answerKey = cellKey(built.answer)
  for (const { cell, error } of built.distractors) {
    if (cellKey(cell) === answerKey) return fail(`the ${error} distractor equals the answer`)
  }

  void coordsOf
  return { ok: true }
}
