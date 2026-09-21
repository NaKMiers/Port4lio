/**
 * Everything the model is told, and nothing about how it is told.
 *
 * ```
 *   brief.ts      WHAT to ask for   ← pure text and pure functions, no spec, no model
 *   generate.ts   HOW to assemble   ← reads the spec, picks from here, calls the model
 *   prose-audit.ts  WHETHER it complied  ← reads the reply back and measures it
 * ```
 *
 * ## Why this is a rewrite rather than an edit
 *
 * The previous brief was a list of prohibitions that had accreted one incident at a time, and
 * it produced exactly what a list of prohibitions produces: posts that break no rule and are
 * the median post about their subject. A real generation was audited against it and the
 * verdict was that two rules landed, four were unreachable because they sat behind fields that
 * default to auto, and one - the instruction to name what should be measured when no material
 * was supplied - had turned into a repeated formula at the end of every section.
 *
 * So this file is organised around the act of writing rather than around the list of failures:
 * decide the claim, know the reader, take stock of the material, then shape, then sentences.
 * The prohibitions are still here, but each one now sits inside the step it belongs to, where
 * it reads as part of a method instead of as a rule to satisfy.
 *
 * ## The two structural changes, which matter more than any wording
 *
 * 1. **Auto never means "you choose".** `structureFor` always resolves to a named template.
 *    A model handed the choice picks the same shape every time - N parallel sections and a
 *    synthesis - and every researched structure in this file was unreachable in practice
 *    because nobody switches twenty-six fields off auto before clicking generate.
 * 2. **The escape hatch is structured, not prose.** A model with nothing to cite will find
 *    somewhere to put the uncertainty. Given a prose instruction it writes "what you should
 *    measure here is...", three times, and that is worse than the fabrication it replaced.
 *    Given a JSON field it writes a list the author reads once and acts on.
 */

import { CODE_LANGUAGE_OPTIONS } from '@/lib/blog/generation-fields'

export type BriefLanguage = 'vi' | 'en'

/**
 * Step one of the method, and the step that decides whether the post is worth writing.
 *
 * The distinction in the first line is the whole thing. "Three mistakes senior engineers make"
 * is a table of contents: nobody can disagree with it, so nothing is at stake, so the post can
 * only be a list. "Senior engineers write worse code than juniors in one specific way" is a
 * claim: a reader can be wrong about it, which is what makes reading it worthwhile.
 */
export const THE_METHOD = [
  'DECIDE THE CLAIM FIRST. One sentence, and it has to be arguable - something a competent reader could disagree with. "Senior engineers over-abstract because they can see the future version of the system" is a claim. "Three mistakes senior engineers make" is a table of contents. If you cannot state it in one sentence, the subject is too broad; narrow it until you can.',
  'DECIDE THE READER. One person, described by their situation rather than their job title: "somebody who has shipped a Next.js app and has never looked at what revalidatePath actually does". Write every sentence to them. Aim to leave them able to hold an intelligent opinion on this, not to make them an expert.',
  'TAKE STOCK OF THE MATERIAL before writing a word. List to yourself every specific the brief handed you - every number, result, error, date. That list is the ceiling of what the post may assert. See the evidence law; it is not a style rule.',
  'THEN write. The claim goes in the opening, in your own words, as a sentence the reader could argue with.',
]

/**
 * The banned shapes, which are the part of this file that was missing entirely.
 *
 * Every style rule the old brief had operated at the level of the word or the sentence, and
 * the thing that makes a post read as generated is neither. It is the silhouette: N sections
 * of equal weight with parallel headings, each ending on a neat beat, followed by a section
 * that ties them together. A post can contain no banned word, no em dash and no cliche, and
 * still be recognisable from across the room by that outline alone.
 *
 * Naming it explicitly is the only thing that works. A model told "be original" produces the
 * same silhouette with different words in it.
 */
