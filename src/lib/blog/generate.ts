import {
  isReservedSlug,
  MAX_IMAGE_PROMPTS,
  SLUG_PATTERN,
  TAG_PATTERN,
} from '@/lib/blog/constants'
import {
  HOOK_DIRECTIVES,
  markdownContract,
  outputSchema,
  SENTENCE_RULES,
  STRUCTURE_TEMPLATES,
  structureFor,
  STYLE_DIRECTIVES,
  tellsFor,
  THE_EVIDENCE_LAW,
  THE_METHOD,
  THE_SHAPE,
  WORD_TARGETS,
  type BriefLanguage,
} from '@/lib/blog/brief'
import {
  manualBoolean,
  manualList,
  manualString,
  NO_SERIES,
  resolveTemperature,
  type GenerationSpec,
} from '@/lib/blog/generation-fields'
import {
  findImagePlaceholders,
  placeholderKeys,
  placeholderMarkdown,
} from '@/lib/blog/image-placeholders'
import {
  IMAGE_PROMPT_RULES,
  normaliseImagePrompt,
} from '@/lib/blog/image-prompt'
import { auditProse } from '@/lib/blog/prose-audit'

/**
 * The brief that goes to the model, and the gate everything it says back has to pass.
 *
 * ```
 *   spec (one auto/manual setting per field)  +  context (kinds, series, existing slugs)
 *            │
 *            ▼
 *   buildGenerationPrompt ──▶ { system, user }
 *            │
 *            ▼                        [ api/admin/blog/generate ]
 *   chatCompletion ──▶ text ──▶ extractJsonObject ──▶ Record<string, unknown>
 *            │
 *            ▼
 *   parseGeneratedDraft   ← EVERY field re-validated here, nothing trusted
 *            │
 *            ├─ slug        pattern, reserved list, uniqueness (caller)
 *            ├─ kind/series must exist in the collections
 *            ├─ tags        pattern, capped at 8
 *            ├─ relatedSlugs must exist, capped at 5
 *            └─ bodyMarkdown length-capped, then renderMarkdown sanitizes it (caller)
 * ```
 *
 * ## The trust boundary is here, and it is not "the model is well behaved"
 *
 * The model's reply is network input that reaches a database write, so it gets the same
 * treatment as a request body: nothing is written because the model said it. That is not
 * paranoia about a rogue model - it is that `Post.kind` and `Post.series` have no schema
 * enums (a mongoose enum is fixed at module load and both lists are runtime-editable), so
 * this function is the only thing standing between a generated post and a dangling taxonomy
 * reference, exactly as the hand-written checks in `PATCH /api/admin/blog/[id]` are for the
 * editor.
 *
 * The HTML side is already covered and deliberately not re-done here: `bodyMarkdown` goes
 * through `renderMarkdown`, which drops raw HTML at `remark-rehype`, sanitizes, and restricts
 * image hosts. A model that emits a `<script>` gets it dropped by the same pass that drops an
 * author's.
 *
 * ## Why validation returns warnings instead of failing
 *
 * A post whose seventh tag was `Next.js 16` (spaces and a dot, so it fails `TAG_PATTERN`) is
 * not a failed generation - it is a good post with one bad tag, and refusing the whole thing
 * costs a minute of model time to punish a field the author can fix in the editor in four
 * seconds. So recoverable problems drop the value and say so; only a missing body or an
 * unusable slug is fatal, because neither has a sensible fallback.
 */

export type GenerationContext = {
  kinds: { slug: string; label: string }[]
  series: { slug: string; title: string; blurb: string }[]
  /** Published posts the model may point `relatedSlugs` at. Nothing else is a valid target. */
  relatedCandidates: { slug: string; title: string }[]
}

export type GeneratedDraft = {
  title: string
  slug: string
  excerpt: string
  bodyMarkdown: string
  kind: string
  series: string | null
  isPillar: boolean
  language: 'vi' | 'en'
  tags: string[]
  relatedSlugs: string[]
  coverImagePrompt: string
  /** One per placeholder that is actually in `bodyMarkdown`. Never more, never orphans. */
  imagePrompts: { key: string; prompt: string }[]
}

export class GenerationError extends Error {}

/** Mirrors `bodyMarkdown`'s `maxlength` on the schema, so a long post fails here with a reason. */
const MAX_BODY_CHARS = 200_000

/**
 * Join a model-controlled list for a warning without letting it become the warning.
 *
 * Every list quoted back to the author here came from the reply, so none of them has a length
 * the code chose. Six names is enough to recognise what went wrong; the count already carries
 * the scale.
 */
export function summariseList(values: string[], limit = 6): string {
  const head = values.slice(0, limit).map(value => value.slice(0, 40))
  return values.length > limit
    ? `${head.join(', ')} and ${values.length - limit} more`
    : head.join(', ')
}

