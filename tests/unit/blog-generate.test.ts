import { describe, expect, it } from 'vitest'

import {
  buildGenerationPrompt,
  GenerationError,
  generationTemperature,
  parseGeneratedDraft,
  resolveImageCount,
  slugify,
  type GenerationContext,
} from '@/lib/blog/generate'
import { normaliseSpec, NO_SERIES } from '@/lib/blog/generation-fields'

/**
 * The trust boundary between a model's reply and a database write.
 *
 * Every test below is about one thing: nothing is written because the model said it. That is
 * not a hypothetical worry. `Post.kind` and `Post.series` carry no schema enums - a mongoose
 * enum is fixed at module load and both lists are runtime-editable - so `parseGeneratedDraft`
 * is the only check between a generated post and a dangling taxonomy reference, exactly as
 * the hand-written guards in `PATCH /api/admin/blog/[id]` are for the editor.
 *
 * The second theme is the split between fatal and recoverable. A post whose seventh tag was
 * `Next.js 16` is a good post with one bad tag; throwing it away costs a minute of model time
 * to punish something the author could fix in four seconds. Only a missing body or an
 * author-chosen slug that cannot be used is fatal, because neither has an honest fallback.
 */

const CONTEXT: GenerationContext = {
  kinds: [
    { slug: 'article', label: 'Article' },
    { slug: 'note', label: 'Note' },
  ],
  series: [
    {
      slug: 'measured-in-production',
      title: 'Measured in production',
      blurb: 'Things I tested.',
    },
    {
      slug: 'dev-career-vn',
      title: 'A developer career',
      blurb: 'From Vietnam.',
    },
  ],
  relatedCandidates: [
    { slug: 'first-post', title: 'The first post' },
    { slug: 'second-post', title: 'The second post' },
  ],
}

const BODY =
  '## What I measured\n\nThe literal path worked and the pattern form did not.'

function reply(overrides: Record<string, unknown> = {}) {
  return {
    throughline: 'The documented pattern form of revalidatePath does nothing.',
    title: 'revalidatePath did not revalidate',
    slug: 'revalidatepath-did-not-revalidate',
    excerpt: 'The documented pattern form is a no-op.',
    kind: 'article',
    series: 'measured-in-production',
    language: 'en',
    tags: ['nextjs', 'caching'],
    relatedSlugs: ['first-post'],
    bodyMarkdown: BODY,
    ...overrides,
  }
}

const AUTO = normaliseSpec({}).spec

describe('parseGeneratedDraft - what is fatal', () => {
  it('refuses a reply with no body', () => {
    // The only content failure with no honest fallback. A title can come from the author and
    // a slug from the title; a post with no body is not a post.
    expect(() =>
      parseGeneratedDraft(reply({ bodyMarkdown: '' }), AUTO, CONTEXT)
    ).toThrow(GenerationError)
  })

  it('refuses a body past what the schema will store', () => {
    // `bodyMarkdown` is `maxlength: 200_000`. Caught here so the message names the size
    // rather than arriving as a mongoose ValidationError after the model has been paid for.
    expect(() =>
      parseGeneratedDraft(
        reply({ bodyMarkdown: 'x'.repeat(200_001) }),
        AUTO,
        CONTEXT
      )
    ).toThrow(/200000/)
  })

  it('refuses an author-chosen slug that is reserved by a route', () => {
    const { spec } = normaliseSpec({
      slug: { mode: 'manual', value: 'privacy' },
    })

    expect(() => parseGeneratedDraft(reply(), spec, CONTEXT)).toThrow(
      /reserved/
    )
  })

  it('refuses an author-chosen kind that no longer exists', () => {
    // The stale-tab case, and it is fatal rather than a warning because the author named it.
    // Quietly substituting a different kind would report success for a post filed somewhere
    // they did not choose.
    const { spec } = normaliseSpec({
      kind: { mode: 'manual', value: 'link-roundup' },
    })
    // `link-roundup` is a legal slug, so it survives normalisation and dies here instead.
    expect(() => parseGeneratedDraft(reply(), spec, CONTEXT)).toThrow(
      /is not a kind/
    )
  })
})