export const THE_SHAPE = [
  'OPENING: the first two sentences contain something concrete - a scene, a number from the brief, the claim itself, or the question the reader arrived with. Never a definition, never "in this post", never a paragraph explaining what the subject is.',
  'MIDDLE: sections of UNEQUAL weight. One of them is the post and the others support it. If a section could be cut without weakening the claim, cut it.',
  'BANNED SHAPE - the important one: do NOT write N parallel sections of similar length with parallel headings. "Mistake one / Mistake two / Mistake three", "Reason 1 / Reason 2 / Reason 3", "First / Second / Finally". That silhouette is the most recognisable signature of machine-written prose, more than any individual word, and it survives every other improvement you make. If the material really does have parts, they are not equal: give the strongest one twice the room and fold the weakest into a paragraph of another.',
  'BANNED SHAPE: a closing section that restates the post. Any heading under which nothing new happens - "In summary", "The common thread", "Three mistakes, one root cause" - is the same failure. The post ends when the last point is made.',
  'BANNED SHAPE: the same sentence pattern opening three or more sections or paragraphs. If two of them start "Senior engineers do this because", rewrite one of the two.',
  'CLOSE: one paragraph, and it is one of three things - what you would do differently, what is still unresolved, or what follows if the claim is true. Then stop.',
]

/**
 * The evidence law, and the one rule in this file written from a specific failed generation.
 *
 * ## What the previous version got wrong
 *
 * It said: do not invent numbers, benchmarks, timings or error messages; where the post needs
 * one, name what would have to be measured. Both halves failed, in opposite directions.
 *
 * The prohibition was read as applying to CLAIMS IN PROSE, so the model moved its inventions
 * into illustrative code - `BATCH_SIZE = 47` with a comment explaining that the vendor limit
 * is 50 - where a fabricated measurement is not only still fabricated but now carries a
 * sourcing comment that makes it look verified. Hence the explicit code-sample clause.
 *
 * The escape hatch became a tic. "Name what would have to be measured" is a reasonable thing
 * to do once and a formula when a model does it at the end of every section, which is what
 * happened. So the instruction is now inverted: do not do this in the prose at all, and put
 * what you could not support in a JSON field instead.
 *
 * ## Why this is stricter than it looks
 *
 * The site's entire position is that these things were actually measured. That is the only
 * claim it makes which a model cannot reproduce for free, and it is retracted in full by one
 * invented benchmark - not weakened, retracted, because a reader who catches one stops
 * believing the others.
 */
export const THE_EVIDENCE_LAW = [
  'A SPECIFIC is a number, a date, a duration, a version, a size, a price, a limit, an error message, or a named result. Every specific in this post must come from the brief. Not from your training, not from a plausible example, and not from a code sample.',
  'THE CODE SAMPLE CLAUSE, because this is where it goes wrong: `TIMEOUT = 30` with a comment explaining that the vendor p99 is 18 seconds is a fabricated measurement, and the sourcing comment makes it worse rather than better. Illustrative code carries no values you were not given. Use a name instead of a number, or write the sample without the constant.',
  'THE ANECDOTE CLAUSE: "I reviewed code from about forty engineers", "we hit this at a previous company", "I measured this last November". If the brief did not say it, it did not happen. Write "I have seen this" rather than inventing the occasion.',
  'IF THE BRIEF GIVES YOU NO MATERIAL, write the post without specifics. An argument carrying no numbers is honest and perfectly publishable. An argument carrying invented ones is the only thing this site genuinely cannot publish.',
  'DO NOT COMPENSATE by telling the reader what they ought to measure. A post that closes each section with "the thing to measure here is..." is the same fabrication in a different hat, and it repeats into a formula the moment there is more than one section. Say what you can support and stop.',
  'Anything you asserted that you could not support goes in `unsupported`, as a short quote from your own text. Be complete about it - the author reads that list before publishing and nothing is penalised for appearing on it.',
]

