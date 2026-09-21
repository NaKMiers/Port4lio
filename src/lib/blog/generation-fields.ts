/**
 * Every knob on the "Generate blog" dialog, declared once.
 *
 * ```
 *   generation-fields.ts  ─┬─▶ GenerateBlogDialog.tsx   renders the form FROM this list
 *                          ├─▶ api/admin/blog/generate  validates the body AGAINST this list
 *                          └─▶ generate.ts              writes the prompt FROM this list
 * ```
 *
 * ## Why a registry rather than 24 fields written out three times
 *
 * The dialog has two dozen properties and each one appears in three places: an input, a
 * validator, and a line of the prompt. Written by hand that is 72 sites that must agree, and
 * the way they stop agreeing is silent - a field the form offers but the validator does not
 * know is dropped on the floor, and the author sees a post that ignored the instruction they
 * just typed with no error anywhere. Adding a property here adds all three at once.
 *
 * ## No imports, on purpose - the same rule `constants.ts` follows
 *
 * `GenerateBlogDialog` is a client component. Anything reachable from here ends up in the
 * browser bundle, so this file imports nothing at all rather than risk the mongoose ->
 * mongodb chain that `constants.ts` was extracted from `models/Post.ts` to avoid.
 *
 * The one cost of that rule is `CODE_LANGUAGE_OPTIONS`, which must stay a subset of
 * `SHIKI_LANGUAGES` in `lib/blog/markdown.ts` (server-only, so it cannot be imported here).
 * `tests/unit/blog-generation-fields.test.ts` holds that relationship instead - offering a
 * fence language Shiki has no grammar for would silently downgrade every code block in the
 * generated post to plain text.
 *
 * ## Auto vs manual, and what "auto" actually means
 *
 * Every field carries a mode. `manual` puts the author's value in the prompt as a constraint
 * and, for the fields that are post columns, writes it to the document verbatim. `auto` -
 * the default on all of them - tells the model to decide, and the decision comes back in the
 * same JSON as the post body so it can be validated like anything else the model wrote.
 *
 * There is no third mode. "Auto" is not "leave it empty": a generated post with no kind
 * fails the schema, and one with no tags is a post nobody finds.
 */

export type FieldControl =
  'text' | 'textarea' | 'select' | 'multiselect' | 'boolean'

/**
 * Where a select's choices come from when they are not known at build time.
 *
 * Kinds and series are runtime-editable collections and post slugs are data, so the three of
 * them cannot be `options` on a static registry. The dialog fetches each list and the route
 * validates against the collection - the same split, and the same reason, as the missing
 * mongoose enums on `Post.kind` and `Post.series`.
 */
export type FieldOptionSource = 'kinds' | 'series' | 'slugs'

export type FieldGroup = 'identity' | 'taxonomy' | 'craft' | 'engine'

export type FieldOption = { value: string; label: string }

export type GenerationField = {
  key: GenerationFieldKey
  label: string
  group: FieldGroup
  control: FieldControl
  options?: readonly FieldOption[]
  optionsFrom?: FieldOptionSource
  placeholder?: string
  /** Rendered in place of the input while the switch is on auto. Says what the model decides. */
  autoNote: string
  /** Bound applied to a manual string before it reaches the prompt. */
  maxLength?: number
  /** Cap on a multiselect's selections. */
  maxItems?: number
}

export const GROUP_LABELS: Record<FieldGroup, string> = {
  identity: 'Identity',
  taxonomy: 'Taxonomy',
  craft: 'Craft',
  engine: 'Engine',
}

export const GROUP_INTROS: Record<FieldGroup, string> = {
  identity:
    'What the post is called and how it is summarised. These are post columns, so a manual value is written verbatim.',
  taxonomy:
    'Where the post sits on /blog. Validated against the collections, so a deleted kind or series is refused rather than dangling.',
  craft:
    'How it should be written. None of these are stored - they only shape the prompt.',
  engine: 'Which model writes it, and how far it may wander from the brief.',
}

/**
 * The formats, and the last four come from `docs/blog/what-good-looks-like.md`.
 *
 * The first seven are this blog's own shapes. The four added below are the ones the research
 * found actually working on other people's sites, each kept because it does something the
 * existing seven cannot:
 *
 * - `personal-essay` is the shape of a post that travels. The research finding is that people
 *   share what says something about who they are, and none of the engineering formats has
 *   anywhere to put that.
 * - `deep-dive` is the Wait But Why shape: one topic taken all the way down. It is the only
 *   format here that justifies the pillar length tier.
 * - `build-log` is the income-report mechanism with the money taken out: specific numbers
 *   about your own work, published on a schedule. Original data is the most-cited content
 *   type by AI engines, and this is the format that produces it on purpose.
 * - `digest` is the Ben's Bites shape. It is the one format that is allowed to be mostly
 *   other people's news, so it carries its own risk - see the directive in `generate.ts`.
 */
