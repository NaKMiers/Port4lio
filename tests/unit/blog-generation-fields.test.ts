import { describe, expect, it } from 'vitest'

import {
  CODE_LANGUAGE_OPTIONS,
  defaultSpec,
  GENERATION_FIELDS,
  normaliseSpec,
  NO_SERIES,
  presetSpecFromPost,
} from '@/lib/blog/generation-fields'
import { SHIKI_LANGUAGES } from '@/lib/blog/markdown'

/**
 * The generation field registry, and the one cross-file relationship it cannot express.
 *
 * `generation-fields.ts` imports nothing, because `GenerateBlogDialog` is a client component
 * and anything reachable from that module ships to the browser. That rule is what keeps the
 * mongoose -> mongodb chain out of the bundle, and it is also what makes the first test here
 * necessary: the code-language list has to agree with Shiki's grammar list, and the two files
 * cannot see each other.
 */

describe('CODE_LANGUAGE_OPTIONS vs SHIKI_LANGUAGES', () => {
  /**
   * The failure this catches is silent, which is the whole reason it is a test.
   *
   * Offering `rust` here would not throw anywhere. `downgradeUnknownFences` rewrites an
   * unregistered fence to `language-text` and logs, so the generated post saves cleanly,
   * publishes cleanly, and renders every code block in flat grey. Nobody files that bug -
   * they assume the theme is like that.
   */
  it('offers only languages Shiki has a grammar for', () => {
    const grammars = new Set<string>(SHIKI_LANGUAGES)
    const orphans = CODE_LANGUAGE_OPTIONS.filter(option => !grammars.has(option.value))

    expect(orphans.map(option => option.value)).toEqual([])
  })
})

describe('defaultSpec', () => {
  it('starts every field on auto - the stated default, and the only useful one', () => {
    const spec = defaultSpec()

    expect(Object.keys(spec)).toHaveLength(GENERATION_FIELDS.length)
    expect(Object.values(spec).every(entry => entry.mode === 'auto')).toBe(true)
  })

  it('opens a static select on its first option rather than on an empty value', () => {
    // A manual select holding `''` matches no option, so the dialog would render a blank
    // dropdown and the route would drop the field straight back to auto - undoing the switch
    // the author just flicked, with nothing on screen saying so.
    const spec = defaultSpec()
    expect(spec.tone.value).toBe('plain')
    expect(spec.model.value).toBe('ag/claude-sonnet-4-6')
  })
})

describe('normaliseSpec', () => {
  it('ignores a field left on auto, whatever value rides along with it', () => {
    const { spec } = normaliseSpec({ title: { mode: 'auto', value: 'ignored' } })

    expect(spec.title).toEqual({ mode: 'auto', value: '' })
  })

  it('keeps a manual string and reports nothing', () => {
    const { spec, dropped } = normaliseSpec({
      title: { mode: 'manual', value: '  Five things Next.js 16 did  ' },
    })

    expect(spec.title).toEqual({ mode: 'manual', value: 'Five things Next.js 16 did' })
    expect(dropped).toEqual([])
  })

  it('treats an empty manual value as auto - it means the same thing', () => {
    const { spec } = normaliseSpec({ topic: { mode: 'manual', value: '   ' } })

    expect(spec.topic.mode).toBe('auto')
  })

  it('refuses a select value that is not one of its options, and says so', () => {
    const { spec, dropped } = normaliseSpec({ tone: { mode: 'manual', value: 'shouty' } })

    expect(spec.tone.mode).toBe('auto')
    expect(dropped).toHaveLength(1)
    expect(dropped[0]).toContain('shouty')
  })

  it('names a key that is not a property at all', () => {
    // The stale-tab case. A dialog from a deploy that had a field this one does not would
    // otherwise have its value swallowed, and the author would read the result as the model
    // ignoring them.
    const { dropped } = normaliseSpec({ vibe: { mode: 'manual', value: 'cosy' } })

    expect(dropped).toEqual(['"vibe" is not a property of a generated post.'])
  })

  it('filters a multiselect to known options and caps it', () => {
    const { spec, dropped } = normaliseSpec({
      genres: {
        mode: 'manual',
        value: ['engineering', 'measurement', 'astrology', 'testing', 'security', 'career'],
      },
    })

    expect(spec.genres.value).toEqual(['engineering', 'measurement', 'testing', 'security'])
    expect(dropped[0]).toContain('astrology')
  })

  it('takes a boolean only as a boolean', () => {
    const asString = normaliseSpec({ isPillar: { mode: 'manual', value: 'true' } })
    const asBoolean = normaliseSpec({ isPillar: { mode: 'manual', value: true } })

    expect(asString.spec.isPillar.mode).toBe('auto')
    expect(asBoolean.spec.isPillar).toEqual({ mode: 'manual', value: true })
  })

  it('survives a body that is not an object at all', () => {
    // `readJsonBody` guarantees valid JSON and nothing more - `null`, `[]` and `7` all parse.
    for (const body of [null, undefined, [], 7, 'spec']) {
      const { spec, dropped } = normaliseSpec(body)
      expect(Object.values(spec).every(entry => entry.mode === 'auto')).toBe(true)
      expect(dropped).toEqual([])
    }
  })

  it('truncates a manual string to the field\'s own bound', () => {
    const { spec } = normaliseSpec({ title: { mode: 'manual', value: 'x'.repeat(400) } })

    // 140 is `Post.title`'s `maxlength`. Clamping here means a long title is a shorter title
    // rather than a mongoose ValidationError after a minute of generation.
    expect(spec.title.value).toHaveLength(140)
  })
})