/**
 * The brief, assembled. All of the CONTENT lives in `brief.ts`; this function only chooses.
 *
 * ## What changed, and why it is a rewrite rather than an edit
 *
 * The previous version of this function was audited against a real generation. Two of its
 * rules reached the output, four could not because they sat behind fields that default to auto
 * and nobody switches twenty-six fields off auto before clicking generate, and one - the
 * instruction to name what should be measured when no material was supplied - had become a
 * formula repeated at the end of every section.
 *
 * The three structural fixes, all of them in the AUTO branches rather than in the wording:
 *
 * 1. `structureFor` always resolves to a named template. The old auto branch said "you choose,
 *    matched to the style", and the model's choice is always the same one.
 * 2. The title rule no longer depends on `kind`, because the model also picks `kind` - so the
 *    rule was conditioned on a value its own subject controlled.
 * 3. The evidence directive tells the model what NOT to write when it has no material, and
 *    routes the uncertainty into a JSON field instead of into the prose.
 */
function briefSections(spec: GenerationSpec) {
  const style = manualString(spec, 'style')
  const manualSeries = manualString(spec, 'series')
  const isPillar = manualBoolean(spec, 'isPillar') ?? false

  const structure = structureFor({
    manual: manualString(spec, 'structure'),
    style,
    series: manualSeries === NO_SERIES ? undefined : manualSeries,
    isPillar,
  })

  return { style, manualSeries, isPillar, structure }
}

/** `- Label: <what the model should do>` for one field, manual or auto. */
function directive(
  label: string,
  manual: string | undefined,
  auto: string
): string {
  return manual ? `- ${label}: ${manual}` : `- ${label}: ${auto}`
}

/** The language the post is written in, which is Vietnamese unless the author said otherwise. */
function promptLanguage(spec: GenerationSpec): BriefLanguage {
  return manualString(spec, 'language') === 'en' ? 'en' : 'vi'
}

/**
 * The structure, written out in full.
 *
 * Every shape `structureFor` DERIVES has a template. Four of the values an author (or the cron
 * sampler) can pin by hand do not, and pass through as a bare `- Structure: <value>` line:
 * `numbered-list`, `problem-solution`, `chronological` and `freeform`.
 *
 * That is deliberate for each of them, and the reasons differ. `numbered-list` IS the banned
 * silhouette, so describing it would be writing out the shape `THE_SHAPE` forbids. `freeform`
 * means "no template" by definition. `problem-solution` and `chronological` name their own
 * order in their own words, which is the one case where a name is not an invitation to
 * improvise. None of the four is reachable from auto - `structureFor` never returns them - so
 * the "a structure the model approximates" failure that `brief.ts` describes needs an author
 * to have chosen the shape on purpose first.
 */
function structureDirective(structure: string): string {
  const template = STRUCTURE_TEMPLATES[structure]
  if (!template) return `- Structure: ${structure}`
  return [`- Structure: ${template[0]}`, ...template.slice(1)].join('\n')
}

