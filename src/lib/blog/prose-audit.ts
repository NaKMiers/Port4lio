/**
 * Read the post back and measure it against the brief that asked for it.
 *
 * ```
 *   buildGenerationPrompt ──▶ model ──▶ bodyMarkdown
 *                                            │
 *                                       auditProse   ← HERE. deterministic, no second call.
 *                                            │
 *                                        warnings ──▶ the editor, as a list of tasks
 * ```
 *
 * ## Why this file exists
 *
 * `parseGeneratedDraft` already refuses to write a kind, a series, a tag or a related slug
 * because the model said so - the header on `generate.ts` calls that the trust boundary and is
 * emphatic about it. And then it accepted the prose, which is the entire product, completely
 * unchecked. Every style rule in the brief was advice with nothing behind it.
 *
 * A real generation was audited by hand afterwards and broke four rules it had been given:
 * an invented date inside a code comment, an invented latency figure, three parallel sections
 * with parallel headings, and a closing section that restated the post. Nothing in the pipeline
 * noticed any of it. That is what this file is for - not to block the save, but to make sure
 * the author is told.
 *
 * ## Warnings, never refusals
 *
 * Same doctrine as the rest of `parseGeneratedDraft`: a post with one fabricated number is a
 * good post with one thing to cut, and throwing away a paid generation to punish it is the
 * wrong trade. Every finding here is a task in the editor, phrased so the author can act on it
 * without re-reading the brief.
 *
 * ## Why deterministic rather than a second model call
 *
 * An LLM judging its own output costs another twenty seconds and another completion, and it is
 * unreliable on exactly the checks that matter most here - a model that just wrote three
 * parallel sections does not reliably notice that it wrote three parallel sections. Regexes
 * are worse at nuance and perfect at counting, and counting is what every check below does.
 */

export type ProseFinding = {
  /** Stable identifier. Tests assert on this; the message is free to be reworded. */
  code:
    | 'em-dash'
    | 'banned-phrase'
    | 'parallel-sections'
    | 'recap-section'
    | 'repeated-opening'
    | 'unsourced-specific'
    | 'no-specifics'
  message: string
}

export type AuditInput = {
  bodyMarkdown: string
  language: 'vi' | 'en'
  /** The author's supplied material, or empty. A specific found in here is sourced. */
  evidence: string
  /** Resolved structure. Some shapes legitimately repeat their headings - see `PARALLEL_OK`. */
  structure: string
}

/**
 * Structures whose sections are SUPPOSED to be parallel.
 *
 * A reference is a list of entries a reader arrives at from a search and leaves after one, a
 * digest is items in a fixed repeating shape, and a numbered list is a numbered list. Running
 * the parallel-sections check over those would fire on every one of them, and a check that
 * fires on correct output is a check the author learns to ignore - which costs the checks that
 * are right.
 */
const PARALLEL_OK = new Set([
  'reference',
  'digest',
  'numbered-list',
  'tutorial',
])

/**
 * Phrases checkable by exact match, drawn from the tells in `brief.ts`.
 *
 * A deliberate subset. Most of the brief's rules are about shape and register and cannot be
 * grepped; these are the ones where the string itself is the failure, so a match is certain
 * rather than suggestive.
 */
const BANNED_PHRASES: Record<'vi' | 'en', string[]> = {
  en: [
    'delve',
    "in today's fast-paced",
    'it is worth noting',
    'in conclusion',
    'game-changer',
    'seamless',
    'but here is the thing',
  ],
  vi: [
    'trong thời đại công nghệ 4.0',
    'hãy cùng tìm hiểu',
    'như chúng ta đã biết',
    'không thể phủ nhận rằng',
    'tóm lại',
    'hy vọng bài viết này hữu ích',
    'quý độc giả',
    'vô cùng',
    'cực kỳ',
    'chìa khóa thành công',
  ],
}

/** Headings whose job is to restate the post. The close the brief forbids. */
const RECAP_HEADINGS: Record<'vi' | 'en', RegExp[]> = {
  en: [
    /^(in )?summary/i,
    /^conclusion/i,
    /^(the )?(common )?(thread|thread running|takeaway|takeaways)/i,
    /^what (we|you) (have )?learned/i,
    /^wrapping up/i,
    /^final thoughts/i,
    /^(one|a) root cause/i,
  ],
  vi: [
    /^tóm lại/i,
    /^kết luận/i,
    /^tổng kết/i,
    /^lời kết/i,
    /^điểm chung/i,
    // No `\b` around either of these, and that is not sloppiness.
    //
    // JavaScript's word boundary is defined against `\w`, which is ASCII. "rễ" ends in a
    // character `\w` does not contain, so `/\bmột gốc rễ\b/` can never match the heading it was
    // written for - it matched nothing, reported nothing, and looked exactly like a post with
    // no recap in it. Every pattern on this list is a substring test for that reason.
    /một gốc rễ/i,
    /một nguyên nhân/i,
  ],
}