describe('parseGeneratedDraft - what is recoverable', () => {
  it('falls back to a slug derived from the title, and says it did', () => {
    const { draft, warnings } = parseGeneratedDraft(
      reply({ slug: 'Not A Slug!' }),
      AUTO,
      CONTEXT
    )

    expect(draft.slug).toBe('revalidatepath-did-not-revalidate')
    // Quoted exactly as the model sent it, casing and all. Echoing back our own lowercased
    // attempt would describe a string that appears nowhere.
    expect(warnings.join(' ')).toContain('"Not A Slug!"')
  })

  it('falls back to the first kind when the model invents one', () => {
    const { draft, warnings } = parseGeneratedDraft(
      reply({ kind: 'think-piece' }),
      AUTO,
      CONTEXT
    )

    expect(draft.kind).toBe('article')
    expect(warnings.join(' ')).toContain('think-piece')
  })

  it('saves with no series rather than guessing at the nearest one', () => {
    // A wrong cluster is worse than none: `/blog` renders series as hubs, so a misfiled post
    // dilutes a cluster the author built on purpose. "No series" is a state the board shows
    // plainly and the editor fixes in one dropdown.
    const { draft, warnings } = parseGeneratedDraft(
      reply({ series: 'measured-in-prod' }),
      AUTO,
      CONTEXT
    )

    expect(draft.series).toBeNull()
    expect(warnings.join(' ')).toContain('measured-in-prod')
  })

  it('normalises tags into the pattern instead of dropping them', () => {
    // `TAG_PATTERN` is `^[a-z0-9-]{1,32}$` and the natural thing to generate is `Next.js 16`.
    const { draft } = parseGeneratedDraft(
      reply({ tags: ['Next.js 16', 'CACHING', 'caching', '   ', '!!!'] }),
      AUTO,
      CONTEXT
    )

    expect(draft.tags).toEqual(['next-js-16', 'caching'])
  })

  it('caps tags at the eight the schema allows', () => {
    const { draft } = parseGeneratedDraft(
      reply({ tags: Array.from({ length: 12 }, (_, index) => `tag-${index}`) }),
      AUTO,
      CONTEXT
    )

    expect(draft.tags).toHaveLength(8)
  })

  it('drops a related slug that does not exist, and names it', () => {
    // The model's most likely failure here, because a plausible slug is trivial to write and
    // impossible to spot by eye. On a published post it renders as a link to a 404.
    const { draft, warnings } = parseGeneratedDraft(
      reply({ relatedSlugs: ['first-post', 'a-post-i-imagined'] }),
      AUTO,
      CONTEXT
    )

    expect(draft.relatedSlugs).toEqual(['first-post'])
    expect(warnings.join(' ')).toContain('a-post-i-imagined')
  })
})

describe('parseGeneratedDraft - manual values win', () => {
  it("writes the author's title and excerpt over the model's", () => {
    const { spec } = normaliseSpec({
      title: { mode: 'manual', value: 'The title I chose' },
      excerpt: { mode: 'manual', value: 'The excerpt I chose.' },
    })

    const { draft } = parseGeneratedDraft(reply(), spec, CONTEXT)

    expect(draft.title).toBe('The title I chose')
    expect(draft.excerpt).toBe('The excerpt I chose.')
  })

  it('reads the no-series sentinel as null', () => {
    const { spec } = normaliseSpec({
      series: { mode: 'manual', value: NO_SERIES },
    })

    expect(parseGeneratedDraft(reply(), spec, CONTEXT).draft.series).toBeNull()
  })

  it('never lets the model set isPillar', () => {
    /*
      `{ series: 1 }` is unique over `{ isPillar: true, series: { $type: 'string' } }`, so a
      model guessing `true` turns a good post into an E11000 at save - after the generation
      has been paid for. The flag is manual-only for that reason; the route additionally
      drops it if the series already has a hub.
    */
    const { draft } = parseGeneratedDraft(
      reply({ isPillar: true }),
      AUTO,
      CONTEXT
    )
    expect(draft.isPillar).toBe(false)

    const { spec } = normaliseSpec({
      isPillar: { mode: 'manual', value: true },
    })
    expect(parseGeneratedDraft(reply(), spec, CONTEXT).draft.isPillar).toBe(
      true
    )
  })
})