export function buildGenerationPrompt(
  spec: GenerationSpec,
  context: GenerationContext
): { system: string; user: string } {
  const language = promptLanguage(spec)
  const codeLanguage = manualString(spec, 'codeLanguage')
  const { style, manualSeries, structure } = briefSections(spec)

  const kindList = context.kinds
    .map(kind => `${kind.slug} (${kind.label})`)
    .join(', ')
  const seriesList = context.series
    .map(entry => `${entry.slug} - ${entry.title}: ${entry.blurb}`)
    .join('\n  ')

  const length = manualString(spec, 'length')
  const wordTarget = WORD_TARGETS[length ?? ''] ?? null
  const genres = manualList(spec, 'genres')
  const evidence = manualString(spec, 'evidence')

  const system = [
    "You are drafting one post for a working software engineer's personal site. The author reads what you produce, edits it, and publishes it under their own name.",
    '',
    "There is exactly one way this fails: the post reads as something a model produced. Not because generated prose is bad, but because the site's whole claim is that this person thinks well and measures things, and a post that reads as generated retracts that claim on arrival. Everything below is in service of that one requirement.",
    '',
    '# The method - do this before writing a sentence',
    ...THE_METHOD.map((rule, index) => `${index + 1}. ${rule}`),
    '',
    '# The evidence law - the rule that is not about style',
    ...THE_EVIDENCE_LAW.map(rule => `- ${rule}`),
    '',
    '# The shape',
    ...THE_SHAPE.map(rule => `- ${rule}`),
    '',
    '# The sentences',
    ...SENTENCE_RULES.map(rule => `- ${rule}`),
    // One language's tells, never both. They do not correspond: sending the English list with a
    // Vietnamese post spends the model's attention on words it was never going to write and
    // leaves the ones it does overuse unmentioned.
    ...tellsFor(language).map(rule => `- ${rule}`),
    '',
    '# The markdown contract',
    ...markdownContract(codeLanguage).map(rule => `- ${rule}`),
    '',
    '# Image prompts',
    'You cannot produce images, so you produce the brief for them: a placeholder in the body and a prompt for a text-to-image model. Every prompt follows these rules.',
    ...IMAGE_PROMPT_RULES.map(rule => `- ${rule}`),
    '',
    '# Output',
    ...outputSchema({
      kinds: context.kinds.map(kind => kind.slug),
      series: context.series.map(entry => entry.slug),
    }),
  ].join('\n')

  const user = [
    '# The brief',
    '',
    'Fields marked "you choose" are yours to decide, and your choice goes in the JSON. Every other field is a constraint.',
    '',
    '## The post',
    directive(
      'Topic',
      manualString(spec, 'topic'),
      'you choose, from the series and genres below. Prefer one concrete thing that happened over a survey of a subject.'
    ),
    directive(
      'Claim',
      manualString(spec, 'throughline'),
      'you choose one, and it must be arguable rather than a description of the subject. Put it in `throughline` and state it in the opening.'
    ),
    /*
      The auto branch is a prohibition, and the wording of it is the fix for a specific observed
      failure. An author with numbers pastes them here. An author without them used to get a
      model that invented some - first as claims, then, once claims were banned, inside code
      samples where the ban was not looking - and that padded every section with "what you
      should measure here is...". So: no material means no specifics, said plainly, plus an
      explicit ban on the compensating behaviour.
    */
    evidence
      ? `- Evidence, and the ONLY specifics this post may contain:\n${evidence
          .split('\n')
          .map(line => `  ${line}`)
          .join('\n')}`
      : '- Evidence: NONE supplied. This post may contain no dates, no durations, no percentages, no measurements and no error text - not in the prose and not in code samples. Write the argument without them. Do not tell the reader what they should measure instead.',
    '',
    '## Placement',
    `- Kinds that exist: ${kindList || 'article'}`,
    directive(
      'Kind',
      manualString(spec, 'kind'),
      'you choose, against the length below'
    ),
    context.series.length
      ? `- Series that exist:\n  ${seriesList}`
      : '- No series exist yet; return null.',
    directive(
      'Series',
      manualSeries === NO_SERIES
        ? 'null - this post belongs to no series'
        : manualSeries,
      'you choose one, or null if the topic fits none of them. Do not force a fit.'
    ),
    directive(
      'Language',
      manualString(spec, 'language'),
      'vi. Write the whole post in Vietnamese and return "vi".'
    ),
    context.relatedCandidates.length
      ? [
          '- Published posts you may reference in `relatedSlugs` (use the slug exactly, or return []):',
          ...context.relatedCandidates.map(
            post => `  - ${post.slug} - ${post.title}`
          ),
        ].join('\n')
      : '- No published posts exist yet. `relatedSlugs` must be [].',
    manualList(spec, 'relatedSlugs')?.length
      ? `- Related posts: use exactly these - ${manualList(spec, 'relatedSlugs')!.join(', ')}`
      : '- Related posts: you choose, at most five, only from the list above.',
    '',
    '## Craft',
    directive(
      'Style',
      STYLE_DIRECTIVES[style ?? ''] ?? style,
      'you choose, matched to the topic'
    ),
    directive('Tone', manualString(spec, 'tone'), 'plain and direct'),
    genres?.length
      ? `- Genres: ${genres.join(', ')}`
      : '- Genres: you choose, inferred from the topic',
    directive('Audience', manualString(spec, 'audience'), 'senior engineers'),
    directive(
      'Point of view',
      manualString(spec, 'pointOfView'),
      'first person'
    ),
    // Never "you choose". See `structureFor`.
    structureDirective(structure),
    directive(
      'Opening',
      HOOK_DIRECTIVES[manualString(spec, 'hook') ?? ''],
      'you choose, matched to the structure above. Never a definition and never a paragraph of setup.'
    ),
    `- Length: ${wordTarget ?? 'you choose - a note is 150 to 500 words, an article is 800 to 2000'}`,
    directive(
      'Code examples',
      manualString(spec, 'codeExamples'),
      'as many as the topic needs'
    ),
    ...imageDirective(resolveImageCount(spec), length),
    /*
      Unconditional, and that is the fix.

      It used to read "if this is an article, the title must carry a number or a named failure",
      which cannot work: the model picks `kind` in the same reply, so the rule was conditioned on
      a value its own subject controlled, and a post that wanted a plain title simply came back
      as a note. `false` still turns it off - that is an author saying so, which is different.
    */
    manualBoolean(spec, 'titleRule') === false
      ? '- The title does not need to carry a number or a named failure.'
      : '- The title MUST name something specific: a number the brief gave you, or a named failure. "revalidateTag did not invalidate anything" or "Five things Next.js 16 did that its docs did not say", never "Some thoughts on caching". If you have no number, name the failure.',
    '- The title is a label for a discussion, not ad copy. No "you will not believe", no "the ultimate guide", no colon-and-subtitle construction. Specific and true beats clickable.',
    manualBoolean(spec, 'quotableLine') === true
      ? '- Somewhere in the post, write one sentence a reader would quote about themselves - the line they would screenshot because it describes them. One. It must be true and earned by what came before it, not bolted on at the end.'
      : '- Do not write a motivational or quotable line. Let the evidence be the thing worth repeating.',
    directive(
      'Closing',
      manualString(spec, 'callToAction') === 'none'
        ? 'no call to action. End on the point.'
        : manualString(spec, 'callToAction'),
      'no call to action. End on the point.'
    ),
    directive(
      'Keywords',
      manualString(spec, 'seoKeywords'),
      'none imposed. Use the words the topic implies, once each.'
    ),
    '',
    ...(manualString(spec, 'instruction')
      ? ['## Also', manualString(spec, 'instruction')!, '']
      : []),
    'Return the JSON object now.',
  ].join('\n')

  return { system, user }
}