export const STYLE_OPTIONS = [
  {
    value: 'measured-teardown',
    label: 'Measured teardown - a number that contradicted the docs',
  },
  {
    value: 'postmortem',
    label: 'Postmortem - what broke, why, and what was rejected',
  },
  { value: 'tutorial', label: 'Tutorial - do this, then this' },
  { value: 'listicle', label: 'Numbered list - N things, each with evidence' },
  { value: 'opinion', label: 'Opinion - a claim, defended' },
  { value: 'narrative', label: 'Narrative - the story in order' },
  {
    value: 'reference',
    label: 'Reference - the thing you look up twice a year',
  },
  {
    value: 'personal-essay',
    label: 'Personal essay - one scene, one arc, one revelation',
  },
  {
    value: 'deep-dive',
    label: 'Deep dive - one big topic, taken all the way down',
  },
  {
    value: 'build-log',
    label: 'Build log - what I shipped this month, with the numbers',
  },
  {
    value: 'digest',
    label: 'Digest - what happened, curated, in a fixed shape',
  },
] as const

export const TONE_OPTIONS = [
  { value: 'plain', label: 'Plain' },
  { value: 'direct', label: 'Direct' },
  { value: 'wry', label: 'Wry' },
  { value: 'analytical', label: 'Analytical' },
  { value: 'warm', label: 'Warm' },
  { value: 'blunt', label: 'Blunt' },
] as const

export const GENRE_OPTIONS = [
  { value: 'engineering', label: 'Engineering' },
  { value: 'measurement', label: 'Measurement' },
  { value: 'performance', label: 'Performance' },
  { value: 'architecture', label: 'Architecture' },
  { value: 'tooling', label: 'Tooling' },
  { value: 'testing', label: 'Testing' },
  { value: 'security', label: 'Security' },
  { value: 'product', label: 'Product' },
  { value: 'career', label: 'Career' },
  { value: 'retrospective', label: 'Retrospective' },
] as const

export const AUDIENCE_OPTIONS = [
  { value: 'senior-engineers', label: 'Senior engineers' },
  { value: 'hiring-managers', label: 'Hiring managers' },
  { value: 'junior-developers', label: 'Junior developers' },
  { value: 'technical-founders', label: 'Technical founders' },
  { value: 'generalists', label: 'Generalists' },
] as const

export const POV_OPTIONS = [
  { value: 'first-person', label: 'First person - I built, I measured' },
  { value: 'second-person', label: 'Second person - you will hit this' },
  {
    value: 'impersonal',
    label: 'Impersonal - the build does, the route returns',
  },
] as const

export const STRUCTURE_OPTIONS = [
  /*
    First, and named after the file it comes from. `docs/blog/authoring.md` carries a
    seven-step template whose sixth step - "what I rejected" - is the one the doc calls the
    seniority signal, and it is exactly the step a model drops unless it is asked for by name.
    `buildGenerationPrompt` spells all seven out when this is selected.
  */
  {
    value: 'seven-step',
    label: 'The seven-step template (docs/blog/authoring.md)',
  },
  /*
    The next three come from `docs/blog/what-good-looks-like.md` and are spelled out in
    `buildGenerationPrompt` for the same reason the seven-step one is: a structure named but
    not described is a structure the model approximates from its own priors, which is how the
    one step that matters goes missing.
  */
  {
    value: 'zipline',
    label: 'Zipline - throughline first, then the ladder down',
  },
  {
    value: 'in-medias-res',
    label: 'In the middle of it - open in the action, land one revelation',
  },
  {
    value: 'pillar-hub',
    label: 'Pillar hub - the table of contents for a whole topic',
  },
  { value: 'problem-solution', label: 'Problem, then solution' },
  { value: 'chronological', label: 'Chronological' },
  { value: 'numbered-list', label: 'Numbered list' },
  { value: 'freeform', label: 'Freeform' },
] as const

/**
 * How the first two or three sentences work, which is the only part every reader reads.
 *
 * The research finding behind the field: a post that has not produced something - a scene, a
 * number, a claim - inside the first ten seconds has lost the reader, and the default a model
 * reaches for is the opposite of all five of these. It opens by describing the subject.
 * `HOUSE_STYLE` already bans that; this says what to do instead.
 */
export const HOOK_OPTIONS = [
  {
    value: 'scene',
    label: 'A scene - the moment it broke, or a line said out loud',
  },
  { value: 'number', label: 'The number - lead with the measurement' },
  { value: 'claim', label: 'The claim - state the conclusion in sentence one' },
  {
    value: 'question',
    label: 'The question - the one the reader already has',
  },
  {
    value: 'reframe',
    label: 'The reframe - "it is not what you think it is"',
  },
] as const