describe('slugify', () => {
  it('keeps Vietnamese letters instead of deleting them', () => {
    // Without the NFD pass plus the `đ` rule, "Tôi đã đo" strips to "t-o" - a title in the
    // blog's other language becomes an unreadable slug.
    expect(slugify('Tôi đã đo cái này')).toBe('toi-da-do-cai-nay')
  })

  it('never returns something that fails SLUG_PATTERN', () => {
    for (const input of ['!!!', '   ', '...', '???-'])
      expect(slugify(input)).toMatch(/^[a-z0-9-]{1,80}$/)
  })

  it('does not leave a trailing hyphen after truncating at 80', () => {
    // `slice(80)` can land mid-separator, and `five-things-` is a slug the pattern accepts
    // and a reader reads as a typo.
    const slug = slugify(`${'a'.repeat(79)} bbbb`)
    expect(slug).not.toMatch(/-$/)
    expect(slug.length).toBeLessThanOrEqual(80)
  })
})

describe('buildGenerationPrompt', () => {
  it('states the closed sets the model must choose from', () => {
    const { system, user } = buildGenerationPrompt(AUTO, CONTEXT)

    expect(system).toContain('article | note')
    expect(user).toContain('measured-in-production')
    expect(user).toContain('first-post')
  })

  it('carries a manual value through as a constraint', () => {
    const { spec } = normaliseSpec({
      topic: {
        mode: 'manual',
        value: 'revalidatePath pattern form is a no-op',
      },
      instruction: { mode: 'manual', value: 'Open on the measurement.' },
    })

    const { user } = buildGenerationPrompt(spec, CONTEXT)

    expect(user).toContain('revalidatePath pattern form is a no-op')
    expect(user).toContain('Open on the measurement.')
  })

  it('spells out all seven steps when the repo template is picked', () => {
    // Step 6, "what I rejected", is the one `docs/blog/authoring.md` calls the seniority
    // signal and the one a model drops unless it is asked for by name.
    const { spec } = normaliseSpec({
      structure: { mode: 'manual', value: 'seven-step' },
    })

    const { user } = buildGenerationPrompt(spec, CONTEXT)

    expect(user).toContain('What I rejected')
    expect(user).toContain('What I would tell you')
  })

  it('bans the em dash, which is the tell this blog cannot afford', () => {
    const { system } = buildGenerationPrompt(AUTO, CONTEXT)

    expect(system).toContain('Never an em dash')
  })

  it('tells the model to start at ## - the page owns the only h1', () => {
    const { system } = buildGenerationPrompt(AUTO, CONTEXT)

    expect(system).toContain('Start at `## `')
  })

  it('pins the fence language when one was chosen', () => {
    const { spec } = normaliseSpec({
      codeLanguage: { mode: 'manual', value: 'sql' },
    })

    expect(buildGenerationPrompt(spec, CONTEXT).system).toContain(
      'tagged `sql`'
    )
  })

  it('says so when there is nothing to reference yet', () => {
    const { user } = buildGenerationPrompt(AUTO, {
      ...CONTEXT,
      relatedCandidates: [],
    })

    expect(user).toContain('`relatedSlugs` must be [].')
  })
})

describe('generationTemperature', () => {
  it('maps the three words, and defaults to balanced', () => {
    const grounded = normaliseSpec({
      creativity: { mode: 'manual', value: 'grounded' },
    }).spec
    const inventive = normaliseSpec({
      creativity: { mode: 'manual', value: 'inventive' },
    }).spec

    expect(generationTemperature(grounded)).toBe(0.2)
    expect(generationTemperature(inventive)).toBe(0.9)
    expect(generationTemperature(AUTO)).toBe(0.6)
  })
})

/**
 * Images, which the generator briefs rather than draws.
 *
 * The router behind this feature has no image model, so a generated post carries
 * `![image](imageN)` placeholders plus one prompt each. The reconciliation below is the part
 * that has to be right: `bodyMarkdown` is the source of truth and `imagePrompts` is a lookup
 * beside it, so a prompt with no placeholder is invisible forever and a placeholder with no
 * prompt is a card the author has to refill by hand.
 */
