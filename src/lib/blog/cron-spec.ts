import {
  NO_SERIES,
  type FieldValue,
  type GenerationFieldKey,
  type GenerationSpec,
} from '@/lib/blog/generation-fields'

/**
 * The brief for a post nobody wrote a brief for - one different post a day, from a sampler.
 *
 * ```
 *   kinds + series + the last N titles
 *          │
 *          ├─ pick an ANGLE          weighted: notes 4x, articles 1x, pillar never
 *          │     a coherent bundle - style + structure + hook + tone + length + code
 *          │
 *          ├─ pick a SERIES          round-robin-ish, weighted away from the last one used
 *          │
 *          ├─ jitter                 tone, audience, point of view, creativity, one genre
 *          │
 *          └─ avoid list            the recent titles, as an instruction
 *                  ▼
 *          GenerationSpec, entirely `manual`
 * ```
 *
 * ## Why a bundle and not twenty independent dice
 *
 * Because most combinations of these fields are incoherent, and the model obeys all of them.
 * `style: personal-essay` with `codeExamples: heavy` and `structure: reference` is three
 * instructions pulling three ways, and what comes back is not a surprising post - it is a
 * confused one. Rolling each knob separately maximises VARIANCE, which is not the goal; the
 * goal is that two consecutive days do not read the same, and a dozen hand-made bundles
 * deliver that while each one still describes a post a person would choose to write.
 *
 * The jitter on top is deliberately confined to the fields where any value is defensible
 * under any bundle - tone, audience, point of view, creativity - so it can never build a
 * contradiction.
 *
 * ## Why notes are four times as likely as articles
 *
 * `docs/blog/authoring.md` commits to "2 articles + 8 notes in 6 weeks" and says why: a blog
 * that only has the expensive format is the one that goes quiet, and ten of the twenty-seven
 * blogs reviewed for this feature had. A daily job is the thing most able to honour that ratio
 * and most tempted to ignore it, since every generation costs the same button press. Weighting
 * here is what makes the queue look like the plan.
 *
 * It is also the cheaper side of the time budget. A note is one or two images; a pillar is
 * five, at up to two minutes each, inside a request the platform will cut off. Which is the
 * other reason `pillar` is not in the table at all: a hub post is a deliberate act that links
 * a whole cluster together, and the database allows exactly one per series. Letting a dice
 * roll spend that slot would be the worst thing in this file.
 *
 * ## Why the recent titles are an `instruction` and not a new prompt section
 *
 * `instruction` is already validated, already length-capped, and already spliced into the
 * prompt in a place the brief was written around. Adding a parallel "things not to write"
 * section would be a second channel into the same prompt that no test covers and that
 * `normaliseSpec` knows nothing about.
 *
 * The list has to exist at all because the model's only other view of this blog is
 * `relatedCandidates`, which is PUBLISHED posts - and a cron post is archived until the owner
 * reads it. Without this, day two cannot see day one, and the sampler's variety is undone by a
 * model that writes its favourite post every morning.
 */

/** How many recent titles to name in the avoid list. */
export const RECENT_TITLE_LIMIT = 25

type Angle = {
  key: string
  /** Relative likelihood. See the note above on why notes dominate. */
  weight: number
  fields: Partial<Record<GenerationFieldKey, FieldValue>>
}

/**
 * The shapes a daily post may take.
 *
 * Every one of these is a post this blog would publish, with the fields that make it that
 * shape set together. `topic` is deliberately absent from all of them: the topic is the one
 * thing the model is better placed to choose than a dice roll, given the series, the genres
 * and the list of what has already been written.
 */
