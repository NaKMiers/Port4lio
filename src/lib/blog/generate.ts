import {
  isReservedSlug,
  MAX_IMAGE_PROMPTS,
  SLUG_PATTERN,
  TAG_PATTERN,
} from '@/lib/blog/constants'
import {
  CODE_LANGUAGE_OPTIONS,
  manualBoolean,
  manualList,
  manualString,
  NO_SERIES,
  resolveTemperature,
  type GenerationSpec,
} from '@/lib/blog/generation-fields'
import { findImagePlaceholders, placeholderKeys, placeholderMarkdown } from '@/lib/blog/image-placeholders'
import { IMAGE_PROMPT_RULES, normaliseImagePrompt } from '@/lib/blog/image-prompt'

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
  return values.length > limit ? `${head.join(', ')} and ${values.length - limit} more` : head.join(', ')
}

const WORD_TARGETS: Record<string, string> = {
  note: '150 to 500 words',
  short: '500 to 800 words',
  standard: '800 to 1200 words',
  long: '1500 to 2500 words',
}

/**
 * The house style, and it is almost entirely a list of things not to do.
 *
 * Every line here exists because it is a default the model has and this blog does not. The
 * "no em dash" rule is the load-bearing one: an em dash between clauses is the single most
 * recognisable tell of generated prose in 2026, and `docs/blog/authoring.md` says outright
 * that reading as generated is the one way this blog fails at its only job. The repo's own
 * prose uses a spaced hyphen throughout - including this sentence - so the rule also keeps a
 * generated post indistinguishable in shape from a written one.
 */
const HOUSE_STYLE = [
  'Never use an em dash or an en dash. Use a spaced hyphen ("like - this") or rewrite the sentence.',
  'No arrow glyphs in prose. Write the word.',
  'No "delve", "leverage" as a verb, "in today\'s fast-paced", "it is worth noting", "in conclusion", "unlock", "robust", "seamless", "game-changer".',
  'No three-item lists of adjectives. No sentence that opens "But here is the thing".',
  'Do not open with a definition or with background the reader already has. Open on the specific thing that happened.',
  'Claims carry evidence: a number, an error message, a command, or a named alternative that was rejected. A paragraph with none of those is a paragraph to cut.',
  'Short paragraphs. Two to four sentences. Vary sentence length - a run of same-length sentences is the other tell.',
  'Do not summarise the post at the end. Stop when the point is made.',
]

/**
 * Rules about the markdown itself, all of which come from the rendering pipeline downstream.
 *
 * These are not preferences. `## ` and not `# ` because `page.tsx` renders `post.title` in
 * the page's only `h1` and a second one is a real accessibility defect; no images because
 * `rehypeRestrictImageHosts` drops every `src` that is not this site's Cloudinary account, so
 * an invented image URL renders as a broken node; fenced languages restricted because
 * `downgradeUnknownFences` silently strips highlighting from a grammar Shiki does not carry.
 */
function markdownRules(codeLanguage: string | undefined): string[] {
  return [
    'Markdown only. No front matter, no HTML tags - raw HTML is dropped by the renderer, not escaped.',
    'Start at `## `. The title is rendered above the body as the page\'s only h1, so the body must not contain one.',
    /*
      This used to be a flat "no images", which was right when there was nowhere for one to
      come from: `rehypeRestrictImageHosts` refuses every `src` that is not this site's own
      Cloudinary account. It does that by deleting the ATTRIBUTE and keeping the node, so an
      invented URL publishes as `<img alt="...">` - a broken-image icon on a live post, which
      is worse than no picture and exactly what the placeholder form replaces: `image1` is
      refused by the same rule, but the editor knows what it means and offers an upload slot
      for it.
    */
    'Never write a real image URL. You do not know one, and an invented one is refused by the renderer and published as a broken image.',
    codeLanguage
      ? `Fenced code blocks must be tagged \`${codeLanguage}\`.`
      // Built from the option list rather than typed out, so adding a language to the dropdown
      // cannot leave auto mode offering the old set. `blog-generation-fields.test.ts` already
      // ties that list to `SHIKI_LANGUAGES`; this makes the prompt inherit the same guarantee.
      : `Tag every fenced code block with one of: ${CODE_LANGUAGE_OPTIONS.map(option => option.value).join(', ')}. An untagged or unknown fence loses its highlighting.`,
    'Links are welcome but must be real. Do not invent a URL to a doc page you are not sure exists.',
  ]
}

/** How many placeholders auto mode allows. Two is "where a picture helps", not a gallery. */
const AUTO_IMAGE_CEILING = 2