describe('parseGeneratedDraft - image prompts', () => {
  const withImages = (overrides: Record<string, unknown> = {}) =>
    reply({
      bodyMarkdown: `## One\n\n![image](image1)\n\ntext\n\n![image](image2)`,
      imagePrompts: [
        { key: 'image1', prompt: 'Isometric render of a split cable' },
        { key: 'image2', prompt: 'Ink illustration of a stalled queue' },
      ],
      coverImagePrompt: 'Matte painting of a server rack at dusk',
      ...overrides,
    })

  it('keeps one prompt per placeholder, in body order', () => {
    const { draft, warnings } = parseGeneratedDraft(withImages(), AUTO, CONTEXT)

    expect(draft.imagePrompts.map(entry => entry.key)).toEqual([
      'image1',
      'image2',
    ])
    expect(draft.coverImagePrompt).toBe(
      'Matte painting of a server rack at dusk'
    )
    expect(warnings).toEqual([])
  })

  it('drops a prompt whose placeholder is not in the body, and names it', () => {
    // An orphan is invisible: the editor only renders cards for keys it finds in the markdown,
    // so a stored `image3` prompt would sit in the document forever with no way to reach it.
    const { draft, warnings } = parseGeneratedDraft(
      withImages({
        imagePrompts: [
          { key: 'image1', prompt: 'a' },
          { key: 'image2', prompt: 'b' },
          { key: 'image3', prompt: 'an orphan' },
        ],
      }),
      AUTO,
      CONTEXT
    )

    expect(draft.imagePrompts).toHaveLength(2)
    expect(warnings.join(' ')).toContain('image3')
  })

  it('keeps a placeholder that came back with no prompt, and warns', () => {
    // The opposite of an orphan and the worse one: the card shows either way, so the author
    // sees an empty prompt box. The warning points them at the rewrite button.
    const { draft, warnings } = parseGeneratedDraft(
      withImages({ imagePrompts: [{ key: 'image1', prompt: 'a' }] }),
      AUTO,
      CONTEXT
    )

    expect(draft.imagePrompts).toEqual([
      { key: 'image1', prompt: 'a' },
      { key: 'image2', prompt: '' },
    ])
    expect(warnings.join(' ')).toContain('image2')
  })

  it('returns no prompts at all for a post with no placeholders', () => {
    const { draft } = parseGeneratedDraft(
      reply({ imagePrompts: [{ key: 'image1', prompt: 'unused' }] }),
      AUTO,
      CONTEXT
    )

    expect(draft.imagePrompts).toEqual([])
  })

  it('survives imagePrompts being any shape at all', () => {
    for (const value of [
      null,
      'image1',
      42,
      [null],
      [{ prompt: 'no key' }],
      [{ key: 7 }],
    ]) {
      const { draft } = parseGeneratedDraft(
        withImages({ imagePrompts: value }),
        AUTO,
        CONTEXT
      )
      expect(draft.imagePrompts.map(entry => entry.key)).toEqual([
        'image1',
        'image2',
      ])
    }
  })
})

describe('resolveImageCount', () => {
  it('reads a manual zero as zero, not as auto', () => {
    /*
      The bug this pins is `Number(value) || null`, which is the natural way to write this and
      turns the one deliberate "no pictures" choice into auto - putting placeholders on a post
      that explicitly asked for none, and then blocking its publish on a missing-image warning.
    */
    const { spec } = normaliseSpec({
      imageCount: { mode: 'manual', value: '0' },
    })

    expect(resolveImageCount(spec)).toBe(0)
  })

  it('is null on auto', () => {
    expect(resolveImageCount(AUTO)).toBeNull()
  })

  it('reads a chosen count', () => {
    const { spec } = normaliseSpec({
      imageCount: { mode: 'manual', value: '3' },
    })

    expect(resolveImageCount(spec)).toBe(3)
  })
})

