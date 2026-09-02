/**
 * The deterministic PRNG, shared by every generator version and frozen forever.
 *
 * ## Read this before editing anything in this file
 *
 * The sequence of draws IS the answer key. A test is reproduced from a stored integer seed
 * and nothing else, so any change to how numbers come out of `rng` - or to how many of them
 * a helper consumes - retroactively redefines every test ever generated. `/api/iq/submit`
 * recomputes the answer key from `attempt.seed` at submit time, which means a taker who
 * started before such a change and submitted after it is graded against a test they never
 * saw, with a plausible-looking number that means nothing.
 *
 * So: no "improvements" here. Not a better mixing function, not a faster shuffle, not an
 * extra draw to make some call site tidier. `tests/unit/iq-generator-v1-frozen.test.ts`
 * hashes the output of the whole pipeline for twenty seeds and will go red, but the reason
 * it goes red is easy to misread as "the golden table is stale". It is not.
 *
 * Lifted out of `items/types.ts` when the generator was versioned, because `types.ts` is
 * per-version and this is emphatically not.
 */

/**
 * mulberry32.
 *
 * `Math.random` is unusable here: a result page must re-render the exact test somebody sat,
 * and the only thing stored is the seed. Small, fast, and good enough for choosing shapes -
 * this is not cryptography, and the share/result tokens that DO need entropy use
 * `crypto.randomBytes` in `lib/tokens.ts`.
 */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** One draw. Consumes exactly one number, which is part of the frozen contract. */
export function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)] as T
}

/**
 * Fisher-Yates. Consumes exactly `items.length - 1` draws.
 *
 * The draw count matters as much as the result: this runs in `optionsFor`, so the number of
 * numbers it pulls determines where the answer lands among the six options.
 */
export function shuffle<T>(random: () => number, items: readonly T[]): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j] as T, out[i] as T]
  }
  return out
}