/**
 * Sentence-level rules that hold in any language.
 *
 * The em dash line is load-bearing and stays first: it is the single most recognisable tell in
 * 2026, the repo's own prose uses a spaced hyphen throughout, and `docs/blog/authoring.md`
 * states outright that reading as generated is the one way this blog fails at its only job.
 */
export const SENTENCE_RULES = [
  'Never an em dash or an en dash. A spaced hyphen - like this - or rewrite the sentence.',
  'No arrow glyphs in prose. Write the word.',
  'Paragraphs of two to four sentences. Vary sentence length; a run of same-length sentences is as recognisable as any banned word.',
  'Every paragraph carries something the one above it did not. A paragraph that restates its predecessor in new words is cut, not rewritten.',
  'No three-item lists of adjectives.',
]

export const ENGLISH_TELLS = [
  'No "delve", "leverage" as a verb, "in today\'s fast-paced", "it is worth noting", "in conclusion", "unlock", "robust", "seamless", "game-changer", "the reality is".',
  'No sentence opening "But here is the thing" or "And that is the point".',
  'No rhetorical question used as a section transition.',
]

/**
 * The Vietnamese tells, which are not translations of the English ones.
 *
 * They do not correspond, and the three that matter most are structural rather than lexical:
 * the register a model defaults to (`quý độc giả` addressing a readership, where this blog is
 * one person talking to one reader), the habit of translating technical nouns that a Vietnamese
 * developer writes in English, and the enumerated-paragraph reflex, which is the Vietnamese
 * equivalent of an em dash - a structure nobody types by hand and every model produces.
 *
 * Verified against a real generation: with these in place the register, the terminology and the
 * banned openers were all correct on the first attempt. This block is the part of the old brief
 * that worked, kept as it was.
 */
export const VIETNAMESE_TELLS = [
  'Write in Vietnamese for a Vietnamese reader. A native post, not a translation - no sentence should read as though it had an English original behind it.',
  'Keep technical terms in English: cache, deploy, build, commit, index, query, endpoint, framework. Never "bộ nhớ đệm", "triển khai", "khung công tác".',
  'Address the reader as "bạn" and yourself as "mình". Never "quý độc giả", and never "chúng ta" when you mean "mình".',
  'Banned openers and closers: "Trong thời đại công nghệ 4.0", "Hãy cùng tìm hiểu", "Như chúng ta đã biết", "Không thể phủ nhận rằng", "Tóm lại", "Hy vọng bài viết này hữu ích".',
  'Banned intensifiers: "vô cùng", "cực kỳ", "đắm chìm", "bứt phá", "đột phá", "chìa khóa thành công".',
  'Do not enumerate paragraphs or headings as "Đầu tiên... Thứ hai... Cuối cùng" or "Lỗi thứ nhất... Lỗi thứ hai...". It is the clearest tell of generated Vietnamese and it is also the banned shape above.',
  'Vietnamese sentences run long by default. Cut them. A sentence needing two commas to hold together is two sentences.',
]

export function tellsFor(language: BriefLanguage): string[] {
  return language === 'vi' ? VIETNAMESE_TELLS : ENGLISH_TELLS
}

/**
 * Rules about the markdown itself, every one of them derived from the renderer downstream.
 *
 * These are not preferences and they are the reason this function takes an argument. `## `
 * rather than `# ` because `page.tsx` renders `post.title` in the page's only `h1`; no image
 * URLs because `rehypeRestrictImageHosts` deletes any `src` that is not this site's Cloudinary
 * account and KEEPS the node, so an invented URL publishes as a broken image on a live post;
 * fence languages restricted because `downgradeUnknownFences` silently strips highlighting from
 * a grammar Shiki does not carry.
 */