describe('buildGenerationPrompt - images', () => {
  it('asks for exact keys when a count was chosen', () => {
    const { spec } = normaliseSpec({
      imageCount: { mode: 'manual', value: '2' },
    })

    const { user } = buildGenerationPrompt(spec, CONTEXT)

    expect(user).toContain('exactly 2')
    expect(user).toContain('`image1`')
    expect(user).toContain('`image2`')
  })

  it('forbids placeholders outright at zero', () => {
    const { spec } = normaliseSpec({
      imageCount: { mode: 'manual', value: '0' },
    })

    expect(buildGenerationPrompt(spec, CONTEXT).user).toContain('Images: none')
  })

  it('states a rate rather than a range when the length is open too', () => {
    /*
      Twice now the answer has been whichever end of the offer cost least. "Up to two, none is a
      fine answer" returned none. "One, or two if the post has two things worth showing" returned
      one. A range with a cheap end is not a range, so auto no longer offers one.
    */
    const { user } = buildGenerationPrompt(AUTO, CONTEXT)

    expect(user).toContain('one for roughly every 400 words')
    expect(user).toContain('not a ceiling to work down from')
    expect(user).not.toContain('None at all is a fine answer')
  })

  it.each([
    ['note', '1,'],
    ['standard', '2,'],
    ['long', '3,'],
    ['pillar', '4,'],
  ])('derives an exact count from a pinned length: %s', (length, expected) => {
    // Once the length is pinned the code knows how long the post will be, so there is nothing
    // left for the model to judge. Same rule as `structureFor`: auto derives, it does not
    // delegate.
    const { spec } = normaliseSpec({
      length: { mode: 'manual', value: length },
    })

    expect(buildGenerationPrompt(spec, CONTEXT).user).toContain(
      `- Images: ${expected}`
    )
  })

  it('says where a picture goes, not just how many', () => {
    // The half that decides whether the picture is worth making. A model told only "place an
    // image" reaches for a decorative photograph of a laptop.
    const { user } = buildGenerationPrompt(AUTO, CONTEXT)

    expect(user).toContain('Put each where it does work')
    expect(user).toContain('Never a decorative photograph')
  })

  it('tells the model to spread them through the post', () => {
    // What stops a raised count being met badly. Four placeholders stacked in the first third is
    // not four illustrated sections, it is a gallery with an essay after it.
    const { user } = buildGenerationPrompt(AUTO, CONTEXT)

    expect(user).toContain('Spread them')
    expect(user).toContain('never all of them before the halfway point')
  })

  it('forbids inventing an image URL', () => {
    // Any URL the model writes is dropped by `rehypeRestrictImageHosts`, silently.
    expect(buildGenerationPrompt(AUTO, CONTEXT).system).toContain(
      'Never write a real image URL'
    )
  })

  it('carries the no-lettering rule, which is the one that is not taste', () => {
    expect(buildGenerationPrompt(AUTO, CONTEXT).system).toContain('garble')
  })
})

/**
 * The formula from `docs/blog/what-good-looks-like.md`, as things the prompt actually says.
 *
 * Every assertion below is a finding from that research made load-bearing. They are worth
 * testing for the same reason the seven-step template is: the prompt is a long string, and a
 * requirement that quietly falls out of it does not fail anything - it just produces posts that
 * are a little worse, indefinitely, with nothing to notice.
 */
