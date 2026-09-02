/**
 * Numbers that describe the test itself rather than any one generator.
 *
 * Its own module because `ITEM_COUNT` used to live in `items/generate.ts`, and the generator
 * is now versioned. Left there, 26 would have become a per-version number the moment a
 * second version existed - and `parseIqAnswers` in `lib/iq/scoring.ts` validates submitted
 * payload length against it, so a version-dependent 26 would mean a payload that is valid
 * for one generator and rejected for another.
 *
 * The test length is a property of the product. Which puzzles fill those 26 slots is a
 * property of a generator. This file is the former.
 */

/**
 * How many items a test has.
 *
 * Changing this is a breaking change for every stored attempt, not a tuning knob:
 * `parseIqAnswers` rejects any payload whose length differs, and `BANDS` in
 * `lib/iq/scoring.ts` maps raw totals on the assumption of a 26-item ceiling.
 */
export const ITEM_COUNT = 26