export function markdownContract(codeLanguage: string | undefined): string[] {
  return [
    'Markdown only. No front matter, no HTML tags - raw HTML is dropped by the renderer rather than escaped.',
    "Start at `## `. The title is rendered above the body as the page's only h1, so the body must not contain one.",
    'Never write a real image URL. You do not know one, and an invented one is refused by the renderer and published as a broken image.',
    codeLanguage
      ? `Fenced code blocks must be tagged \`${codeLanguage}\`.`
      : // Built from the option list rather than typed out, so adding a language to the dropdown
        // cannot leave auto mode offering the old set.
        `Tag every fenced code block with one of: ${CODE_LANGUAGE_OPTIONS.map(option => option.value).join(', ')}. An untagged or unknown fence loses its highlighting.`,
    'Links are welcome but must be real. Do not invent a URL to a doc page you are not sure exists.',
  ]
}

export const WORD_TARGETS: Record<string, string> = {
  note: '150 to 500 words',
  short: '500 to 800 words',
  standard: '800 to 1200 words',
  long: '1500 to 2500 words',
  pillar: '2500 to 4000 words',
}

/**
 * Every structure, written out step by step.
 *
 * A structure that is named but not described is one the model approximates from its own
 * priors, and what it approximates to is the banned shape. `seven-step` proved this before the
 * rewrite: its sixth step is the one `docs/blog/authoring.md` calls the seniority signal, and it
 * was the step that went missing whenever the template was referred to by name alone.
 *
 * Nine of them rather than three, because `structureFor` now has to answer for every style. A
 * style with no template would fall back to "you choose", which is the hole this rewrite exists
 * to close.
 */
export const STRUCTURE_TEMPLATES: Record<string, string[]> = {
  'seven-step': [
    'the seven-step template, in this order, as `##` sections with your own headings:',
    '  1. Context - what was being built, in two sentences',
    '  2. What I measured - the thing actually run',
    '  3. What I expected - the documented or obvious answer',
    '  4. What happened - the number, the output, the error',
    '  5. Root cause - why',
    '  6. What I rejected - the fixes not taken, and why. Never skip this one; it is the section that shows judgement.',
    '  7. What I would tell you - the one-line takeaway',
  ],
  zipline: [
    'the zipline. One line runs the length of the post and every section hangs off it.',
    '  1. Open on the claim, stated in one sentence, in the first paragraph.',
    '  2. Say where the post is going, in a line, so the reader can see the shape of the journey.',
    '  3. Descend: each section takes the reader one step further down, and each step is one they could not have taken without the previous one. The sections are NOT parallel and NOT equal in length.',
    '  4. Return to the claim at the end, now that it means something different.',
  ],
  'in-medias-res': [
    'open in the middle of it.',
    '  1. The first sentence is inside the moment: what was said, what broke, what was on the screen. No setup, no date, no "I want to talk about".',
    '  2. Fill in background only where the reader now needs it, and only once they need it.',
    '  3. Carry ONE arc. One thing changes over the course of the post. Anything not on that arc is cut, however good it is.',
    '  4. Land on a single line of revelation. One sentence, alone, and then stop.',
  ],
  'claim-first': [
    'the claim, then the defence.',
    '  1. State the claim in the first sentence, at full strength, with no hedging.',
    '  2. Give the strongest reason to believe it, at length. This is the long section.',
    '  3. Give the best argument AGAINST it, stated fairly enough that somebody who holds it would recognise their own position, and then answer it.',
    '  4. Say what the claim does not cover. An opinion piece that admits no limit reads as advertising.',
  ],
  'build-log': [
    'a build log, in time order.',
    '  1. What the thing is, in two sentences, for a reader who has never heard of it.',
    '  2. What shipped in this period, concretely. Only what the brief gave you.',
    '  3. What it cost - time, money, attention - where the brief supplies the figures.',
    '  4. What did not work, at greater length than what did. This is the section people read.',
    '  5. What is next, in one line. No lessons-for-the-reader section.',
  ],
  'pillar-hub': [
    'a hub for the whole topic, not a long article about one part of it.',
    '  1. Open with what the topic actually is and who is wrong about it, in a few sentences.',
    '  2. Cover the whole area in `##` sections, one per sub-topic, each self-contained.',
    '  3. Where a section covers ground an existing post covers in depth, say so in the prose and put that post in `relatedSlugs`. This page is the map; the cluster posts are the territory.',
    '  4. Write the headings as the questions people actually ask, so somebody arriving from a search finds theirs by scanning.',
  ],
  tutorial: [
    'a tutorial, ordered by what the reader does.',
    '  1. What they will have at the end, and what they need before starting.',
    '  2. The steps, in order, each one runnable. No step that says "configure as appropriate".',
    '  3. The place it usually breaks, and what the error looks like when it does.',
    '  4. Stop at the working result. No recap of the steps just taken.',
  ],
  reference: [
    'a reference, ordered for lookup rather than for reading.',
    '  1. One paragraph saying what this covers and who it is for.',
    '  2. Then entries, each self-contained, each findable by its heading alone. A reader arrives here from a search and leaves after one section.',
    '  3. No narrative connecting the entries, and no closing section.',
  ],
  digest: [
    'a digest: several items in a fixed repeating shape.',
    '  1. One line of framing at the top, no more.',
    '  2. Each item: what it is, in a few sentences, then why it matters to this specific reader, in your own words.',
    '  3. Work only from what the brief contains. Do not report news you were not given.',
    '  4. No closing section. The last item is the end.',
  ],
}