/**
 * Word targets, and the two tiers are the ones `docs/blog/authoring.md` commits to.
 *
 * `note` is 150-500 and `article` is 800-2000 there. The four values below bracket both, so
 * a length can be chosen independently of `kind` - which matters, because the model is
 * otherwise very willing to write 1400 words and call it a note.
 *
 * `pillar` is the fifth and it is not just "longer". The cited number is 2,500-5,000 words for
 * a hub page, and the reason to have a tier for it rather than telling authors to pick "long"
 * and ask for more is that a pillar is a different document: it covers a whole topic and links
 * down to the cluster, where a long article covers one thing at length. The ceiling is 4,000
 * rather than 5,000 because the body column is capped and a model asked for 5,000 words
 * routinely returns 3,000 anyway.
 */
export const LENGTH_OPTIONS = [
  { value: 'note', label: 'Note - 150 to 500 words' },
  { value: 'short', label: 'Short - 500 to 800 words' },
  { value: 'standard', label: 'Standard - 800 to 1200 words' },
  { value: 'long', label: 'Long - 1500 to 2500 words' },
  {
    value: 'pillar',
    label: 'Pillar - 2500 to 4000 words, covers a whole topic',
  },
] as const

export const CODE_OPTIONS = [
  { value: 'none', label: 'No code blocks' },
  { value: 'light', label: 'One or two short blocks' },
  { value: 'heavy', label: 'Code throughout' },
] as const

/**
 * MUST stay a subset of `SHIKI_LANGUAGES` in `lib/blog/markdown.ts`.
 *
 * A fence in a language Shiki has no grammar for is not an error - `downgradeUnknownFences`
 * rewrites it to `language-text` and logs. So offering `rust` here would produce posts whose
 * code blocks are silently colourless, which is the kind of defect nobody files a bug for.
 * The subset relationship is held by `tests/unit/blog-generation-fields.test.ts`, because
 * this file may not import a server-only module.
 */
export const CODE_LANGUAGE_OPTIONS = [
  { value: 'ts', label: 'TypeScript' },
  { value: 'tsx', label: 'TSX' },
  { value: 'js', label: 'JavaScript' },
  { value: 'jsx', label: 'JSX' },
  { value: 'bash', label: 'Bash' },
  { value: 'json', label: 'JSON' },
  { value: 'sql', label: 'SQL' },
  { value: 'python', label: 'Python' },
  { value: 'yaml', label: 'YAML' },
  { value: 'css', label: 'CSS' },
  { value: 'html', label: 'HTML' },
  { value: 'diff', label: 'Diff' },
] as const

/**
 * How many `![image](imageN)` placeholders the post is written around.
 *
 * Placeholders rather than pictures, because the router behind this feature has no image
 * model. What the generator produces is the brief - see `image-prompt.ts` - and the editor
 * turns each one into an upload slot.
 *
 * Capped at four. Past that the post is a gallery with captions, and every extra placeholder
 * is another thing the author has to go and make before the post can be published at all.
 *
 * "None - text only" stays first and stays a real choice, but it is no longer what auto drifts
 * to. See `expectedImageCount`: auto now DERIVES a count from the post's length instead of
 * offering a range. It offered one twice - "up to two, none is fine", then "one, or two if the
 * post has two things worth showing" - and both times the model returned the cheap end.
 */
export const IMAGE_COUNT_OPTIONS = [
  { value: '0', label: 'None - text only' },
  { value: '1', label: 'One' },
  { value: '2', label: 'Two' },
  { value: '3', label: 'Three' },
  { value: '4', label: 'Four' },
] as const

/**
 * The largest count `presetSpecFromPost` can pin, derived from the list above rather than
 * written twice. Adding a "Five" option used to leave regeneration silently capped at four
 * and the comment beside that cap wrong.
 */
export const MAX_PRESETTABLE_IMAGE_COUNT = IMAGE_COUNT_OPTIONS.length - 1

export const CTA_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'read-next', label: 'Point at another post' },
  { value: 'subscribe', label: 'Subscribe to the list' },
  { value: 'discuss', label: 'Invite a reply' },
  { value: 'hire-me', label: 'Available for work' },
] as const

/**
 * Vietnamese first, and first here means the default rather than the order.
 *
 * `emptyValueFor` opens a select on `options[0]`, so this tuple's head is what a field switched
 * to manual starts on - but the load-bearing half of the change is in `generate.ts`, where the
 * AUTO directive now says `vi` and `resolveLanguage` falls back to `vi`. Both had to move:
 * flipping only this one would leave every post generated with the switch untouched - which is
 * all of them, since auto is the default on every field - still coming out in English.
 *
 * The house style splits on this value too. `HOUSE_STYLE` is a list of English tells, and a
 * Vietnamese post has an entirely different set of them, so `VIETNAMESE_STYLE` is what gets
 * sent instead. A Vietnamese post written under English style rules reads as a translation,
 * which is the specific failure `docs/blog/authoring.md` names for the Viblo cross-post.
 */
