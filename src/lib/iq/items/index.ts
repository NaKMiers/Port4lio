import { ITEM_COUNT } from '@/lib/iq/items/config'
import {
  answerIndexFor as answerIndexForV1,
  generateTest as generateTestV1,
  optionsFor as optionsForV1,
} from '@/lib/iq/items/v1/generate'
import {
  renderMatrix as renderMatrixV1,
  renderOption as renderOptionV1,
} from '@/lib/iq/items/v1/render'
import {
  answerIndexFor as answerIndexForV2,
  generateTest as generateTestV2,
  optionsFor as optionsForV2,
} from '@/lib/iq/items/v2/generate'
import {
  aspectOf as aspectOfV2,
  renderOption as renderOptionV2,
  renderStem as renderStemV2,
} from '@/lib/iq/items/v2/render'

/**
 * The only door into the item engine.
 *
 * ```
 *   seed + generatorVersion ──▶ renderTest()   ──▶ SVG strings for the taker
 *                          └──▶ answerKeyFor() ──▶ option indices for the scorer
 * ```
 *
 * ## Why a facade, and why it returns strings
 *
 * A test is reproduced from a stored seed, so the generator's output for a given seed can
 * never change - a taker who starts before a deploy and submits after it would otherwise be
 * scored against a test they never saw. The seed alone stopped being sufficient the moment a
 * second generator existed: it names a test only in combination with the version that built
 * it. `IqAttempt.generatorVersion` is the other half of that key, and this module is the one
 * place it is interpreted.
 *
 * The return types are deliberately narrow. Only SVG strings and integers cross this
 * boundary - no `Item`, no `Cell`. Two things follow. Versions can disagree completely about
 * how a puzzle is modelled without needing a common supertype to generalise, so a v2 edit
 * has no path to a v1 answer key. And `/api/iq/start` can no longer hold a fully-built
 * `Item` - answers included - in the same scope as the JSON it serialises.
 *
 * ## Adding a version
 *
 * Write `items/vN/`, add a case below, bump `CURRENT_GENERATOR_VERSION`. Do not touch the
 * older directories, and do not "unify" their types with the new one. The frozen surface is
 * not the type definitions - it is the rule pick, the built item and the verify verdict at
 * every attempt index, because `generateItem` accepts the first candidate that verifies, so
 * a stricter check anywhere shifts which attempt wins and therefore what the answer is.
 */

/** What `/api/iq/start` sends. Nothing here is enough to recompute the answer. */
export type RenderedQuestion = {
  /** The question body as inline SVG. Named `matrix` for the wire's sake; v2 layouts are not all matrices. */
  matrix: string
  /** Six option tiles as inline SVG, already in display order. */
  options: string[]
  /**
   * Intrinsic width/height of the question body.
   *
   * On the wire because the client cannot know it: a 3x3 matrix is square, a 1x3 sequence is
   * roughly 4.5:1, and a client that assumes square letterboxes the sequence into a thin
   * strip with large dead bands.
   */
  aspect: number
}

/** The version new attempts are stamped with. */
export const CURRENT_GENERATOR_VERSION = 2

export { ITEM_COUNT }

/**
 * Unknown versions throw rather than falling back.
 *
 * A stored attempt naming a generator we no longer have is unscoreable, and the honest
 * outcome is a 500 that gets noticed. Defaulting to the newest version would score the
 * taker against a different test and return a plausible number instead - the exact failure
 * this whole versioning scheme exists to prevent.
 */
function unknownVersion(version: number): never {
  throw new Error(`[iq] no generator for version ${version}`)
}

export function renderTest(seed: number, version: number): RenderedQuestion[] {
  if (version === 1) {
    const items = generateTestV1(seed)
    return items.map((item, index) => ({
      matrix: renderMatrixV1(item, `${index + 1} / ${items.length}`),
      options: optionsForV1(item, seed, index).map((option, optionIndex) =>
        renderOptionV1(option, `q${index}o${optionIndex}`)
      ),
      // v1 has one layout and it is square. Hardcoded rather than derived because v1 is
      // frozen; deriving it would mean touching the renderer.
      aspect: 1,
    }))
  }

  if (version === 2) {
    const items = generateTestV2(seed)
    return items.map((item, index) => ({
      matrix: renderStemV2(item, `${index + 1} / ${items.length}`),
      options: optionsForV2(item, seed, index).map((option, optionIndex) =>
        renderOptionV2(option, `q${index}o${optionIndex}`)
      ),
      aspect: aspectOfV2(item),
    }))
  }

  return unknownVersion(version)
}

export function answerKeyFor(seed: number, version: number): number[] {
  if (version === 1)
    return generateTestV1(seed).map((item, index) =>
      answerIndexForV1(item, seed, index)
    )

  if (version === 2)
    return generateTestV2(seed).map((item, index) =>
      answerIndexForV2(item, seed, index)
    )

  return unknownVersion(version)
}