/**
 * The style a structure is derived from when the author left it on auto.
 *
 * ## Why a table rather than letting the model decide
 *
 * Because the model's decision is always the same one. A default generation - and a default
 * generation is almost all of them, since auto is the initial state of all twenty-six fields -
 * produced N parallel sections plus a synthesis every time, which is the exact silhouette
 * `THE_SHAPE` bans. Handing back the choice and then forbidding the answer is not a design.
 *
 * `zipline` is the fallback when even the style is auto, because it is the structure furthest
 * from the banned shape: its sections are explicitly unequal and explicitly dependent on one
 * another, so it cannot collapse into a list.
 */
const STRUCTURE_BY_STYLE: Record<string, string> = {
  'measured-teardown': 'seven-step',
  postmortem: 'seven-step',
  'personal-essay': 'in-medias-res',
  narrative: 'in-medias-res',
  'deep-dive': 'zipline',
  opinion: 'claim-first',
  'build-log': 'build-log',
  tutorial: 'tutorial',
  reference: 'reference',
  digest: 'digest',
  // Deliberately absent: `listicle`. It maps to `numbered-list`, which has no template here
  // because it IS the banned shape - it is only reachable when an author picks it on purpose,
  // and `resolveStructure` lets that through untouched.
}

/** The series a structure is derived from when style is auto too. */
const STRUCTURE_BY_SERIES: Record<string, string> = {
  'measured-in-production': 'seven-step',
  'shipping-side-products': 'build-log',
  'dev-career-vn': 'in-medias-res',
}

/**
 * The structure for this generation. Never returns nothing, which is the whole point.
 *
 * `isPillar` wins over everything: a hub post that came out as a long article is a hub that
 * never links its cluster, and the cluster is the reason the post exists.
 */
export function structureFor(input: {
  manual: string | undefined
  style: string | undefined
  series: string | undefined
  isPillar: boolean
}): string {
  if (input.manual) return input.manual
  if (input.isPillar) return 'pillar-hub'
  if (input.style && STRUCTURE_BY_STYLE[input.style])
    return STRUCTURE_BY_STYLE[input.style]
  if (input.series && STRUCTURE_BY_SERIES[input.series])
    return STRUCTURE_BY_SERIES[input.series]
  return 'zipline'
}