export const LANGUAGE_OPTIONS = [
  { value: 'vi', label: 'Tieng Viet' },
  { value: 'en', label: 'English' },
] as const

/**
 * Creativity, as three words rather than a temperature slider.
 *
 * `resolveTemperature` maps these. A number on the dialog would invite tuning it by feel
 * against an outcome that takes 40 seconds to observe, which is not a loop anybody converges
 * on - and 0.7 vs 0.75 is not a decision that has ever changed a post.
 */
export const CREATIVITY_OPTIONS = [
  { value: 'grounded', label: 'Grounded - stay on the brief' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'inventive', label: 'Inventive - take an angle' },
] as const

const CREATIVITY_TEMPERATURE: Record<string, number> = {
  grounded: 0.2,
  balanced: 0.6,
  inventive: 0.9,
}

export function resolveTemperature(creativity: string | undefined): number {
  return (
    CREATIVITY_TEMPERATURE[creativity ?? ''] ?? CREATIVITY_TEMPERATURE.balanced
  )
}

/**
 * The models the router offers that are worth pointing at a blog post.
 *
 * Trimmed from the ~35 `GET /v1/models` returns. The rest are review variants and small fast
 * models; a dropdown of 35 makes the choice harder rather than better, and a model that is
 * cheap per token is not cheap when the output is a post nobody would publish.
 */
export const MODEL_OPTIONS = [
  { value: 'ag/claude-sonnet-4-6', label: 'Claude Sonnet 4.6 - the default' },
  {
    value: 'ag/claude-opus-4-6-thinking',
    label: 'Claude Opus 4.6 (thinking) - slower, stronger',
  },
  { value: 'cx/gpt-6-astra', label: 'GPT-6 Astra' },
  { value: 'ag/gemini-3.8-flash', label: 'Gemini 3.8 Flash - fastest' },
] as const

export const DEFAULT_MODEL = 'ag/claude-sonnet-4-6'

/**
 * Image-generation models - one list, shared by the cover's Generate button and every
 * placeholder card in "Images to make". Google's own model ids, not router aliases -
 * `chatCompletion`'s router has no image model (see the comment on `Post.coverImagePrompt`),
 * so `lib/blog/image-gen.ts` calls Google's Generative Language API directly, the same host
 * `llm.ts` already falls back to for text. Verified present on this project's `GOOGLE_API_KEY`
 * via `GET /v1beta/models` - both return `image/jpeg` bytes from the same `generateContent`
 * shape the text fallback uses, just with an `inlineData` part instead of a `text` one.
 *
 * ## The price on each label
 *
 * `image-gen.ts` never sets an output resolution, so these are priced at whatever Google
 * defaults to - which is the 1K tier, not a guess: a live call against both models returned
 * `usageMetadata.candidatesTokensDetails` of exactly 1120 image tokens, and Google's own pricing
 * page documents 1120 tokens as *is* the 1K (1024x1024px) output. Standard (non-batch) rate,
 * since this route makes one real-time `generateContent` call, never the batch API:
 * $0.034/image for 3.1 Flash Lite, $0.067/image for 3.1 Flash, $0.134/image for 3 Pro ("$0.134
 * per 1K/2K image" - same price through the 2K tier). https://ai.google.dev/gemini-api/docs/pricing,
 * checked 2026-09-21.
 */
/*
  Cheapest first, deliberately: `IMAGE_MODEL_OPTIONS[0]` is the default both `cron/blog/route.ts`
  (`CRON_IMAGE_MODEL`) and `GenerateBlogDialog` read for every automated/default-path image
  generation, so whichever option sits at index 0 IS the default model, budget-wise, across the
  app. The editor's own dropdown has no such default - it opens on "Choose a model..." - so this
  order only decides the automated defaults, not what an author sees pre-selected there.
*/
export const IMAGE_MODEL_OPTIONS = [
  {
    value: 'gemini-3.1-flash-lite-image',
    label: 'Gemini 3.1 Flash Lite Image - cheapest, fastest - $0.034/image',
  },
  {
    value: 'gemini-3.1-flash-image',
    label: 'Gemini 3.1 Flash Image - fast - $0.067/image',
  },
  {
    value: 'gemini-3-pro-image',
    label: 'Gemini 3 Pro Image - slower, higher quality - $0.134/image',
  },
] as const

/**
 * `IMAGE_MODEL_OPTIONS` plus a leading empty option, so every Generate select renders "Choose
 * a model..." rather than silently pre-selecting the first one. Every Generate button stays
 * disabled until the author actually picks a model - defaulting here would pick it for them.
 */
export const IMAGE_MODEL_SELECT_OPTIONS = [
  { value: '', label: 'Choose a model...' },
  ...IMAGE_MODEL_OPTIONS,
]

/** The sentinel a `series` select uses for "no series". `null` cannot be an `<option>` value. */
export const NO_SERIES = '__none__'