export const CRON_ANGLES: readonly Angle[] = [
  {
    // The blog's own house format, and the one with the strongest claim - almost nobody
    // publishes measurements. Heaviest of the article-weight angles for that reason.
    key: 'measured-teardown',
    weight: 3,
    fields: {
      style: 'measured-teardown',
      structure: 'seven-step',
      hook: 'number',
      tone: 'analytical',
      genres: ['measurement', 'engineering'],
      codeExamples: 'light',
      length: 'standard',
    },
  },
  {
    key: 'postmortem',
    weight: 2,
    fields: {
      style: 'postmortem',
      structure: 'chronological',
      hook: 'scene',
      tone: 'blunt',
      genres: ['engineering', 'retrospective'],
      codeExamples: 'light',
      length: 'standard',
    },
  },
  {
    key: 'build-log',
    weight: 2,
    fields: {
      style: 'build-log',
      structure: 'chronological',
      hook: 'scene',
      tone: 'plain',
      genres: ['engineering', 'tooling'],
      codeExamples: 'heavy',
      length: 'short',
    },
  },
  {
    key: 'deep-dive',
    weight: 2,
    fields: {
      style: 'deep-dive',
      structure: 'zipline',
      hook: 'reframe',
      tone: 'analytical',
      genres: ['architecture', 'performance'],
      codeExamples: 'light',
      length: 'long',
    },
  },
  {
    key: 'tutorial',
    weight: 2,
    fields: {
      style: 'tutorial',
      structure: 'problem-solution',
      hook: 'question',
      tone: 'direct',
      pointOfView: 'second-person',
      genres: ['engineering', 'tooling'],
      codeExamples: 'heavy',
      length: 'standard',
    },
  },
  {
    key: 'listicle',
    weight: 2,
    fields: {
      style: 'listicle',
      structure: 'numbered-list',
      hook: 'number',
      tone: 'direct',
      genres: ['engineering', 'tooling'],
      codeExamples: 'light',
      length: 'long',
    },
  },
  {
    /*
      The one angle that turns `quotableLine` on, and the only place it belongs.

      Its own field note says why it is off everywhere else: a motivational sentence welded
      onto a measurement post costs more credibility than the share is worth. On a career
      essay it is the mechanism - people pass on what says something about who they are.
    */
    key: 'career-essay',
    weight: 2,
    fields: {
      style: 'personal-essay',
      structure: 'in-medias-res',
      hook: 'scene',
      tone: 'warm',
      genres: ['career'],
      audience: 'junior-developers',
      codeExamples: 'none',
      length: 'standard',
      quotableLine: true,
    },
  },
  {
    key: 'opinion',
    weight: 2,
    fields: {
      style: 'opinion',
      structure: 'zipline',
      hook: 'claim',
      tone: 'wry',
      genres: ['engineering', 'product'],
      codeExamples: 'none',
      length: 'short',
    },
  },
  // ---- the note tier, four times the weight of any single article angle ----
  {
    key: 'note-measurement',
    weight: 8,
    fields: {
      style: 'measured-teardown',
      structure: 'zipline',
      hook: 'number',
      tone: 'plain',
      genres: ['measurement'],
      codeExamples: 'light',
      length: 'note',
    },
  },
  {
    key: 'note-opinion',
    weight: 8,
    fields: {
      style: 'opinion',
      structure: 'freeform',
      hook: 'claim',
      tone: 'blunt',
      genres: ['engineering'],
      codeExamples: 'none',
      length: 'note',
    },
  },
  {
    key: 'note-tooling',
    weight: 8,
    fields: {
      style: 'narrative',
      structure: 'freeform',
      hook: 'scene',
      tone: 'wry',
      genres: ['tooling'],
      codeExamples: 'light',
      length: 'note',
    },
  },
  {
    key: 'digest',
    weight: 4,
    fields: {
      style: 'digest',
      structure: 'numbered-list',
      hook: 'claim',
      tone: 'plain',
      genres: ['engineering', 'tooling'],
      codeExamples: 'none',
      length: 'short',
    },
  },
]

/** Jitter pools. Any value here is defensible under any angle - see the header. */
const TONE_JITTER = ['plain', 'direct', 'wry', 'analytical', 'blunt']
const AUDIENCE_JITTER = [
  'senior-engineers',
  'senior-engineers',
  'technical-founders',
  'generalists',
]
const POV_JITTER = [
  'first-person',
  'first-person',
  'first-person',
  'impersonal',
]
const CREATIVITY_JITTER = ['balanced', 'balanced', 'inventive']