/**
 * How many pictures a post of a given length wants, and the ONE table both halves read.
 *
 * ```
 *   words         images   roughly one per 400 words
 *   ───────────   ──────   ─────────────────────────────────────────────
 *   under 300         0    a micro-note; the picture would outweigh the post
 *   300 - 699         1    note
 *   700 - 1199        2    short / standard
 *   1200 - 2199       3    long
 *   2200 and up       4    pillar
 * ```
 *
 * ## Why a table and not a range
 *
 * Because a range with a cheap end is not a range. Auto used to say "place one, or two if the
 * post genuinely has two things worth showing", which sounds like a judgement call and is not:
 * one is cheaper than two and the model returned one, every time. The version before that said
 * "up to two, none is a fine answer" and returned none, every time. Twice now the answer has
 * been whichever end of the offer cost least, so the offer is gone.
 *
 * This is the same rule `structureFor` follows and for the same reason: auto derives, it does
 * not delegate. A number the code computed is a constraint; a number the model picked off a
 * spectrum is a floor it will stand on.
 *
 * ## Why four is the ceiling
 *
 * `IMAGE_COUNT_OPTIONS` stops at four and this must not exceed it, or auto would ask for a
 * count the dialog cannot express and `presetSpecFromPost` cannot preset when regenerating.
 * Past four the post is a gallery with captions, and every placeholder is another picture the
 * author has to make before publishing - the generator cannot draw, so what a placeholder buys
 * is a prompt and an upload slot.
 */
export function expectedImageCount(words: number): number {
  if (words < 300) return 0
  if (words < 700) return 1
  if (words < 1200) return 2
  if (words < 2200) return 3
  return 4
}

/** The word target each `length` option commits to, as the midpoint this table keys off. */
const LENGTH_MIDPOINT: Record<string, number> = {
  note: 325,
  short: 650,
  standard: 1000,
  long: 2000,
  pillar: 3250,
}

/**
 * What to tell the model about pictures.
 *
 * Three branches, and the middle one is the fix. A pinned count passes through. A pinned
 * LENGTH resolves to an exact number through the table above, because at that point the code
 * knows how long the post will be and there is nothing left to judge. Only when both are auto
 * does the model get a rule instead of a number - and even then it is a rate with worked
 * anchors, not a range to choose from.
 */
function imageDirective(
  count: number | null,
  length: string | undefined
): string[] {
  if (count === 0)
    return ['- Images: none. Do not write any image placeholder.']

  // A derived zero is the micro-note case and says the same thing, so it short-circuits here
  // rather than falling through to a directive asking for `image1` and then for zero of them.

  if (count !== null)
    return [
      `- Images: exactly ${count}, using ${placeholderKeys(count)
        .map(key => `\`${key}\``)
        .join(', ')}${count > 1 ? ', in that order' : ''}.`,
      ...imagePlacementRules(),
    ]

  const midpoint = LENGTH_MIDPOINT[length ?? '']
  if (midpoint !== undefined) {
    const derived = expectedImageCount(midpoint)
    if (derived === 0)
      return ['- Images: none. The post is too short to carry one.']
    return [
      `- Images: ${derived}, using ${placeholderKeys(derived)
        .map(key => `\`${key}\``)
        .join(
          ', '
        )}${derived > 1 ? ', in that order' : ''}. This is the count for the length above, not a maximum to work down from.`,
      ...imagePlacementRules(),
    ]
  }

  return [
    '- Images: one for roughly every 400 words you write, numbered from `image1`. A 600 word post carries 1, a 1000 word post carries 2, a 1500 word post carries 3, anything past 2200 words carries 4. Four is the maximum, and a post under 300 words carries none.',
    '  That is the count, not a ceiling to work down from. A full-length post with a single picture in it has not met this.',
    ...imagePlacementRules(),
  ]
}

/**
 * Where a placeholder goes, which is the half that decides whether the picture is worth making.
 *
 * "Where the picture belongs" was doing too much work on its own. The research this blog's
 * format comes from is specific that a visual has to carry information rather than decorate -
 * a crude diagram of the thing being explained beats a polished photograph of a laptop - and a
 * model told only "place an image" reaches for the laptop.
 *
 * The spacing rule is here rather than in the count because it is what stops a raised count
 * from being met badly: four placeholders stacked in the first third is not four illustrated
 * sections, it is a gallery with an essay after it.
 */
function imagePlacementRules(): string[] {
  return [
    `  Write each as \`${placeholderMarkdown('image1')}\` on its own line, in the body, at the point it is needed.`,
    '  Spread them. Each one belongs in a different section, next to the thing it shows. Never two in a row and never all of them before the halfway point.',
    '  Put each where it does work: the diagram of the thing being explained, the shape of the data, the before and the after. Never a decorative photograph at the top, and never an image standing in for a paragraph you did not write.',
    '  Then give a matching entry in `imagePrompts` for every placeholder you used, and only those.',
  ]
}