describe('buildGenerationPrompt - the post shape', () => {
  it('asks for a throughline before it asks for anything else', () => {
    // The source calls deciding this "80% of the work", and a model skips it by default and
    // writes a survey of the subject instead.
    const { system, user } = buildGenerationPrompt(AUTO, CONTEXT)

    expect(system).toContain('DECIDE THE CLAIM FIRST')
    expect(user).toContain('it must be arguable')
  })

  it('forbids inventing evidence when the author supplied none', () => {
    // The blog's whole claim is "I measured this". A fabricated benchmark does not weaken
    // that claim, it ends it - so auto is a prohibition rather than a licence to fill the gap.
    expect(buildGenerationPrompt(AUTO, CONTEXT).user).toContain(
      'This post may contain no dates, no durations, no percentages'
    )
  })

  it('passes supplied evidence through as the material to write from', () => {
    const { spec } = normaliseSpec({
      evidence: {
        mode: 'manual',
        value: '4083px of tree vs 800px of flat text',
      },
    })

    expect(buildGenerationPrompt(spec, CONTEXT).user).toContain('4083px')
  })

  it('spells out a researched structure rather than naming it', () => {
    // Same lesson as the seven-step template: a structure named but not described is one the
    // model approximates, and the step that carries the format is the step that goes missing.
    const { spec } = normaliseSpec({
      structure: { mode: 'manual', value: 'in-medias-res' },
    })

    const { user } = buildGenerationPrompt(spec, CONTEXT)

    expect(user).toContain('Carry ONE arc')
    expect(user).toContain('No setup')
  })

  it('describes a pillar as a hub rather than a long article', () => {
    const { spec } = normaliseSpec({
      structure: { mode: 'manual', value: 'pillar-hub' },
      length: { mode: 'manual', value: 'pillar' },
    })

    const { user } = buildGenerationPrompt(spec, CONTEXT)

    expect(user).toContain('This page is the map')
    expect(user).toContain('2500 to 4000 words')
  })

  it('turns a hook choice into an instruction, not the dropdown label', () => {
    const { spec } = normaliseSpec({
      hook: { mode: 'manual', value: 'number' },
    })

    expect(buildGenerationPrompt(spec, CONTEXT).user).toContain(
      'The first sentence contains the number'
    )
  })

  it('suppresses the quotable line unless it was asked for', () => {
    // Off by default on purpose: a motivational sentence welded onto a measurement post costs
    // more credibility than the share was ever going to return.
    expect(buildGenerationPrompt(AUTO, CONTEXT).user).toContain(
      'Do not write a motivational or quotable line'
    )

    const { spec } = normaliseSpec({
      quotableLine: { mode: 'manual', value: true },
    })
    expect(buildGenerationPrompt(spec, CONTEXT).user).toContain(
      'would quote about themselves'
    )
  })

  it('keeps the title honest as well as specific', () => {
    // The number rule and clickability pull the same way until they do not, and the place they
    // diverge is the one audience this blog is written for.
    expect(buildGenerationPrompt(AUTO, CONTEXT).user).toContain(
      'a label for a discussion, not ad copy'
    )
  })
})

describe('buildGenerationPrompt - Vietnamese is the default', () => {
  it('asks for Vietnamese when nothing was chosen', () => {
    expect(buildGenerationPrompt(AUTO, CONTEXT).user).toContain(
      'Write the whole post in Vietnamese'
    )
  })

  it('sends the Vietnamese tells and not the English ones', () => {
    // The two lists do not correspond. Sending "no delve" with a Vietnamese post spends the
    // model's attention on a word it was never going to write, and leaves the words it does
    // overuse unmentioned.
    const { system } = buildGenerationPrompt(AUTO, CONTEXT)

    expect(system).toContain('Trong thời đại công nghệ 4.0')
    expect(system).toContain('bạn')
    expect(system).not.toContain('delve')
  })

  it('switches the whole style list when English is chosen', () => {
    const { spec } = normaliseSpec({
      language: { mode: 'manual', value: 'en' },
    })

    const { system } = buildGenerationPrompt(spec, CONTEXT)

    expect(system).toContain('delve')
    expect(system).not.toContain('quý độc giả')
  })

  it('bans the em dash in both languages', () => {
    const { spec } = normaliseSpec({
      language: { mode: 'manual', value: 'en' },
    })

    for (const built of [
      buildGenerationPrompt(AUTO, CONTEXT),
      buildGenerationPrompt(spec, CONTEXT),
    ])
      expect(built.system).toContain('Never an em dash')
  })
})

describe('resolveLanguage - which way an absent value falls', () => {
  it('stores vi when the model said nothing', () => {
    const { language } = parseGeneratedDraft(
      reply({ language: undefined }),
      AUTO,
      CONTEXT
    ).draft

    expect(language).toBe('vi')
  })

  it('still believes the model when it says en', () => {
    // Not overridden: a brief whose subject is English can reasonably come back in English, and
    // storing `vi` on a post that visibly is not makes `<article lang>` lie to a screen reader.
    expect(parseGeneratedDraft(reply(), AUTO, CONTEXT).draft.language).toBe(
      'en'
    )
  })

  it('lets a manual choice beat both', () => {
    const { spec } = normaliseSpec({
      language: { mode: 'manual', value: 'vi' },
    })

    expect(parseGeneratedDraft(reply(), spec, CONTEXT).draft.language).toBe(
      'vi'
    )
  })
})

/**
 * The three structural fixes from the rewrite, all of them in the AUTO branches.
 *
 * The brief was audited against a real generation and the finding was not that the rules were
 * wrong - it was that most of them were unreachable. They sat behind fields whose auto branch
 * handed the decision back to the model, and auto is the initial state of all twenty-six
 * fields, so almost every generation in practice never saw them. These tests are about what a
 * DEFAULT generation receives, which is the only configuration that matters.
 */
