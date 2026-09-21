/**
 * Word count and reading time, derived from the stored `bodyHtml`.
 *
 * ## Why this is computed and not stored
 *
 * A `wordCount` column would be a fourth thing the save path has to keep in step with
 * `bodyMarkdown`, `bodyHtml` and `renderedWith`, and the failure of forgetting is a post
 * whose byline claims four minutes and whose JSON-LD claims eleven. The input is a string
 * already in memory on the one page that needs it, so deriving costs a single pass.
 *
 * ## Code blocks are excluded from the count, deliberately
 *
 * A 60-line TypeScript sample is ~300 "words" to a whitespace split and roughly zero seconds
 * of reading for most people - they scan it or skip it. Counting it inflates `timeRequired`
 * on exactly the posts this blog publishes, and a reading time that visibly overstates the
 * page is worse than none: the reader who gave it eight minutes and finished in three trusts
 * the next number less.
 *
 * So both figures describe *prose*, which is also what `wordCount` means to a reader
 * comparing two articles. The tradeoff is that a post which is mostly code reports a small
 * number, and that is the honest description of it.
 *
 * ## 200 words per minute
 *
 * The conventional figure for adult reading of non-fiction, and the one nearly every reading
 * time badge on the web uses. Being consistent with the rest of the web matters more than
 * being precisely right for one audience, because the number is read comparatively.
 */

const WORDS_PER_MINUTE = 200

/** `<pre>` blocks, non-greedy, across newlines. Removed before anything else. */
const PRE_BLOCK = /<pre\b[^>]*>[\s\S]*?<\/pre>/gi
const TAG = /<[^>]+>/g
const ENTITY = /&(?:[a-z]+|#\d+|#x[0-9a-f]+);/gi

/**
 * A token counts as a word if it contains at least one letter or digit.
 *
 * Spelled out as explicit ranges rather than `\p{L}` with the `u` flag, because this repo
 * compiles with `target: es5` and TypeScript rejects unicode property escapes there. The
 * ranges are ASCII alphanumerics plus Latin-1 Supplement, Latin Extended-A/B and Latin
 * Extended Additional - which is every accented form Vietnamese uses, so `được` counts as a
 * word rather than as punctuation.
 *
 * The filter exists so that a stray `-` or `·` left over from stripping markup is not counted
 * as a word. It is a rounding-level correction on a figure rounded to the minute; it is here
 * because getting it wrong on a list-heavy post is not rounding-level.
 */
const HAS_LETTER_OR_DIGIT = /[0-9A-Za-z\u00C0-\u024F\u1E00-\u1EFF]/

/**
 * Words of prose in a rendered post body.
 *
 * Entities collapse to a single space rather than being decoded: `&amp;` and `&nbsp;` are
 * both one token's worth of nothing, and pulling in a decoder to learn that is a dependency
 * for a figure that is rounded to the nearest minute two lines later.
 */
export function countProseWords(html: string): number {
  if (!html) return 0

  const text = html
    .replace(PRE_BLOCK, ' ')
    .replace(TAG, ' ')
    .replace(ENTITY, ' ')

  return text.split(/\s+/).filter(token => HAS_LETTER_OR_DIGIT.test(token))
    .length
}

/** Minutes, never zero - a one-paragraph note still takes a moment. */
export function readingMinutes(words: number): number {
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE))
}

/** ISO 8601 duration, the form `timeRequired` takes in JSON-LD. */
export function readingDuration(minutes: number): string {
  return `PT${minutes}M`
}