/**
 * Declared as a union rather than derived from `GENERATION_FIELDS` with
 * `(typeof GENERATION_FIELDS)[number]['key']`, which is the tidier-looking option and does
 * not work here: the array is annotated `readonly GenerationField[]`, and `GenerationField`
 * refers back to this type, so deriving it would be circular. The annotation is what makes a
 * typo in an option list a build error, and that is worth more than the derivation.
 */
export type GenerationFieldKey =
  | 'title'
  | 'slug'
  | 'excerpt'
  | 'tags'
  | 'kind'
  | 'series'
  | 'isPillar'
  | 'language'
  | 'relatedSlugs'
  | 'topic'
  | 'throughline'
  | 'evidence'
  | 'style'
  | 'tone'
  | 'genres'
  | 'audience'
  | 'pointOfView'
  | 'structure'
  | 'hook'
  | 'length'
  | 'codeExamples'
  | 'codeLanguage'
  | 'imageCount'
  | 'titleRule'
  | 'quotableLine'
  | 'callToAction'
  | 'seoKeywords'
  | 'instruction'
  | 'model'
  | 'creativity'

export const GENERATION_FIELDS: readonly GenerationField[] = [
  {
    key: 'title',
    label: 'Blog name',
    group: 'identity',
    control: 'text',
    placeholder: 'Five things Next.js 16 did that its docs did not say',
    autoNote: 'The model titles it, under the title rule below.',
    maxLength: 140,
  },
  {
    key: 'slug',
    label: 'Slug',
    group: 'identity',
    control: 'text',
    placeholder: 'five-things-next-16-did',
    autoNote:
      'Derived from the title. A collision gets a numeric suffix rather than a failure.',
    maxLength: 80,
  },
  {
    key: 'excerpt',
    label: 'Excerpt',
    group: 'identity',
    control: 'textarea',
    placeholder: 'The one sentence that decides whether the post gets opened.',
    autoNote:
      'Written from the finished body, so it describes what was actually written.',
    maxLength: 300,
  },
  {
    key: 'tags',
    label: 'Tags',
    group: 'identity',
    control: 'text',
    placeholder: 'nextjs, caching, measured',
    autoNote: 'Up to eight, lowercased and hyphenated to fit the tag pattern.',
    maxLength: 200,
  },
  {
    key: 'kind',
    label: 'Kind',
    group: 'taxonomy',
    control: 'select',
    optionsFrom: 'kinds',
    autoNote: 'Chosen from the kinds that exist, against the length below.',
  },
  {
    key: 'series',
    label: 'Series',
    group: 'taxonomy',
    control: 'select',
    optionsFrom: 'series',
    autoNote:
      'The cluster the topic belongs to, or none if it belongs to none of them.',
  },
  {
    key: 'isPillar',
    label: 'Pillar post',
    group: 'taxonomy',
    control: 'boolean',
    autoNote:
      'Off. A series may have one hub and the database enforces it, so this is a deliberate choice rather than a guess.',
  },
  {
    key: 'language',
    label: 'Language',
    group: 'taxonomy',
    control: 'select',
    options: LANGUAGE_OPTIONS,
    autoNote: 'Tieng Viet, written natively rather than translated.',
  },
  {
    key: 'relatedSlugs',
    label: 'Related posts',
    group: 'taxonomy',
    control: 'multiselect',
    optionsFrom: 'slugs',
    autoNote:
      'Up to five published posts the model judges relevant. Unknown slugs are dropped.',
    maxItems: 5,
  },
  {
    key: 'topic',
    label: 'Topic',
    group: 'craft',
    control: 'textarea',
    placeholder: 'What the post is about, and the thing you actually measured.',
    autoNote:
      'The model picks a subject from the series and genres. This is the field worth filling in.',
    maxLength: 2000,
  },
  /*
    `throughline` and `evidence` are the two fields the research says decide whether a post is
    worth publishing at all, and they are deliberately adjacent to `topic` rather than filed
    under style.

    A topic is what the post is about. A throughline is what it ARGUES - one sentence the whole
    post hangs from, which the source calls "80% of the work" and which a model will skip
    entirely unless asked, producing a competent survey of a subject with no spine. Evidence is
    the half that cannot be generated: a number you measured, an error you saw, a result you
    got. Left on auto the model writes around the gap, and what comes out is exactly the
    synthesisable page that 2026 search no longer sends anybody to.
  */
  {
    key: 'throughline',
    label: 'Throughline',
    group: 'craft',
    control: 'text',
    placeholder:
      'The documented way to revalidate a dynamic route does nothing.',
    autoNote:
      'The model writes one and states it in the opening. A post with no throughline is a survey.',
    maxLength: 300,
  },
  {
    key: 'evidence',
    label: 'Evidence you actually have',
    group: 'craft',
    control: 'textarea',
    placeholder:
      'The numbers, the error text, the before and after. Anything only you could report.',
    autoNote:
      'None supplied. The post is then written with NO dates, durations, percentages or measurements anywhere, including inside code samples. That is the honest version of a post with no material behind it.',
    maxLength: 4000,
  },
  {
    key: 'style',
    label: 'Style',
    group: 'craft',
    control: 'select',
    options: STYLE_OPTIONS,
    autoNote: 'Matched to the topic.',
  },
  {
    key: 'tone',
    label: 'Tone',
    group: 'craft',
    control: 'select',
    options: TONE_OPTIONS,
    autoNote: 'Plain and direct.',
  },
  {
    key: 'genres',
    label: 'Genres',
    group: 'craft',
    control: 'multiselect',
    options: GENRE_OPTIONS,
    autoNote: 'Inferred from the topic.',
    maxItems: 4,
  },
  {
    key: 'audience',
    label: 'Audience',
    group: 'craft',
    control: 'select',
    options: AUDIENCE_OPTIONS,
    autoNote: 'Senior engineers - the readers this blog is written for.',
  },
  {
    key: 'pointOfView',
    label: 'Point of view',
    group: 'craft',
    control: 'select',
    options: POV_OPTIONS,
    autoNote: 'First person.',
  },
  {
    key: 'structure',
    label: 'Structure',
    group: 'craft',
    control: 'select',
    options: STRUCTURE_OPTIONS,
    // Auto is a DERIVATION, not a delegation. `structureFor` in `brief.ts` resolves it from the
    // style, then the series, then falls back to the zipline - and never hands the choice to
    // the model, whose answer is always the same parallel-sections shape the brief bans.
    autoNote:
      'Derived from the style, or the series, or the zipline. Never left to the model.',
  },
  {
    key: 'hook',
    label: 'Opening',
    group: 'craft',
    control: 'select',
    options: HOOK_OPTIONS,
    autoNote:
      'Matched to the style, and never a definition or a paragraph of setup - the rule the house style already carries.',
  },
  {
    key: 'length',
    label: 'Length',
    group: 'craft',
    control: 'select',
    options: LENGTH_OPTIONS,
    autoNote: 'Note length for a note, standard for anything else.',
  },
  {
    key: 'codeExamples',
    label: 'Code examples',
    group: 'craft',
    control: 'select',
    options: CODE_OPTIONS,
    autoNote: 'As many as the topic needs.',
  },
  {
    key: 'codeLanguage',
    label: 'Code language',
    group: 'craft',
    control: 'select',
    options: CODE_LANGUAGE_OPTIONS,
    autoNote: 'Whatever the topic is written in.',
  },
  {
    key: 'imageCount',
    label: 'Image placeholders',
    group: 'craft',
    control: 'select',
    options: IMAGE_COUNT_OPTIONS,
    autoNote:
      'Derived from the length: roughly one per 400 words. A note gets 1, a standard post 2, a long post 3, a pillar 4. Never a range the model picks the cheap end of.',
  },
  {
    key: 'titleRule',
    label: 'Title must carry a number or a named failure',
    group: 'craft',
    control: 'boolean',
    // Auto is ON, unconditionally. It used to be "on for an article, off for a note", which
    // could not work: the model picks `kind` in the same reply, so the rule was conditioned on a
    // value its own subject controlled and any post could opt out by calling itself a note.
    autoNote:
      'On. The title has to name a number or a named failure - and turning it off here is an author deciding that, not the model deciding it.',
  },
  {
    key: 'quotableLine',
    label: 'Carry one line a reader would quote about themselves',
    group: 'craft',
    control: 'boolean',
    /*
      Off by default, and the default is the interesting part.

      The research is unambiguous that this is the sharing mechanism - people pass on what says
      something about who they are, not what informs them - so the tempting move is to turn it
      on everywhere. It is off because the failure mode is worse than the miss: a model told to
      produce a quotable line on a post about `revalidatePath` produces a motivational sentence
      bolted to a measurement, and one of those on a technical post costs more credibility than
      the share was ever going to be worth. It belongs on the essays and the career posts, where
      an author turns it on deliberately.
    */
    autoNote:
      'Off. It is the sharing mechanism, and a motivational line welded onto a measurement post costs more than the share is worth.',
  },
  {
    key: 'callToAction',
    label: 'Closing call to action',
    group: 'craft',
    control: 'select',
    options: CTA_OPTIONS,
    autoNote: 'None. A post that earns the click does not need to ask for it.',
  },
  {
    key: 'seoKeywords',
    label: 'Keywords',
    group: 'craft',
    control: 'text',
    placeholder: 'next.js 16 revalidatePath, ISR',
    autoNote:
      'The words the topic already implies, used once each rather than sprinkled.',
    maxLength: 200,
  },
  {
    key: 'instruction',
    label: 'Extra instruction',
    group: 'craft',
    control: 'textarea',
    placeholder:
      'Anything the fields above cannot say. Open the post on the measurement, not the setup.',
    autoNote: 'Nothing extra.',
    maxLength: 4000,
  },
  {
    key: 'model',
    label: 'Model',
    group: 'engine',
    control: 'select',
    options: MODEL_OPTIONS,
    autoNote: 'Claude Sonnet 4.6.',
  },
  {
    key: 'creativity',
    label: 'Creativity',
    group: 'engine',
    control: 'select',
    options: CREATIVITY_OPTIONS,
    autoNote: 'Balanced.',
  },
] as const