describe('buildGenerationPrompt - what auto actually resolves to', () => {
  it('never tells the model to choose its own structure', () => {
    // The old auto branch read "you choose, matched to the style", and the model's choice is
    // always the same one: N parallel sections plus a synthesis, which is the silhouette the
    // brief spends a paragraph banning. Handing back the choice and forbidding the answer is
    // not a design.
    const { user } = buildGenerationPrompt(AUTO, CONTEXT)

    expect(user).not.toContain('Structure: you choose')
    expect(user).toContain('- Structure: the zipline')
  })

  it('derives the structure from the style when one was picked', () => {
    const { spec } = normaliseSpec({
      style: { mode: 'manual', value: 'personal-essay' },
    })

    expect(buildGenerationPrompt(spec, CONTEXT).user).toContain(
      'open in the middle of it'
    )
  })

  it('derives it from the series when the style is auto too', () => {
    const { spec } = normaliseSpec({
      series: { mode: 'manual', value: 'measured-in-production' },
    })

    expect(buildGenerationPrompt(spec, CONTEXT).user).toContain(
      'the seven-step template'
    )
  })

  it('makes a pillar a hub, whatever else was chosen', () => {
    // A hub that came out as a long article is a hub that never links its cluster, and the
    // cluster is the only reason the post exists.
    const { spec } = normaliseSpec({
      isPillar: { mode: 'manual', value: true },
      style: { mode: 'manual', value: 'personal-essay' },
    })

    expect(buildGenerationPrompt(spec, CONTEXT).user).toContain(
      'This page is the map'
    )
  })

  it('applies the title rule without asking what kind the post is', () => {
    /*
      It used to read "if this is an article, the title must carry a number or a named failure",
      which cannot work: the model picks `kind` in the same reply, so the rule was conditioned on
      a value its own subject controlled. The audited generation came back with a plain title
      and nothing had been violated.
    */
    const { user } = buildGenerationPrompt(AUTO, CONTEXT)

    expect(user).not.toContain('If this is an article')
    expect(user).toContain('The title MUST name something specific')
  })

  it('still lets an author turn the title rule off', () => {
    // An author saying so is different from a model routing around it.
    const { spec } = normaliseSpec({
      titleRule: { mode: 'manual', value: false },
    })

    expect(buildGenerationPrompt(spec, CONTEXT).user).toContain(
      'does not need to carry a number'
    )
  })

  it('bans the silhouette in the system prompt, not just the wording', () => {
    const { system } = buildGenerationPrompt(AUTO, CONTEXT)

    expect(system).toContain('BANNED SHAPE')
    expect(system).toContain('N parallel sections')
  })

  it('routes unsupported claims into JSON instead of into the prose', () => {
    // The old instruction - name what would have to be measured - became a formula repeated at
    // the end of every section. The admission now goes in a field nobody reads as part of the
    // post.
    const { system, user } = buildGenerationPrompt(AUTO, CONTEXT)

    expect(system).toContain('"unsupported"')
    expect(user).toContain('Do not tell the reader what they should measure')
  })
})

describe('parseGeneratedDraft - the prose gate', () => {
  it("turns the model's own unsupported list into a task", () => {
    const { warnings } = parseGeneratedDraft(
      reply({ unsupported: ['khoảng bốn mươi engineer', 'p99 là 18s'] }),
      AUTO,
      CONTEXT
    )

    expect(warnings.join('\n')).toContain('could not support')
    expect(warnings.join('\n')).toContain('p99 là 18s')
  })

  it('warns when the model never committed to a claim', () => {
    // A reply with no throughline skipped the first step of the method, and what comes back when
    // that happens is a survey of the subject rather than an argument about it.
    const { warnings } = parseGeneratedDraft(
      reply({ throughline: undefined }),
      AUTO,
      CONTEXT
    )

    expect(warnings.join('\n')).toContain('never committed to a claim')
  })

  it('says nothing about a throughline the author pinned by hand', () => {
    const { spec } = normaliseSpec({
      throughline: { mode: 'manual', value: 'The docs are wrong about this.' },
    })

    const { warnings } = parseGeneratedDraft(
      reply({ throughline: undefined }),
      spec,
      CONTEXT
    )

    expect(warnings.join('\n')).not.toContain('never committed to a claim')
  })

  it('carries audit findings through to the author', () => {
    // The gate is wired in, not merely written. This is the end-to-end assertion: a body with a
    // fabricated measurement in it produces a warning on the way to being saved.
    const { warnings } = parseGeneratedDraft(
      reply({
        bodyMarkdown: '## Kết quả\n\nĐo ngày 2023-11-14, p99 giảm còn 18s.',
      }),
      AUTO,
      CONTEXT
    )

    expect(warnings.join('\n')).toContain('2023-11-14')
  })

  it('leaves a clean post with no prose warnings at all', () => {
    const { warnings } = parseGeneratedDraft(
      reply({
        bodyMarkdown:
          '## Cái gì đã hỏng\n\nBuild fail và không có log nào.\n\n## Tại sao\n\nVì bootstrap của Next không có nonce.',
      }),
      AUTO,
      CONTEXT
    )

    expect(warnings).toEqual([])
  })
})