/**
 * The regeneration preset: this post, described back to the dialog that will rewrite it.
 *
 * The whole design is one asymmetry - a field that HAS a value opens manual holding it, a field
 * that is EMPTY opens auto. Most of the tests below are that rule seen from one side or the
 * other, and the slug case is the one with teeth: a regeneration that quietly renamed a
 * published post would 404 every link to it.
 */
describe('presetSpecFromPost', () => {
  const POST = {
    title: 'Five things Next.js 16 did',
    slug: 'five-things-next-16-did',
    excerpt: 'The documented pattern form is a no-op.',
    kind: 'article',
    series: 'measured-in-production',
    isPillar: true,
    language: 'en' as const,
    tags: ['nextjs', 'caching'],
    relatedSlugs: ['first-post'],
    imageCount: 2,
  }

  it('holds every field the post actually has', () => {
    const spec = presetSpecFromPost(POST)

    expect(spec.title).toEqual({ mode: 'manual', value: 'Five things Next.js 16 did' })
    expect(spec.slug).toEqual({ mode: 'manual', value: 'five-things-next-16-did' })
    expect(spec.kind).toEqual({ mode: 'manual', value: 'article' })
    expect(spec.series).toEqual({ mode: 'manual', value: 'measured-in-production' })
    expect(spec.language).toEqual({ mode: 'manual', value: 'en' })
    expect(spec.tags).toEqual({ mode: 'manual', value: 'nextjs, caching' })
    expect(spec.relatedSlugs).toEqual({ mode: 'manual', value: ['first-post'] })
    expect(spec.imageCount).toEqual({ mode: 'manual', value: '2' })
  })

  it('survives a round trip through normaliseSpec unchanged', () => {
    /*
      The preset is built on the client and validated on the server, so the two have to agree.
      A value the dialog shows as held and the route then drops back to auto would regenerate a
      post under different settings than the ones on screen - silently, since the dialog would
      still be showing them.
    */
    const spec = presetSpecFromPost(POST)
    const manual = Object.fromEntries(
      Object.entries(spec).filter(([, entry]) => entry.mode === 'manual')
    )

    const { spec: round, dropped } = normaliseSpec(manual)

    expect(dropped).toEqual([])
    for (const key of Object.keys(manual) as (keyof typeof spec)[]) {
      expect(round[key]).toEqual(spec[key])
    }
  })

  it('holds the slug, which is the field that must not drift', () => {
    // The slug is the post's URL. It opens manual so that leaving the dialog alone and pressing
    // Replace cannot rename anything - the server refuses the change on a published post, but
    // the preset is what stops the author having to rely on that.
    expect(presetSpecFromPost(POST).slug.mode).toBe('manual')
  })

  it('leaves an EMPTY field on auto rather than pinning it empty', () => {
    /*
      The asymmetry, and the reason for it. An empty excerpt is not a decision to have no
      excerpt - it is a post that never got one. Pinning it to manual-empty would mean the field
      the author most wants filled comes back empty every single time.
    */
    const spec = presetSpecFromPost({ ...POST, excerpt: '   ', tags: [], relatedSlugs: [] })

    expect(spec.excerpt.mode).toBe('auto')
    expect(spec.tags.mode).toBe('auto')
    expect(spec.relatedSlugs.mode).toBe('auto')
  })

  it('treats a null series as the decision it is', () => {
    // Unlike an empty excerpt: the editor makes "none" an option you pick, so preserving it
    // means the sentinel rather than auto.
    expect(presetSpecFromPost({ ...POST, series: null }).series).toEqual({
      mode: 'manual',
      value: NO_SERIES,
    })
  })

  it('holds isPillar in both states', () => {
    // A post that IS its series' hub must not lose that by being rewritten, and one that is not
    // must not gain it - `false` is as real a choice as `true`.
    expect(presetSpecFromPost(POST).isPillar).toEqual({ mode: 'manual', value: true })
    expect(presetSpecFromPost({ ...POST, isPillar: false }).isPillar).toEqual({
      mode: 'manual',
      value: false,
    })
  })

  it('leaves a count of zero on auto rather than pinning it to "no images"', () => {
    /*
      A shipped bug, and the exact shape of it.

      `0` here is INFERRED from a body with no images - which is every hand-written post, every
      "Create draft", and every generated post whose pictures have since been uploaded. Pinning
      it to manual `'0'` put "Images: none. Do not write any image placeholder." in the prompt,
      so regenerating any of those silently guaranteed a post with no pictures.

      This is not inconsistent with `resolveImageCount`, which must keep reading a manual `'0'`
      as zero: there the author picked it off a dropdown. The difference is who said it.
    */
    expect(presetSpecFromPost({ ...POST, imageCount: 0 }).imageCount.mode).toBe('auto')
  })

  it('falls back to auto for a count the dropdown cannot represent', () => {
    // Seven images has no option to preset to, and picking four would silently discard three.
    // Auto says "decide again" instead.
    expect(presetSpecFromPost({ ...POST, imageCount: 7 }).imageCount.mode).toBe('auto')
  })

  it('leaves the whole craft group on auto - there is nothing stored to read back', () => {
    // Which is also why regeneration is useful: style, tone and length are exactly the knobs
    // the author reaches for when the first attempt came out wrong.
    const spec = presetSpecFromPost(POST)

    for (const key of ['style', 'tone', 'genres', 'structure', 'length', 'topic'] as const) {
      expect(spec[key].mode).toBe('auto')
    }
  })
})