export type CronSpecInput = {
  /** Live kind slugs. Sampling a kind the collection does not have is a 400 from the run. */
  kinds: string[]
  /** Live series slugs. May be empty - the sampler then files the post under no series. */
  series: string[]
  /** Titles of the most recent posts, any status. The avoid list. */
  recentTitles: string[]
  /** Injectable for tests. Must return [0, 1). */
  random?: () => number
}

export type CronSample = {
  spec: GenerationSpec
  /** Which angle was drawn, for the log line. Variety is only checkable if it is reported. */
  angle: string
}

export function sampleCronSpec({
  kinds,
  series,
  recentTitles,
  random = Math.random,
}: CronSpecInput): CronSample {
  const angle = pickWeighted(CRON_ANGLES, random)

  const fields: Partial<Record<GenerationFieldKey, FieldValue>> = {
    ...angle.fields,
  }

  // Jitter only where the angle did not already have an opinion. An angle that names a tone
  // named it for a reason - `postmortem` is blunt on purpose - and overwriting it would undo
  // the coherence the bundles exist to provide.
  if (fields.tone === undefined) fields.tone = pick(TONE_JITTER, random)
  if (fields.audience === undefined)
    fields.audience = pick(AUDIENCE_JITTER, random)
  if (fields.pointOfView === undefined)
    fields.pointOfView = pick(POV_JITTER, random)
  fields.creativity = pick(CREATIVITY_JITTER, random)

  if (kinds.length > 0) fields.kind = pick(kinds, random)

  /*
    A series two times in three, and no series otherwise.

    Always filing under a series would starve the unclustered stream that `note` posts belong
    to; never filing would leave every cluster permanently at whatever size the owner built by
    hand. `isPillar` is never set - see the header.
  */
  fields.series =
    series.length > 0 && random() < 0.66 ? pick(series, random) : NO_SERIES

  const avoid = avoidInstruction(recentTitles)
  if (avoid) fields.instruction = avoid

  const spec: GenerationSpec = {}
  for (const [key, value] of Object.entries(fields))
    spec[key as GenerationFieldKey] = { mode: 'manual', value }

  return { spec, angle: angle.key }
}

/**
 * The avoid list, as one instruction.
 *
 * Phrased as "already written, pick something else" rather than as a list of banned words. The
 * difference matters: a model told not to use the word "cache" writes around the word, while a
 * model shown a post it has already written picks a different subject, which is the actual
 * request.
 */
export function avoidInstruction(recentTitles: string[]): string {
  const titles = recentTitles
    .map(title => title.trim())
    .filter(Boolean)
    .slice(0, RECENT_TITLE_LIMIT)

  if (titles.length === 0) return ''

  return [
    'This blog already has the posts listed below. Write about something none of them covers - a different subject, not the same subject from a different angle.',
    ...titles.map(title => `- ${title}`),
  ].join('\n')
}

function pick<T>(items: readonly T[], random: () => number): T {
  return items[Math.min(items.length - 1, Math.floor(random() * items.length))]
}

/**
 * Weighted choice, and the clamp on the last line is not defensive noise.
 *
 * `Math.random()` is [0, 1) so the cursor cannot reach `total`, but an injected `random` in a
 * test can return exactly 1 - and an unclamped version then falls off the end of the loop and
 * returns `undefined`, which shows up much later as a spec with no style rather than as a
 * failure here.
 */
function pickWeighted(angles: readonly Angle[], random: () => number): Angle {
  const total = angles.reduce((sum, angle) => sum + angle.weight, 0)
  let cursor = random() * total

  for (const angle of angles) {
    cursor -= angle.weight
    if (cursor < 0) return angle
  }

  return angles[angles.length - 1]
}