/**
 * Ordinal openings that mark a heading as part of a numbered set.
 *
 * Both languages, because the shape is the same failure in either and the Vietnamese form is
 * the one a real generation actually produced: "Lỗi thứ nhất", "Lỗi thứ hai", "Lỗi thứ ba".
 *
 * `(?!\p{L})` with the `u` flag rather than `\b`. Half the alternatives here end in a character
 * JavaScript's ASCII word boundary does not recognise - "lỗi thứ" ends in "ứ" - so a trailing
 * `\b` disabled exactly the Vietnamese branches this was written to catch, silently.
 */
const ORDINAL_HEADING =
  /^(\d+[.):]|first|second|third|fourth|finally|mistake \w+|reason \w+|lỗi thứ|sai lầm thứ|thứ (nhất|hai|ba|tư|năm)|đầu tiên|cuối cùng)(?!\p{L})/iu

/**
 * High-signal specifics. Bare integers are deliberately NOT here.
 *
 * `BATCH_SIZE = 47` on its own is a plausible constant in illustrative code and flagging it
 * would fire on every code sample in every post. What is not plausible is a dated measurement,
 * a percentile, a percentage or a duration - those are claims about the world, they are what a
 * reader would repeat, and they are exactly what the audited generation invented.
 */
const SPECIFIC_PATTERNS: { label: string; pattern: RegExp }[] = [
  { label: 'a date', pattern: /\b\d{4}-\d{2}-\d{2}\b/g },
  { label: 'a percentage', pattern: /\b\d+(?:[.,]\d+)?\s?%/g },
  { label: 'a latency percentile', pattern: /\bp\d{2,3}\b/gi },
  {
    label: 'a duration',
    pattern:
      /\b\d+(?:[.,]\d+)?\s?(?:ms|s|sec|secs|seconds?|m|mins?|minutes?|h|hours?|days?|giây|phút|giờ|ngày|tháng)\b/gi,
  },
  { label: 'a money figure', pattern: /[$€£]\s?\d+(?:[.,]\d+)?/g },
  {
    label: 'a data size',
    pattern: /\b\d+(?:[.,]\d+)?\s?(?:kb|mb|gb|tb)\b/gi,
  },
]

/** Lowercased, punctuation-flattened, so "18s" in the body matches "18 s" in the evidence. */
function normalise(value: string): string {
  return value.toLowerCase().replace(/[\s,]+/g, '')
}

