/**
 * When a result is given away because the attempt behind it does not measure anything.
 *
 * ```
 *   submit ──▶ score ──▶ effort check ──┬─ invalid ──▶ waived: true  ──▶ free result
 *                                       └─ genuine ──▶ waived: false ──▶ paywall
 * ```
 *
 * ## The rule, stated once
 *
 * A visitor who clicks through a test in ninety seconds is not taking a test - they are
 * checking whether the site charges. Their score is noise, and selling a noise score is
 * selling nothing. So the result is free, the reason is printed on the page, and they are
 * invited to take it properly.
 *
 * This is a validity rule, not a discount. Framed as "we charge more when you try harder"
 * it would be indefensible; framed as "we do not charge for a number we cannot stand
 * behind" it is something we can publish - and publishing it is what makes it safe to be
 * discovered, because the free version is by construction the worthless one.
 *
 * ## Why speed alone is the wrong signal
 *
 * Able takers finish fast AND score well. A pure stopwatch rule would waive payment for
 * exactly the people most likely to want a certificate, and tell them they had not tried.
 * So speed only ever appears in combination with a validity signal.
 *
 * The signals also differ by product because the products differ:
 *
 * ```
 *   IQ    right answers exist  ──▶ score at chance + rushed or mostly skipped
 *   MBTI  no right answers     ──▶ the answer PATTERN itself (straight-lining)
 * ```
 *
 * MBTI has no server-side clock - its row is created at submit - so it uses no clock at
 * all rather than a client-reported duration, which would be a one-line devtools bypass
 * for a product with nothing held back behind it.
 *
 * ## Self-enforcing by design
 *
 * Both rules share the property that matters: to get a free result you must submit answers
 * that make the result worthless. To get YOUR result you have to answer honestly, and an
 * honest attempt pays. There is no version of gaming this that returns something the gamer
 * wanted.
 *
 * Both err toward generosity. A false positive costs one sale; a false negative charges
 * someone for noise, which is the failure that damages trust.
 */

/**
 * The most correct answers a guesser is expected to stumble into.
 *
 * Chance on 26 six-option items is 26/6 ≈ 4.3, with a standard deviation near 1.9. Six is
 * about one SD above chance: comfortably inside "guessed", and far below the 10 correct
 * that scores an even 100.
 */
export const IQ_CHANCE_CEILING = 6

/** Five minutes of the twenty-four allowed. Twelve seconds an item, including reading. */
export const IQ_RUSH_SECONDS = 5 * 60

/** Skipping this share of the test is the other way to answer nothing. */
export const IQ_SKIP_FRACTION = 0.5

export type IqEffortInput = {
  /** Correct answers, as scored. */
  raw: number
  /** One option index per item; -1 is a skip. */
  answers: readonly number[]
  startedAt: Date
  submittedAt: Date
}

/**
 * Whether an IQ attempt is too poor a measurement to charge for.
 *
 * Both halves are required. A chance-level score reached over twenty careful minutes IS a
 * measurement - a low one, honestly obtained - and it is charged for like any other. A fast
 * attempt that scores well is charged for too, because it measured something real.
 *
 * The clock is server-side (`startedAt` is written by `/api/iq/start`, never by the
 * browser), so the speed half cannot be faked. The accuracy half cannot be faked in any
 * useful direction: answering well enough to pay is the same thing as earning a real score.
 */
export function iqEffortWaived({ raw, answers, startedAt, submittedAt }: IqEffortInput): boolean {
  if (raw > IQ_CHANCE_CEILING) return false

  const elapsedSeconds = (submittedAt.getTime() - startedAt.getTime()) / 1000
  const skipped = answers.filter(answer => answer < 0).length

  return elapsedSeconds < IQ_RUSH_SECONDS || skipped >= answers.length * IQ_SKIP_FRACTION
}

/**
 * How much of the test one answer key may cover before the pattern stops being an opinion.
 *
 * 0.9 of 60 is 54 identical answers. A real profile, even a decisive one, varies across
 * sixty differently-worded items; 54 of one letter is a held-down button.
 */
export const MBTI_STRAIGHT_LINE_SHARE = 0.9

/**
 * The longest repeating cycle treated as mechanical rather than meant.
 *
 * Covers the patterns a hand produces without reading: all one side (period 1), left-right
 * alternating (2), and the short drum rolls in between. A real set of sixty answers being
 * *exactly* periodic at this length happens with probability around one in 10^16, so this
 * costs effectively nothing in false positives.
 */
const MBTI_MAX_MECHANICAL_PERIOD = 4

/** Below this many answers, periodicity is meaningless. MBTI always submits sixty. */
const MBTI_MIN_ANSWERS_FOR_PERIOD = MBTI_MAX_MECHANICAL_PERIOD * 4

export type MbtiEffortInput = {
  /** 'a' / 'b', positionally aligned to the questions. */
  answers: readonly string[]
}

/**
 * Whether an MBTI attempt is a pattern rather than a set of answers.
 *
 * Two triggers, because the two things a masher does look nothing alike in the totals:
 *
 * ```
 *   aaaa…  ─▶ 60 of one letter   ─▶ share trigger
 *   abab…  ─▶ an innocent 30/30  ─▶ periodicity trigger
 * ```
 *
 * Alternating is the one worth having: its totals are perfectly balanced, so a share
 * threshold alone misses it completely.
 *
 * ## Why periodicity and not "every axis is unanimous"
 *
 * The first version asked whether all four axes came back one-sided. Worth being precise
 * about what changed, because it is less than it looks: with four interleaved axes,
 * "answer depends only on the axis" and "the sequence repeats every four" are the SAME
 * condition, so the two rules agree exactly on period-4 patterns. Periodicity is a strict
 * superset - it adds period 1, 2 and 3, and a period-3 roll leaves the axes looking varied
 * while being just as mechanical.
 *
 * So this is not a false-positive fix; it is broader coverage and a rule that says what it
 * means. The residual false positive is unchanged: a taker who answers all fifteen items
 * identically on all four dimensions is flagged as mechanical. Across fifteen differently
 * worded items per axis that is vanishingly rare, and when it happens it costs one sale -
 * the direction this is supposed to fail in.
 */
export function mbtiEffortWaived({ answers }: MbtiEffortInput): boolean {
  if (answers.length === 0) return false

  const totals = new Map<string, number>()
  for (const answer of answers) totals.set(answer, (totals.get(answer) ?? 0) + 1)

  const largest = Math.max(...Array.from(totals.values()))
  if (largest >= answers.length * MBTI_STRAIGHT_LINE_SHARE) return true

  if (answers.length < MBTI_MIN_ANSWERS_FOR_PERIOD) return false

  for (let period = 1; period <= MBTI_MAX_MECHANICAL_PERIOD; period += 1) {
    let repeats = true
    for (let index = period; index < answers.length; index += 1) {
      if (answers[index] !== answers[index - period]) {
        repeats = false
        break
      }
    }
    if (repeats) return true
  }

  return false
}