export const FIELD_BY_KEY: ReadonlyMap<string, GenerationField> = new Map(
  GENERATION_FIELDS.map(field => [field.key, field])
)

export type FieldMode = 'auto' | 'manual'
export type FieldValue = string | string[] | boolean
export type FieldSetting = { mode: FieldMode; value: FieldValue }

/** What the dialog sends and the route receives: one entry per field, keyed by field key. */
export type GenerationSpec = Partial<Record<GenerationFieldKey, FieldSetting>>

/**
 * Every field on auto - the dialog's initial state, and the shape a bare `{}` resolves to.
 *
 * Auto by default on every field was the requirement, and it is also the only default that can be
 * right: a dialog that arrived with 25 pre-filled opinions is a dialog where "generate" means
 * "write the post I already described", which is a worse product than "write me a post".
 */
export function defaultSpec(): Record<GenerationFieldKey, FieldSetting> {
  const entries = GENERATION_FIELDS.map(field => [
    field.key,
    { mode: 'auto' as FieldMode, value: emptyValueFor(field) },
  ])
  return Object.fromEntries(entries) as Record<GenerationFieldKey, FieldSetting>
}

export function emptyValueFor(field: GenerationField): FieldValue {
  if (field.control === 'boolean') return false
  if (field.control === 'multiselect') return []
  // A select opens on its first choice rather than on an empty option. Switching a field to
  // manual and leaving it blank is not a state worth modelling - it means the same thing as
  // auto and reads as a bug.
  if (field.control === 'select' && field.options?.length)
    return field.options[0].value
  return ''
}