/** The `## ` headings, in order, without the marker. */
function headings(bodyMarkdown: string): string[] {
  return Array.from(bodyMarkdown.matchAll(/^##\s+(.+?)\s*$/gm)).map(
    match => match[1]
  )
}

/** Paragraph-ish blocks outside fenced code, for the repeated-opening check. */
function paragraphs(bodyMarkdown: string): string[] {
  return bodyMarkdown
    .replace(/```[\s\S]*?```/g, '')
    .split(/\n{2,}/)
    .map(block => block.trim())
    .filter(block => block.length > 0 && !block.startsWith('#'))
}

export function auditProse(input: AuditInput): ProseFinding[] {
  const findings: ProseFinding[] = []
  const { bodyMarkdown, language, evidence, structure } = input

  // 1. The em dash. The single most recognisable tell, and the one check that is never wrong.
  const dashes = bodyMarkdown.match(/[—–]/g)
  if (dashes)
    findings.push({
      code: 'em-dash',
      message: `The body contains ${dashes.length} em or en dash${dashes.length === 1 ? '' : 'es'}, which the house style forbids. Replace each with a spaced hyphen or rewrite the sentence.`,
    })

  // 2. Phrases where the string itself is the failure.
  const lowered = bodyMarkdown.toLowerCase()
  const banned = BANNED_PHRASES[language].filter(phrase =>
    lowered.includes(phrase)
  )
  if (banned.length)
    findings.push({
      code: 'banned-phrase',
      message: `The body uses ${banned.length} banned phrase${banned.length === 1 ? '' : 's'}: ${banned.map(phrase => `"${phrase}"`).join(', ')}.`,
    })

  const sectionHeadings = headings(bodyMarkdown)

  // 3. The banned silhouette. Two independent signals, either one is enough.
  if (!PARALLEL_OK.has(structure) && sectionHeadings.length >= 3) {
    const ordinals = sectionHeadings.filter(heading =>
      ORDINAL_HEADING.test(heading)
    )

    // A shared first word across three headings is the other form: "Mistake ... / Mistake ...",
    // "Lỗi ... / Lỗi ...". Cheap, and it catches the case ordinals miss.
    const firstWords = sectionHeadings.map(
      heading => heading.split(/\s+/)[0]?.toLowerCase() ?? ''
    )
    const repeatedFirstWord = firstWords.filter(
      (word, _index, all) =>
        word.length > 2 && all.filter(other => other === word).length >= 3
    )

    if (ordinals.length >= 3 || repeatedFirstWord.length >= 3)
      findings.push({
        code: 'parallel-sections',
        message: `The post is ${sectionHeadings.length} parallel sections with parallel headings (${sectionHeadings
          .slice(0, 3)
          .map(heading => `"${heading}"`)
          .join(
            ', '
          )}...). That silhouette is the most recognisable shape of generated writing. Give the strongest section twice the room and fold the weakest into another.`,
      })
  }

  // 4. A closing section that restates the post.
  const last = sectionHeadings.at(-1)
  if (last && RECAP_HEADINGS[language].some(pattern => pattern.test(last)))
    findings.push({
      code: 'recap-section',
      message: `The last section, "${last}", reads as a recap. The brief asks the post to end when its last point is made - cut the section or replace it with what you would do differently.`,
    })

  // 5. The same opening formula, repeated. This is what the old escape hatch produced.
  const openings = new Map<string, number>()
  for (const block of paragraphs(bodyMarkdown)) {
    const opening = block
      .toLowerCase()
      .replace(/[*_`>-]/g, '')
      .trim()
      .split(/\s+/)
      .slice(0, 3)
      .join(' ')
    if (opening.split(' ').length < 3) continue
    openings.set(opening, (openings.get(opening) ?? 0) + 1)
  }
  const formula = Array.from(openings.entries()).find(([, count]) => count >= 3)
  if (formula)
    findings.push({
      code: 'repeated-opening',
      message: `${formula[1]} paragraphs open with "${formula[0]}...". A phrase repeated that often is a formula rather than a voice - rewrite all but one.`,
    })

  // 6. Specifics the brief did not supply. The check this file was written for.
  const evidenceNormalised = normalise(evidence)
  const unsourced = new Set<string>()
  for (const { pattern } of SPECIFIC_PATTERNS)
    for (const match of bodyMarkdown.matchAll(pattern)) {
      const found = match[0].trim()
      if (evidenceNormalised.includes(normalise(found))) continue
      unsourced.add(found)
    }

  if (unsourced.size > 0) {
    const listed = Array.from(unsourced).slice(0, 8)
    findings.push({
      code: 'unsourced-specific',
      message: evidence.trim()
        ? `${unsourced.size} specific${unsourced.size === 1 ? '' : 's'} in the body ${unsourced.size === 1 ? 'is' : 'are'} not in the evidence you supplied: ${listed.join(', ')}. Check each one before publishing - an invented measurement on this blog costs more than the paragraph is worth.`
        : `You supplied no evidence, and the body asserts ${unsourced.size} specific${unsourced.size === 1 ? '' : 's'}: ${listed.join(', ')}. Every one of these was invented. Cut them or replace them with something you measured.`,
    })
  }

  // 7. The opposite failure: material was supplied and the post did not use it.
  if (evidence.trim().length > 0 && unsourced.size === 0) {
    // `matchAll` rather than `.test()`: every pattern above carries `g`, and `.test()` on a
    // global regex advances `lastIndex` on the shared object - so the second call in a loop
    // starts mid-string and the check silently answers a different question each time.
    const usesAnything = SPECIFIC_PATTERNS.some(
      ({ pattern }) => bodyMarkdown.match(pattern) !== null
    )
    if (!usesAnything)
      findings.push({
        code: 'no-specifics',
        message:
          'You supplied evidence and the post contains no specifics at all. The material is the reason the post is worth publishing - check that the draft actually used it.',
      })
  }

  return findings
}
