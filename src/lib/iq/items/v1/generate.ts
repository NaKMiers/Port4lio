import { ITEM_COUNT } from '@/lib/iq/items/config'
import { rulesForRung } from '@/lib/iq/items/v1/rules'
import { pick, rng, shuffle, type Item } from '@/lib/iq/items/v1/types'
import { verifyItem } from '@/lib/iq/items/v1/verify'

/**
 * One verified item for a rung, from a seed.
 *
 * ```
 *   seed + rung ──▶ pick a rule eligible at this rung
 *                        │
 *                        ▼
 *                   build item ──▶ verify ──┬─ ok ──▶ return
 *                        ▲                  │
 *                        └── next attempt ──┘ (up to MAX_ATTEMPTS)
 * ```
 *
 * Generate-then-verify rather than generate-carefully. Some rules can produce a degenerate
 * instance by chance - set-logic with two empty operand grids gives an empty answer that
 * collides with a distractor - and enumerating those cases per rule would be both fiddly
 * and easy to leave incomplete. Rejecting and retrying is simpler and catches the cases
 * nobody thought of, which is the point.
 */

const MAX_ATTEMPTS = 40

export function generateItem(seed: number, rung: number): Item {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const random = rng(seed * 7919 + attempt * 104729 + rung * 31)
    const rule = pick(random, rulesForRung(rung))
    const built = rule.build(random, rung)
    const item: Item = { ...built, rule: rule.name, rung }
    if (verifyItem(item).ok) return item
  }

  // Falling through means a rung's whole rule set failed 40 times, which is a bug in a
  // rule, not bad luck. Throwing is right: shipping an unverified item to a taker is worse
  // than a loud failure, and `tests/unit/iq-items.test.ts` walks every rung to make sure
  // this never fires in practice.
  throw new Error(`[iq] could not generate a verified item for rung ${rung} after ${MAX_ATTEMPTS} attempts`)
}

/**
 * A whole test: 26 items on a rising difficulty ladder.
 *
 * The ladder is what makes a raw score meaningful. Early rungs vary one dimension, later
 * ones allow rules that need two or three tracked at once, so getting item 24 right is
 * genuinely worth more than item 2 - and a raw total is therefore a defensible ordering
 * even without item-level calibration. See `norming.ts` for what the total maps to.
 */
export function generateTest(seed: number): Item[] {
  return Array.from({ length: ITEM_COUNT }, (_, index) => {
    const rung = index + 1
    return generateItem(seed + index, rung)
  })
}

/** Options in display order, deterministic per seed so a re-render matches what was sat. */
export function optionsFor(item: Item, seed: number, index: number): Item['answer'][] {
  return shuffle(rng(seed + index * 977), [item.answer, ...item.distractors])
}

/** Where the answer sits after shuffling. The scorer compares against this, never a label. */
export function answerIndexFor(item: Item, seed: number, index: number): number {
  const options = optionsFor(item, seed, index)
  return options.indexOf(item.answer)
}