/**
 * What each opening choice asks for, keyed by option value.
 *
 * A lookup rather than the dropdown label, because the label is written for an author scanning
 * a select ("The number - lead with the measurement") and this is written for a model that has
 * to act on it. Sending the label would also mean a copy edit in the dialog silently rewrote
 * the prompt.
 */
export const HOOK_DIRECTIVES: Record<string, string | undefined> = {
  scene:
    'open inside a scene - what was on the screen, what somebody said out loud, what broke. No framing before it.',
  number:
    'open on the measurement. The first sentence contains the number and the explanation comes after it. Only if the brief gave you the number.',
  claim:
    'open on the conclusion. State what you found in sentence one and spend the post defending it.',
  question:
    'open on the question the reader already has, in their words rather than yours, and do not answer it for two paragraphs.',
  reframe:
    'open by saying the thing the reader believes is not what it looks like, and name what it actually is.',
}

/**
 * The four formats from the research, expanded. The original seven pass through as their value.
 *
 * "Postmortem", "tutorial" and "opinion" mean to a model roughly what they mean to the author
 * who picked them off a dropdown, and a paragraph explaining "opinion" is prompt spent on
 * nothing. These four do not: two name a shape rather than a register, and "personal essay" is
 * the one format where the model's default - a reflective piece arriving at a general truth -
 * is the exact failure the format has to avoid.
 */
export const STYLE_DIRECTIVES: Record<string, string | undefined> = {
  'personal-essay':
    'a personal essay. One scene, one arc, one revelation at the end. A specific thing that happened, not a reflection on a theme, and it must not resolve into general advice.',
  'deep-dive':
    'one topic taken all the way down. Assume the reader is curious and knows nothing specific, and deliver them somewhere they could not have reached in an afternoon. Build from what they know rather than asserting.',
  'build-log':
    'a build log. What shipped, what it cost, what the numbers were, what did not work. Concrete and dated, using only dates and figures the brief supplied.',
  digest:
    'a digest: several items, each a few sentences, in a fixed repeating shape. Every item ends with why it matters to this reader specifically, in your own words.',
}

/**
 * The JSON contract, built rather than written out so the taxonomy lists cannot drift from it.
 *
 * `throughline` and `unsupported` are new and neither is stored on the post. They exist because
 * the author has to be able to see what the model committed to and what it could not stand
 * behind, and because `prose-audit.ts` measures the body against both.
 */
export function outputSchema(input: {
  kinds: string[]
  series: string[]
}): string[] {
  return [
    'Return ONE JSON object and nothing else. No prose before it, no prose after it, no code fence.',
    '',
    '```json',
    '{',
    '  "throughline": "the one arguable sentence the whole post hangs from",',
    '  "title": "under 140 characters",',
    '  "slug": "lowercase-hyphenated, max 80 chars, matches ^[a-z0-9-]{1,80}$",',
    '  "excerpt": "one or two sentences, under 300 characters, no trailing ellipsis",',
    `  "kind": "one of: ${input.kinds.join(' | ') || 'article'}",`,
    `  "series": ${input.series.length ? `"one of: ${input.series.join(' | ')}" or null` : 'null'},`,
    '  "language": "vi" or "en",',
    '  "tags": ["three-to-six", "lowercase-hyphenated", "max-8"],',
    '  "relatedSlugs": ["slugs from the list in the brief only, at most 5, [] if none fit"],',
    '  "coverImagePrompt": "a text-to-image prompt for the cover, under the rules above",',
    '  "imagePrompts": [{"key": "image1", "prompt": "a text-to-image prompt for that placeholder"}],',
    '  "unsupported": ["short quotes from your own text that the brief did not support, [] if none"],',
    '  "bodyMarkdown": "the whole post, starting at a ## heading"',
    '}',
    '```',
    '',
    'Every string must be valid JSON - escape newlines in `bodyMarkdown` as \\n. Do not truncate the body to fit; write to the length asked for.',
  ]
}