/** The post fields a regeneration preset is built from. Structural, so the editor can pass its own. */
export type PostPresetSource = {
  title: string
  slug: string
  excerpt: string
  kind: string
  series: string | null
  isPillar: boolean
  language: 'vi' | 'en'
  tags: string[]
  relatedSlugs: string[]
  /**
   * How many markdown images the body has, placeholders and resolved ones alike -
   * `countBodyImages`, never `findImagePlaceholders().length`. See the note on the preset
   * below for what the second one does to a post whose pictures are already uploaded.
   */
  imageCount: number
}

/**
 * The spec the "Regenerate post" dialog opens on: this post, described back to itself.
 *
 * ```
 *   the post                       the dialog opens with
 *   ────────────────────────────   ─────────────────────────────────
 *   title  "Five things..."        Blog name   [auto | MANUAL]  Five things...
 *   slug   five-things             Slug        [auto | MANUAL]  five-things
 *   excerpt ""                     Excerpt     [AUTO | manual]
 *   tags   []                      Tags        [AUTO | manual]
 * ```
 *
 * ## The rule is "a value the author has is a value they keep"
 *
 * Every field that HAS a value opens manual, holding it. Regeneration is the author saying
 * "this post, written better", not "some other post" - so the URL, the title and the cluster
 * it sits in have to survive by default, and the slug most of all: a regeneration that quietly
 * renamed a published post would 404 every link to it.
 *
 * Every field that is EMPTY opens auto instead. That asymmetry is the whole design. An empty
 * excerpt is not a decision to have no excerpt, it is a post that never got one - and pinning
 * it to manual-empty would mean the one field the author most wants filled in comes back empty
 * again, every time, with the dialog showing an empty box as though that had been chosen.
 *
 * `series` is the exception that proves it: `null` IS a decision, because the editor makes
 * "none" an option you pick rather than a box you leave blank. So it presets to the sentinel
 * rather than to auto.
 *
 * ## What is deliberately NOT preset
 *
 * The whole Craft group - style, tone, structure, length - stays auto, because none of it is
 * stored on a post. There is nothing to read back. That is also why regeneration is useful:
 * those are exactly the knobs the author reaches for when the first attempt came out wrong.
 */