/**
 * What to tell the model about pictures, given the `imageCount` field.
 *
 * Auto is a CEILING and explicitly permits zero. The alternative - always asking for one -
 * would put a decorative image on every note, and a note is 150 words: the picture would be
 * larger than the post and would have to be made before the post could ship. A model told
 * "up to two, none if none helps" leaves plenty of posts with none, which is the right
 * distribution for a blog whose articles are about measurements.
 */
function imageDirective(count: number | null): string[] {
  if (count === 0) {
    return ['- Images: none. Do not write any image placeholder.']
  }

  const exact = count !== null
  const keys = placeholderKeys(exact ? count : AUTO_IMAGE_CEILING)

  return [
    exact
      ? `- Images: exactly ${count}, using ${keys.map(key => `\`${key}\``).join(' and ')}${count > 1 ? ', in that order' : ''}.`
      : `- Images: up to ${AUTO_IMAGE_CEILING}, numbered from \`image1\`. None at all is a fine answer - only place one where a picture earns its space.`,
    `  Write each as \`${placeholderMarkdown('image1')}\` on its own line, in the body, where the picture belongs.`,
    '  Then give a matching entry in `imagePrompts` for every placeholder you used, and only those.',
  ]
}

/** `- Label: <what the model should do>` for one field, manual or auto. */
function directive(label: string, manual: string | undefined, auto: string): string {
  return manual ? `- ${label}: ${manual}` : `- ${label}: ${auto}`
}