/**
 * The post came back with fewer pictures than its length calls for.
 *
 * Reads `expectedImageCount` against the body that actually arrived, so the check and the brief
 * cannot disagree about what was asked for - the failure mode of a gate that measures something
 * other than what the prompt requested is a warning the author cannot act on.
 *
 * Silent whenever the author pinned a count: `0` is then a decision, and any other number is
 * already reported key by key through `resolveImagePrompts`, more precisely than this could.
 */
function imageExpectationWarning(
  spec: GenerationSpec,
  bodyMarkdown: string
): string | null {
  if (resolveImageCount(spec) !== null) return null

  const words = bodyMarkdown.trim().split(/\s+/).filter(Boolean).length
  const expected = expectedImageCount(words)
  const actual = findImagePlaceholders(bodyMarkdown).length
  if (actual >= expected) return null

  return `This post is ${words} words, which calls for ${expected} image${expected === 1 ? '' : 's'}, and it came back with ${actual}. Add ${expected - actual} more \`![image](imageN)\` placeholder${expected - actual === 1 ? '' : 's'} where a diagram would do work, or regenerate with a count pinned.`
}

/** The resolved structure for a spec, which `parseGeneratedDraft` needs for the audit. */
export function resolvedStructure(spec: GenerationSpec): string {
  return briefSections(spec).structure
}

/**
 * The `imageCount` field as a number, or `null` for auto.
 *
 * The field's values are strings because they are `<option value>`s, and `'0'` is a legal
 * choice that means "no pictures" - so this cannot be written as `Number(value) || null`,
 * which would turn the one deliberate zero into auto and put images on a post that asked for
 * none. The `''`/NaN cases fall through to `null` explicitly instead.
 */
export function resolveImageCount(spec: GenerationSpec): number | null {
  const raw = manualString(spec, 'imageCount')
  if (raw === undefined) return null
  const parsed = Number(raw)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null
}

export function generationTemperature(spec: GenerationSpec): number {
  return resolveTemperature(manualString(spec, 'creativity'))
}

/**
 * Turn the model's JSON into a draft, or refuse.
 *
 * `warnings` are for the author: each one is a value that was dropped or replaced, named so
 * the difference between what was asked for and what was saved is never silent. The editor
 * is one click away, so a warning is a task, not an apology.
 */
export function parseGeneratedDraft(
  payload: Record<string, unknown>,
  spec: GenerationSpec,
  context: GenerationContext
): { draft: GeneratedDraft; warnings: string[] } {
  const warnings: string[] = []

  const bodyMarkdown =
    typeof payload.bodyMarkdown === 'string' ? payload.bodyMarkdown.trim() : ''
  // Fatal, and the only genuinely fatal content failure. Everything else on a post can be
  // filled in from a fallback that is honest; a body cannot.
  if (!bodyMarkdown)
    throw new GenerationError('The model returned no post body.')

  if (bodyMarkdown.length > MAX_BODY_CHARS)
    throw new GenerationError(
      `The model returned ${bodyMarkdown.length} characters, past the ${MAX_BODY_CHARS} a post may store.`
    )

  const manualTitle = manualString(spec, 'title')
  const modelTitle =
    typeof payload.title === 'string' ? payload.title.trim() : ''
  const title = (manualTitle ?? modelTitle).slice(0, 140)
  if (!title)
    throw new GenerationError(
      'The model returned no title, and none was given.'
    )

  const { slug, warning: slugWarning } = resolveSlug(spec, payload, title)
  if (slugWarning) warnings.push(slugWarning)

  const manualExcerpt = manualString(spec, 'excerpt')
  const modelExcerpt =
    typeof payload.excerpt === 'string' ? payload.excerpt.trim() : ''
  const excerpt = (manualExcerpt ?? modelExcerpt).slice(0, 300)

  const language = resolveLanguage(spec, payload)

  /*
    The model's own declaration of what it could not stand behind.

    This replaces a prose instruction that had become a formula - "the thing to measure here
    is...", once per section - by moving the same admission into a field nobody reads as part
    of the post. It is a task list for the author rather than a confession in the text, and it
    is the only place in this function where the model is taken at its word on purpose: a
    model saying "I made this up" is not a claim that needs verifying.
  */
  if (Array.isArray(payload.unsupported)) {
    const unsupported = payload.unsupported
      .filter((entry): entry is string => typeof entry === 'string')
      .map(entry => entry.trim())
      .filter(Boolean)

    if (unsupported.length)
      warnings.push(
        `The model flagged ${unsupported.length} claim${unsupported.length === 1 ? '' : 's'} it could not support: ${summariseList(unsupported)}. Cut each one or replace it with something you measured.`
      )
  }

  // Not stored, and the point is that producing it forces the decision. A reply with no
  // throughline is a reply that skipped the first step of the method, and what comes back
  // when that happens is a survey of the subject rather than an argument about it.
  const throughline =
    typeof payload.throughline === 'string' ? payload.throughline.trim() : ''
  if (!throughline && !manualString(spec, 'throughline'))
    warnings.push(
      'The model returned no throughline, which means it never committed to a claim. Read the opening: a post with no arguable sentence in it is a survey, and that is the shape this blog is trying not to produce.'
    )

  const imageWarning = imageExpectationWarning(spec, bodyMarkdown)
  if (imageWarning) warnings.push(imageWarning)

  // The prose gate. Everything above validates what the post IS; this measures how it READS,
  // against the same brief that asked for it. See `prose-audit.ts` for why it is not a second
  // model call.
  for (const finding of auditProse({
    bodyMarkdown,
    language,
    evidence: manualString(spec, 'evidence') ?? '',
    structure: resolvedStructure(spec),
  }))
    warnings.push(finding.message)

  return {
    draft: {
      title,
      slug,
      excerpt,
      bodyMarkdown,
      kind: resolveKind(spec, payload, context, warnings),
      series: resolveSeries(spec, payload, context, warnings),
      // Manual only, never the model's. See the field's `autoNote`: a series may have one
      // pillar and the database enforces it with a partial unique index, so a model guessing
      // `true` turns a good post into an E11000 at save. The route drops it too if the
      // series already has a hub.
      isPillar: manualBoolean(spec, 'isPillar') ?? false,
      language,
      tags: resolveTags(spec, payload, warnings),
      relatedSlugs: resolveRelated(spec, payload, context, warnings),
      coverImagePrompt: normaliseImagePrompt(payload.coverImagePrompt),
      imagePrompts: resolveImagePrompts(payload, bodyMarkdown, warnings),
    },
    warnings,
  }
}