export function presetSpecFromPost(
  post: PostPresetSource
): Record<GenerationFieldKey, FieldSetting> {
  const spec = defaultSpec()
  const set = (key: GenerationFieldKey, value: FieldValue) => {
    spec[key] = { mode: 'manual', value }
  }

  set('title', post.title)
  set('slug', post.slug)
  set('kind', post.kind)
  set('language', post.language)
  // Manual in both states: `false` is as real a choice as `true` here, and a post that IS the
  // pillar of its series must not lose that by being rewritten.
  set('isPillar', post.isPillar)
  set('series', post.series ?? NO_SERIES)

  if (post.excerpt.trim()) set('excerpt', post.excerpt.trim())
  if (post.tags.length) set('tags', post.tags.join(', '))
  if (post.relatedSlugs.length) set('relatedSlugs', post.relatedSlugs)

  /*
    Only a count that is both non-zero and representable.

    ZERO IS DELIBERATELY NOT PRESET, and this is the empty-excerpt rule again rather than an
    inconsistency with `resolveImageCount`, where `0` genuinely means "no pictures". The
    difference is who said it. In the dialog, `0` is a thing the author picked off a dropdown.
    Here it is inferred from a body that has no images - which is every hand-written post,
    every draft made with "Create draft", and every generated post whose pictures have since
    been uploaded. Pinning that to manual `0` tells the model "Images: none. Do not write any
    image placeholder", so regenerating any of them silently guarantees a post with no
    pictures, which is what happened.

    Above four there is no option to preset to either, and inventing one would quietly reduce
    a post with seven images to four. Auto is the honest answer in both directions: it says
    "decide again" rather than picking a number nobody chose. Picking "None - text only" by
    hand still works and still means none.
  */
  if (post.imageCount > 0 && post.imageCount <= MAX_PRESETTABLE_IMAGE_COUNT)
    set('imageCount', String(post.imageCount))

  return spec
}

/**
 * Coerce an untrusted body into a spec. Never throws, never returns an unknown key.
 *
 * Shaped like `readJsonBody`: the caller gets a value it can use plus the list of things it
 * had to drop, rather than an exception. Unknown keys and unknown option values are dropped
 * silently-in-the-return-value and reported in `dropped`, because the author on the other end
 * of a stale tab deserves to hear that their `series` was ignored - the same lesson
 * `PATCH /api/admin/blog/[id]` learned when it silently discarded a deleted series.
 *
 * Values from the dynamic sources (`kinds`, `series`, `slugs`) pass through here unchecked
 * beyond their type. They cannot be validated against a static list, so the route checks them
 * against the collections.
 */
export function normaliseSpec(raw: unknown): {
  spec: Record<GenerationFieldKey, FieldSetting>
  dropped: string[]
} {
  const spec = defaultSpec()
  const dropped: string[] = []

  if (!raw || typeof raw !== 'object') return { spec, dropped }

  for (const [key, entry] of Object.entries(raw as Record<string, unknown>)) {
    const field = FIELD_BY_KEY.get(key)
    if (!field) {
      dropped.push(`"${key}" is not a property of a generated post.`)
      continue
    }
    if (!entry || typeof entry !== 'object') continue

    const { mode, value } = entry as { mode?: unknown; value?: unknown }
    if (mode !== 'manual') continue

    const coerced = coerceValue(field, value, dropped)
    if (coerced === null) continue

    spec[field.key] = { mode: 'manual', value: coerced }
  }

  return { spec, dropped }
}

/** `null` means "not usable as a manual value" - the field stays on auto. */
function coerceValue(
  field: GenerationField,
  value: unknown,
  dropped: string[]
): FieldValue | null {
  if (field.control === 'boolean')
    return typeof value === 'boolean' ? value : null

  if (field.control === 'multiselect') {
    if (!Array.isArray(value)) return null
    const strings = value.filter(
      (item): item is string => typeof item === 'string'
    )
    const allowed = field.options
      ? strings.filter(item => {
          const ok = field.options!.some(option => option.value === item)
          if (!ok)
            dropped.push(
              `"${item}" is not a ${field.label.toLowerCase()} option.`
            )
          return ok
        })
      : strings
    return allowed.slice(0, field.maxItems ?? 8)
  }

  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  // An empty manual value is auto with extra steps, and one that reached the model would be
  // an instruction to write a post with no title.
  if (!trimmed) return null

  if (field.control === 'select' && field.options) {
    const ok = field.options.some(option => option.value === trimmed)
    if (!ok) {
      dropped.push(`"${trimmed}" is not a ${field.label.toLowerCase()} option.`)
      return null
    }
  }

  return field.maxLength ? trimmed.slice(0, field.maxLength) : trimmed
}

/** Read one field's manual string, or `undefined` when it is on auto. */
export function manualString(
  spec: GenerationSpec,
  key: GenerationFieldKey
): string | undefined {
  const entry = spec[key]
  if (!entry || entry.mode !== 'manual') return undefined
  return typeof entry.value === 'string' ? entry.value : undefined
}

export function manualList(
  spec: GenerationSpec,
  key: GenerationFieldKey
): string[] | undefined {
  const entry = spec[key]
  if (!entry || entry.mode !== 'manual') return undefined
  return Array.isArray(entry.value) ? entry.value : undefined
}

export function manualBoolean(
  spec: GenerationSpec,
  key: GenerationFieldKey
): boolean | undefined {
  const entry = spec[key]
  if (!entry || entry.mode !== 'manual') return undefined
  return typeof entry.value === 'boolean' ? entry.value : undefined
}