export function buildGenerationPrompt(
  spec: GenerationSpec,
  context: GenerationContext
): { system: string; user: string } {
  const kindList = context.kinds.map(kind => `${kind.slug} (${kind.label})`).join(', ')
  const seriesList = context.series
    .map(entry => `${entry.slug} - ${entry.title}: ${entry.blurb}`)
    .join('\n  ')

  const length = manualString(spec, 'length')
  const wordTarget = WORD_TARGETS[length ?? ''] ?? null
  const codeLanguage = manualString(spec, 'codeLanguage')
  const genres = manualList(spec, 'genres')
  const structure = manualString(spec, 'structure')
  const titleRule = manualBoolean(spec, 'titleRule')
  const manualSeries = manualString(spec, 'series')

  const system = [
    'You write one blog post for a working software engineer\'s personal site and return it as a single JSON object.',
    '',
    'The blog exists to make a senior engineer reading it believe the author thinks well. Prose that reads as machine-written fails at that, so the style rules below are requirements rather than preferences.',
    '',
    '# House style',
    ...HOUSE_STYLE.map(rule => `- ${rule}`),
    '',
    '# Markdown rules',
    ...markdownRules(codeLanguage).map(rule => `- ${rule}`),
    '',
    '# Image prompts',
    'You cannot produce images, so you produce the brief for them: a placeholder in the body and a prompt for a text-to-image model. Every prompt follows these rules.',
    ...IMAGE_PROMPT_RULES.map(rule => `- ${rule}`),
    '',
    '# Output',
    'Return ONE JSON object and nothing else. No prose before it, no prose after it, no code fence.',
    '',
    '```json',
    '{',
    '  "title": "under 140 characters",',
    '  "slug": "lowercase-hyphenated, max 80 chars, matches ^[a-z0-9-]{1,80}$",',
    '  "excerpt": "one or two sentences, under 300 characters, no trailing ellipsis",',
    `  "kind": "one of: ${context.kinds.map(kind => kind.slug).join(' | ') || 'article'}",`,
    `  "series": ${context.series.length ? `"one of: ${context.series.map(entry => entry.slug).join(' | ')}" or null` : 'null'},`,
    '  "language": "en" or "vi",',
    '  "tags": ["three-to-six", "lowercase-hyphenated", "max-8"],',
    '  "relatedSlugs": ["slugs-from-the-list-below-only, at most 5, [] if none fit"],',
    '  "coverImagePrompt": "a text-to-image prompt for the cover, under the rules above",',
    '  "imagePrompts": [{"key": "image1", "prompt": "a text-to-image prompt for that placeholder"}],',
    '  "bodyMarkdown": "the whole post, starting at a ## heading"',
    '}',
    '```',
    '',
    'Every string must be valid JSON - escape newlines in `bodyMarkdown` as \\n. Do not truncate the body to fit; write to the length asked for.',
  ].join('\n')

  const user = [
    '# The brief',
    '',
    'Fields marked "you choose" are yours to decide, and your choice goes in the JSON. Every other field is a constraint.',
    '',
    '## Subject',
    directive(
      'Topic',
      manualString(spec, 'topic'),
      'you choose, from the series and genres below. Prefer something concrete and measured over a survey of a subject.'
    ),
    directive('Blog name', manualString(spec, 'title'), 'you choose'),
    directive('Slug', manualString(spec, 'slug'), 'you choose, derived from the title'),
    directive('Excerpt', manualString(spec, 'excerpt'), 'you choose, written after the body'),
    directive(
      'Tags',
      manualString(spec, 'tags'),
      'you choose, three to six, lowercase and hyphenated'
    ),
    '',
    '## Placement',
    `- Kinds that exist: ${kindList || 'article'}`,
    directive('Kind', manualString(spec, 'kind'), 'you choose, against the length below'),
    context.series.length ? `- Series that exist:\n  ${seriesList}` : '- No series exist yet; return null.',
    directive(
      'Series',
      manualSeries === NO_SERIES ? 'null - this post belongs to no series' : manualSeries,
      'you choose one, or null if the topic fits none of them. Do not force a fit.'
    ),
    directive('Language', manualString(spec, 'language'), 'en'),
    context.relatedCandidates.length
      ? [
          '- Published posts you may reference in `relatedSlugs` (use the slug exactly, or return []):',
          ...context.relatedCandidates.map(post => `  - ${post.slug} - ${post.title}`),
        ].join('\n')
      : '- No published posts exist yet. `relatedSlugs` must be [].',
    manualList(spec, 'relatedSlugs')?.length
      ? `- Related posts: use exactly these - ${manualList(spec, 'relatedSlugs')!.join(', ')}`
      : '- Related posts: you choose, at most five, only from the list above.',
    '',
    '## Craft',
    directive('Style', manualString(spec, 'style'), 'you choose, matched to the topic'),
    directive('Tone', manualString(spec, 'tone'), 'plain and direct'),
    genres?.length
      ? `- Genres: ${genres.join(', ')}`
      : '- Genres: you choose, inferred from the topic',
    directive('Audience', manualString(spec, 'audience'), 'senior engineers'),
    directive('Point of view', manualString(spec, 'pointOfView'), 'first person'),
    structure === 'seven-step'
      ? [
          '- Structure: the seven-step template, in this order, as `##` sections with your own headings:',
          '  1. Context - what was being built, in two sentences',
          '  2. What I measured - the thing actually run',
          '  3. What I expected - the documented or obvious answer',
          '  4. What happened - the number, the output, the error',
          '  5. Root cause - why',
          '  6. What I rejected - the fixes not taken, and why. Do not skip this one; it is the section that shows judgement.',
          '  7. What I would tell you - the one-line takeaway',
        ].join('\n')
      : directive('Structure', structure, 'you choose, matched to the style'),
    `- Length: ${wordTarget ?? 'you choose - a note is 150 to 500 words, an article is 800 to 2000'}`,
    directive('Code examples', manualString(spec, 'codeExamples'), 'as many as the topic needs'),
    ...imageDirective(resolveImageCount(spec)),
    titleRule === true
      ? '- The title MUST contain a number or a named failure. "Five things Next.js 16 did that its docs did not say" or "revalidateTag did not invalidate anything", never "Some thoughts on caching".'
      : titleRule === false
        ? '- The title does not need to carry a number.'
        : '- If this is an article, the title must contain a number or a named failure. A note may have a plain title.',
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

  const bodyMarkdown = typeof payload.bodyMarkdown === 'string' ? payload.bodyMarkdown.trim() : ''
  // Fatal, and the only genuinely fatal content failure. Everything else on a post can be
  // filled in from a fallback that is honest; a body cannot.
  if (!bodyMarkdown) {
    throw new GenerationError('The model returned no post body.')
  }
  if (bodyMarkdown.length > MAX_BODY_CHARS) {
    throw new GenerationError(
      `The model returned ${bodyMarkdown.length} characters, past the ${MAX_BODY_CHARS} a post may store.`
    )
  }

  const manualTitle = manualString(spec, 'title')
  const modelTitle = typeof payload.title === 'string' ? payload.title.trim() : ''
  const title = (manualTitle ?? modelTitle).slice(0, 140)
  if (!title) {
    throw new GenerationError('The model returned no title, and none was given.')
  }

  const { slug, warning: slugWarning } = resolveSlug(spec, payload, title)
  if (slugWarning) warnings.push(slugWarning)

  const manualExcerpt = manualString(spec, 'excerpt')
  const modelExcerpt = typeof payload.excerpt === 'string' ? payload.excerpt.trim() : ''
  const excerpt = (manualExcerpt ?? modelExcerpt).slice(0, 300)

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
      language: resolveLanguage(spec, payload),
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
  if (Array.isArray(payload.imagePrompts)) {
    for (const entry of payload.imagePrompts) {
      if (!entry || typeof entry !== 'object') continue
      const { key, prompt } = entry as { key?: unknown; prompt?: unknown }
      if (typeof key !== 'string') continue
      byKey.set(key.trim(), normaliseImagePrompt(prompt))
    }
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

  if (missing.length) {
    warnings.push(
      `No image prompt came back for ${missing.join(', ')}. Use the regenerate button on that card.`
    )
  }
  if (byKey.size > 0) {
    warnings.push(
      `Dropped ${byKey.size} image prompt${byKey.size === 1 ? '' : 's'} with no placeholder in the body: ${Array.from(byKey.keys()).join(', ')}.`
    )
  }

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
export function validateManualSpec(spec: GenerationSpec, context: GenerationContext): void {
  const slug = manualString(spec, 'slug')
  if (slug) {
    if (!SLUG_PATTERN.test(slug)) {
      throw new GenerationError('Slug must match ^[a-z0-9-]{1,80}$.')
    }
    if (isReservedSlug(slug)) {
      throw new GenerationError(`"${slug}" is reserved by a route and cannot be a post slug.`)
    }
  }

  const kind = manualString(spec, 'kind')
  if (kind && !context.kinds.some(entry => entry.slug === kind)) {
    throw new GenerationError(`"${kind}" is not a kind. It may have been deleted.`)
  }

  const series = manualString(spec, 'series')
  if (series && series !== NO_SERIES && !context.series.some(entry => entry.slug === series)) {
    throw new GenerationError(`"${series}" is not a series. It may have been deleted.`)
  }
}

function resolveSlug(
  spec: GenerationSpec,
  payload: Record<string, unknown>,
  title: string
): { slug: string; warning: string | null } {
  const manual = manualString(spec, 'slug')
  if (manual) {
    if (!SLUG_PATTERN.test(manual)) {
      throw new GenerationError('Slug must match ^[a-z0-9-]{1,80}$.')
    }
    if (isReservedSlug(manual)) {
      throw new GenerationError(`"${manual}" is reserved by a route and cannot be a post slug.`)
    }
    return { slug: manual, warning: null }
  }

  // `raw` is kept alongside the lowercased candidate so the warning can quote what the model
  // actually sent. Reporting our own normalised version back at the author is how a message
  // ends up describing a string that appears nowhere.
  const raw = typeof payload.slug === 'string' ? payload.slug.trim() : ''
  const proposed = raw.toLowerCase()
  if (SLUG_PATTERN.test(proposed) && !isReservedSlug(proposed)) {
    return { slug: proposed, warning: null }
  }

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
    if (!known.has(manual)) {
      throw new GenerationError(`"${manual}" is not a kind. It may have been deleted.`)
    }
    return manual
  }

  const proposed = typeof payload.kind === 'string' ? payload.kind.trim() : ''
  if (known.has(proposed)) return proposed

  if (!fallback) {
    throw new GenerationError('No post kinds exist. Create one before generating a post.')
  }
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
    if (!known.has(manual)) {
      throw new GenerationError(`"${manual}" is not a series. It may have been deleted.`)
    }
    return manual
  }

  const proposed = typeof payload.series === 'string' ? payload.series.trim() : ''
  if (!proposed) return null
  if (known.has(proposed)) return proposed

  // Not fatal and not silently coerced to the nearest series. A wrong cluster is worse than
  // none: `/blog` renders series as hubs, so a misfiled post dilutes a cluster the author
  // built deliberately, and "no series" is a state the board already shows plainly.
  warnings.push(`The model chose the series "${proposed.slice(0, 80)}", which does not exist. Saved without a series.`)
  return null
}

function resolveLanguage(spec: GenerationSpec, payload: Record<string, unknown>): 'vi' | 'en' {
  const manual = manualString(spec, 'language')
  if (manual === 'vi' || manual === 'en') return manual
  return payload.language === 'vi' ? 'vi' : 'en'
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

  if (rejected.length) {
    // Bounded: `rejected` is uncapped and every entry is model-controlled, so a reply with 500
    // junk tags would otherwise build one enormous warning string and render it as a single
    // list item. Naming the first few is all the author needs to see the shape of the problem.
    warnings.push(
      `Dropped ${rejected.length} unusable tag${rejected.length === 1 ? '' : 's'}: ${summariseList(rejected)}.`
    )
  }

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
      ? payload.relatedSlugs.filter((slug): slug is string => typeof slug === 'string')
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

  if (invented.length) {
    // Worth naming rather than dropping quietly: an invented related slug renders as a link
    // to a 404 on a published post, and it is the failure mode a model is most prone to here
    // because a plausible slug is trivial to write and impossible to distinguish by eye.
    warnings.push(
      `Dropped ${invented.length} related post${invented.length === 1 ? '' : 's'} that do not exist: ${summariseList(invented)}.`
    )
  }

  return out
}