/**
 * Image prompts, reconciled against the placeholders that are actually in the body.
 *
 * The body is the source of truth and the `imagePrompts` array is a lookup beside it, so this
 * is an inner join rather than a copy. Both halves of that matter:
 *
 * - A prompt for `image3` when the body has no `image3` is an orphan. Stored, it would sit in
 *   the document forever, invisible - the editor only renders cards for keys it finds in the
 *   markdown - so it is dropped here rather than kept "just in case".
 * - A placeholder with no prompt is the opposite and much worse: the editor shows a card for
 *   it either way, so the author sees the slot. It gets an empty prompt and a warning, and
 *   the regenerate button on that card fills it in one click.
 *
 * Both are silent failures if left alone, which is why each produces a warning naming the key.
 */
function resolveImagePrompts(
  payload: Record<string, unknown>,
  bodyMarkdown: string,
  warnings: string[]
): { key: string; prompt: string }[] {
  const placeholders = findImagePlaceholders(bodyMarkdown)
  if (placeholders.length === 0) return []

  const byKey = new Map<string, string>()
  if (Array.isArray(payload.imagePrompts))
    for (const entry of payload.imagePrompts) {
      if (!entry || typeof entry !== 'object') continue
      const { key, prompt } = entry as { key?: unknown; prompt?: unknown }
      if (typeof key !== 'string') continue
      byKey.set(key.trim(), normaliseImagePrompt(prompt))
    }

  const missing: string[] = []
  // The schema caps `imagePrompts` at 12 and rejects the whole document past it, so the cap is
  // applied here rather than discovered as a ValidationError after a minute of generation -
  // the same reason `resolveTags` breaks at 8 and `resolveRelated` at 5. Losing the thirteenth
  // prompt costs one regenerate click; losing the document costs the whole paid generation.
  const kept = placeholders.slice(0, MAX_IMAGE_PROMPTS)
  const overflow = placeholders.slice(MAX_IMAGE_PROMPTS)
  const resolved = kept.map(placeholder => {
    const prompt = byKey.get(placeholder.key) ?? ''
    if (!prompt) missing.push(placeholder.key)
    byKey.delete(placeholder.key)
    return { key: placeholder.key, prompt }
  })

  if (overflow.length) {
    // The placeholders themselves stay in the body - dropping them there would leave the post
    // referring to images the author was never told about. They get no prompt row, which the
    // editor renders as an empty card with a regenerate button, so the slot is still visible.
    for (const placeholder of overflow) byKey.delete(placeholder.key)
    warnings.push(
      `The body has ${placeholders.length} image placeholders and only ${MAX_IMAGE_PROMPTS} can carry a prompt. No prompt was kept for ${overflow.map(placeholder => placeholder.key).join(', ')} - use the regenerate button on those cards, or cut the extra placeholders.`
    )
  }

  if (missing.length)
    warnings.push(
      `No image prompt came back for ${missing.join(', ')}. Use the regenerate button on that card.`
    )

  if (byKey.size > 0)
    warnings.push(
      `Dropped ${byKey.size} image prompt${byKey.size === 1 ? '' : 's'} with no placeholder in the body: ${Array.from(byKey.keys()).join(', ')}.`
    )

  return resolved
}