/**
 * Images, now that auto asks for one instead of allowing none.
 *
 * The warning below is scoped narrowly on purpose: it is silent whenever the author made a
 * decision of their own, and silent on the short posts where no pictures is the documented
 * right answer. What is left is the exact case the new default exists to catch - a full-length
 * post that came back with nothing to look at.
 */
describe('parseGeneratedDraft - the image expectation', () => {
  const LONG_BODY = `## Cái gì đã hỏng\n\n${'từ '.repeat(600)}`

  it('warns when a full-length post comes back with no images', () => {
    const { warnings } = parseGeneratedDraft(
      reply({ bodyMarkdown: LONG_BODY }),
      AUTO,
      CONTEXT
    )

    expect(warnings.join('\n')).toContain('calls for 1 image')
  })

  it('warns when a long post comes back with only one', () => {
    // The reported failure: a regenerated post arrived carrying a single picture. 1500 words
    // calls for three, and nothing anywhere said so.
    const { warnings } = parseGeneratedDraft(
      reply({
        bodyMarkdown: `## Mở đầu\n\n![image](image1)\n\n${'từ '.repeat(1500)}`,
      }),
      AUTO,
      CONTEXT
    )

    expect(warnings.join('\n')).toContain('calls for 3 images')
    expect(warnings.join('\n')).toContain('came back with 1')
  })

  it('says nothing about a micro-note', () => {
    // Under 300 words the picture would outweigh the post, and the table says zero rather than
    // the check quietly disagreeing with the brief.
    const { warnings } = parseGeneratedDraft(
      reply({ bodyMarkdown: `## Một ghi chú\n\n${'từ '.repeat(80)}` }),
      AUTO,
      CONTEXT
    )

    expect(warnings.join('\n')).not.toContain('calls for')
  })

  it('says nothing when the post carries what its length asks for', () => {
    const { warnings } = parseGeneratedDraft(
      reply({
        bodyMarkdown: `## A\n\n![image](image1)\n\n${'từ '.repeat(400)}\n\n## B\n\n![image](image2)\n\n${'từ '.repeat(400)}`,
      }),
      AUTO,
      CONTEXT
    )

    expect(warnings.join('\n')).not.toContain('calls for')
  })

  it('respects an author who asked for none', () => {
    // `0` from the dropdown is a decision, not an absence. Warning here would second-guess the
    // one person the warning is written for.
    const { spec } = normaliseSpec({
      imageCount: { mode: 'manual', value: '0' },
    })

    const { warnings } = parseGeneratedDraft(
      reply({ bodyMarkdown: LONG_BODY }),
      spec,
      CONTEXT
    )

    expect(warnings.join('\n')).not.toContain('calls for')
  })

  it('leaves a pinned count to the existing placeholder checks', () => {
    // Asking for two and getting none is already reported by `resolveImagePrompts`, in terms of
    // the keys that are missing. A second warning saying the same thing less precisely is noise.
    const { spec } = normaliseSpec({
      imageCount: { mode: 'manual', value: '2' },
    })

    const { warnings } = parseGeneratedDraft(
      reply({ bodyMarkdown: LONG_BODY }),
      spec,
      CONTEXT
    )

    expect(warnings.join('\n')).not.toContain('calls for')
  })
})