/**
 * A slug, from the author, the model, or the title - in that order.
 *
 * The title fallback is what makes this non-fatal. `slugify` cannot fail: it whitelists to
 * `[a-z0-9-]`, and a title with no usable characters at all still has the `post` floor below
 * it. Uniqueness is NOT settled here - it needs the collection, so the route does it.
 */
/**
 * Every manual-field check that does not need the model's reply, run BEFORE the model is called.
 *
 * ## Why this function exists as a separate pass
 *
 * All three of these checks already live inside `parseGeneratedDraft`, which runs on the reply.
 * That is far too late: `chatCompletion` takes twenty to ninety seconds and costs money, so an
 * author who flipped Slug to manual and typed "Five Things I Measured" waited out a whole
 * generation to be told the slug does not match `^[a-z0-9-]{1,80}$`, with nothing saved. The
 * spec and the taxonomies are both fully in hand before the call - there was never a reason to
 * wait.
 *
 * It is the same principle the pillar guard states in `generate/route.ts`: checking first turns
 * a lost generation into a warning and a saved post.
 *
 * The checks inside `parseGeneratedDraft` are deliberately NOT removed. They are what make that
 * function safe to call on its own, and they are what a future second caller will rely on. This
 * is an early exit, not the only gate.
 */
export function validateManualSpec(
  spec: GenerationSpec,
  context: GenerationContext
): void {
  const slug = manualString(spec, 'slug')
  if (slug) {
    if (!SLUG_PATTERN.test(slug))
      throw new GenerationError('Slug must match ^[a-z0-9-]{1,80}$.')

    if (isReservedSlug(slug))
      throw new GenerationError(
        `"${slug}" is reserved by a route and cannot be a post slug.`
      )
  }

  const kind = manualString(spec, 'kind')
  if (kind && !context.kinds.some(entry => entry.slug === kind))
    throw new GenerationError(
      `"${kind}" is not a kind. It may have been deleted.`
    )

  const series = manualString(spec, 'series')
  if (
    series &&
    series !== NO_SERIES &&
    !context.series.some(entry => entry.slug === series)
  )
    throw new GenerationError(
      `"${series}" is not a series. It may have been deleted.`
    )
}

function resolveSlug(
  spec: GenerationSpec,
  payload: Record<string, unknown>,
  title: string
): { slug: string; warning: string | null } {
  const manual = manualString(spec, 'slug')
  if (manual) {
    if (!SLUG_PATTERN.test(manual))
      throw new GenerationError('Slug must match ^[a-z0-9-]{1,80}$.')

    if (isReservedSlug(manual))
      throw new GenerationError(
        `"${manual}" is reserved by a route and cannot be a post slug.`
      )

    return { slug: manual, warning: null }
  }

  // `raw` is kept alongside the lowercased candidate so the warning can quote what the model
  // actually sent. Reporting our own normalised version back at the author is how a message
  // ends up describing a string that appears nowhere.
  const raw = typeof payload.slug === 'string' ? payload.slug.trim() : ''
  const proposed = raw.toLowerCase()
  if (SLUG_PATTERN.test(proposed) && !isReservedSlug(proposed))
    return { slug: proposed, warning: null }

  // `slugify` guarantees the PATTERN but not the RESERVED list - a post the model titles
  // "Privacy" slugifies to `privacy`, which the schema refuses. Suffixing here rather than
  // throwing, because by this point the generation is already paid for and a usable slug is
  // one the author can rename in the editor.
  const base = slugify(title)
  const fallback = isReservedSlug(base) ? `${base}-post` : base
  return {
    slug: fallback,
    warning: raw
      ? `The model proposed the slug "${raw.slice(0, 80)}", which is not usable. Using "${fallback}".`
      : `The model returned no slug. Using "${fallback}", derived from the title.`,
  }
}

/** Title to slug. Whitelist rather than blacklist, so no input can produce an invalid slug. */
export function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .normalize('NFD')
    // Strip combining marks so Vietnamese titles keep their letters instead of losing them:
    // "đã" would otherwise become "" rather than "a".
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '')

  return slug || 'post'
}

function resolveKind(
  spec: GenerationSpec,
  payload: Record<string, unknown>,
  context: GenerationContext,
  warnings: string[]
): string {
  const known = new Set(context.kinds.map(kind => kind.slug))
  const fallback = context.kinds[0]?.slug

  const manual = manualString(spec, 'kind')
  if (manual) {
    if (!known.has(manual))
      throw new GenerationError(
        `"${manual}" is not a kind. It may have been deleted.`
      )

    return manual
  }

  const proposed = typeof payload.kind === 'string' ? payload.kind.trim() : ''
  if (known.has(proposed)) return proposed

  if (!fallback)
    throw new GenerationError(
      'No post kinds exist. Create one before generating a post.'
    )

  warnings.push(
    proposed
      ? `The model chose the kind "${proposed.slice(0, 80)}", which does not exist. Using "${fallback}".`
      : `The model returned no kind. Using "${fallback}".`
  )
  return fallback
}

function resolveSeries(
  spec: GenerationSpec,
  payload: Record<string, unknown>,
  context: GenerationContext,
  warnings: string[]
): string | null {
  const known = new Set(context.series.map(entry => entry.slug))

  const manual = manualString(spec, 'series')
  if (manual === NO_SERIES) return null
  if (manual) {
    if (!known.has(manual))
      throw new GenerationError(
        `"${manual}" is not a series. It may have been deleted.`
      )

    return manual
  }

  const proposed =
    typeof payload.series === 'string' ? payload.series.trim() : ''
  if (!proposed) return null
  if (known.has(proposed)) return proposed

  // Not fatal and not silently coerced to the nearest series. A wrong cluster is worse than
  // none: `/blog` renders series as hubs, so a misfiled post dilutes a cluster the author
  // built deliberately, and "no series" is a state the board already shows plainly.
  warnings.push(
    `The model chose the series "${proposed.slice(0, 80)}", which does not exist. Saved without a series.`
  )
  return null
}

/**
 * The post's language, and on auto the fallback is Vietnamese.
 *
 * The reply is still believed when it says `en`: a brief whose topic is an English-language
 * conference talk can reasonably come back in English, and overriding that would store `vi` on
 * a post that is visibly not, which `<article lang>` then lies about to a screen reader. What
 * changed is which way an ABSENT or unrecognised value falls. It used to be English, which was
 * right when the blog was English-first; it is now Vietnamese, so a model that omits the field
 * entirely does not silently produce the one language the author did not ask for.
 */
function resolveLanguage(
  spec: GenerationSpec,
  payload: Record<string, unknown>
): 'vi' | 'en' {
  const manual = manualString(spec, 'language')
  if (manual === 'vi' || manual === 'en') return manual
  return payload.language === 'en' ? 'en' : 'vi'
}

/**
 * Tags, from a manual comma-separated line or the model's array.
 *
 * Both paths go through the same normaliser, because the failure is the same on both: `TAG_PATTERN`
 * is `^[a-z0-9-]{1,32}$` and the natural thing to type - or generate - is `Next.js 16`. Lowercasing
 * and hyphenating recovers that as `next-js-16` instead of dropping it, and only a tag that is
 * still empty afterwards is reported.
 */
function resolveTags(
  spec: GenerationSpec,
  payload: Record<string, unknown>,
  warnings: string[]
): string[] {
  const manual = manualString(spec, 'tags')
  const raw = manual
    ? manual.split(',')
    : Array.isArray(payload.tags)
      ? payload.tags.filter((tag): tag is string => typeof tag === 'string')
      : []

  const out: string[] = []
  const rejected: string[] = []

  for (const candidate of raw) {
    const normalised = candidate
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32)
      .replace(/-+$/, '')

    if (!normalised || !TAG_PATTERN.test(normalised)) {
      if (candidate.trim()) rejected.push(candidate.trim())
      continue
    }
    if (!out.includes(normalised)) out.push(normalised)
    // The schema caps tags at 8 and rejects the whole document past it, so the cap is applied
    // here rather than discovered as a ValidationError after a minute of generation.
    if (out.length === 8) break
  }

  if (rejected.length)
    // Bounded: `rejected` is uncapped and every entry is model-controlled, so a reply with 500
    // junk tags would otherwise build one enormous warning string and render it as a single
    // list item. Naming the first few is all the author needs to see the shape of the problem.
    warnings.push(
      `Dropped ${rejected.length} unusable tag${rejected.length === 1 ? '' : 's'}: ${summariseList(rejected)}.`
    )

  return out
}

function resolveRelated(
  spec: GenerationSpec,
  payload: Record<string, unknown>,
  context: GenerationContext,
  warnings: string[]
): string[] {
  const known = new Set(context.relatedCandidates.map(post => post.slug))

  const manual = manualList(spec, 'relatedSlugs')
  const raw =
    manual ??
    (Array.isArray(payload.relatedSlugs)
      ? payload.relatedSlugs.filter(
          (slug): slug is string => typeof slug === 'string'
        )
      : [])

  const out: string[] = []
  const invented: string[] = []

  for (const candidate of raw.map(slug => slug.trim())) {
    if (!candidate) continue
    if (!known.has(candidate)) {
      invented.push(candidate)
      continue
    }
    if (!out.includes(candidate)) out.push(candidate)
    if (out.length === 5) break
  }

  if (invented.length)
    // Worth naming rather than dropping quietly: an invented related slug renders as a link
    // to a 404 on a published post, and it is the failure mode a model is most prone to here
    // because a plausible slug is trivial to write and impossible to distinguish by eye.
    warnings.push(
      `Dropped ${invented.length} related post${invented.length === 1 ? '' : 's'} that do not exist: ${summariseList(invented)}.`
    )

  return out
}
