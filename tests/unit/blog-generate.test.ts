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
    { slug: 'measured-in-production', title: 'Measured in production', blurb: 'Things I tested.' },
    { slug: 'dev-career-vn', title: 'A developer career', blurb: 'From Vietnam.' },
  ],
  relatedCandidates: [
    { slug: 'first-post', title: 'The first post' },
    { slug: 'second-post', title: 'The second post' },
  ],
}

const BODY = '## What I measured\n\nThe literal path worked and the pattern form did not.'

function reply(overrides: Record<string, unknown> = {}) {
  return {
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
    expect(() => parseGeneratedDraft(reply({ bodyMarkdown: '' }), AUTO, CONTEXT)).toThrow(
      GenerationError
    )
  })

  it('refuses a body past what the schema will store', () => {
    // `bodyMarkdown` is `maxlength: 200_000`. Caught here so the message names the size
    // rather than arriving as a mongoose ValidationError after the model has been paid for.
    expect(() =>
      parseGeneratedDraft(reply({ bodyMarkdown: 'x'.repeat(200_001) }), AUTO, CONTEXT)
    ).toThrow(/200000/)
  })

  it('refuses an author-chosen slug that is reserved by a route', () => {
    const { spec } = normaliseSpec({ slug: { mode: 'manual', value: 'privacy' } })

    expect(() => parseGeneratedDraft(reply(), spec, CONTEXT)).toThrow(/reserved/)
  })

  it('refuses an author-chosen kind that no longer exists', () => {
    // The stale-tab case, and it is fatal rather than a warning because the author named it.
    // Quietly substituting a different kind would report success for a post filed somewhere
    // they did not choose.
    const { spec } = normaliseSpec({ kind: { mode: 'manual', value: 'link-roundup' } })
    // `link-roundup` is a legal slug, so it survives normalisation and dies here instead.
    expect(() => parseGeneratedDraft(reply(), spec, CONTEXT)).toThrow(/is not a kind/)
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
  it('writes the author\'s title and excerpt over the model\'s', () => {
    const { spec } = normaliseSpec({
      title: { mode: 'manual', value: 'The title I chose' },
      excerpt: { mode: 'manual', value: 'The excerpt I chose.' },
    })

    const { draft } = parseGeneratedDraft(reply(), spec, CONTEXT)

    expect(draft.title).toBe('The title I chose')
    expect(draft.excerpt).toBe('The excerpt I chose.')
  })

  it('reads the no-series sentinel as null', () => {
    const { spec } = normaliseSpec({ series: { mode: 'manual', value: NO_SERIES } })

    expect(parseGeneratedDraft(reply(), spec, CONTEXT).draft.series).toBeNull()
  })

  it('never lets the model set isPillar', () => {
    /*
      `{ series: 1 }` is unique over `{ isPillar: true, series: { $type: 'string' } }`, so a
      model guessing `true` turns a good post into an E11000 at save - after the generation
      has been paid for. The flag is manual-only for that reason; the route additionally
      drops it if the series already has a hub.
    */
    const { draft } = parseGeneratedDraft(reply({ isPillar: true }), AUTO, CONTEXT)
    expect(draft.isPillar).toBe(false)

    const { spec } = normaliseSpec({ isPillar: { mode: 'manual', value: true } })
    expect(parseGeneratedDraft(reply(), spec, CONTEXT).draft.isPillar).toBe(true)
  })
})

describe('slugify', () => {
  it('keeps Vietnamese letters instead of deleting them', () => {
    // Without the NFD pass plus the `đ` rule, "Tôi đã đo" strips to "t-o" - a title in the
    // blog's other language becomes an unreadable slug.
    expect(slugify('Tôi đã đo cái này')).toBe('toi-da-do-cai-nay')
  })

  it('never returns something that fails SLUG_PATTERN', () => {
    for (const input of ['!!!', '   ', '...', '???-']) {
      expect(slugify(input)).toMatch(/^[a-z0-9-]{1,80}$/)
    }
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
      topic: { mode: 'manual', value: 'revalidatePath pattern form is a no-op' },
      instruction: { mode: 'manual', value: 'Open on the measurement.' },
    })

    const { user } = buildGenerationPrompt(spec, CONTEXT)

    expect(user).toContain('revalidatePath pattern form is a no-op')
    expect(user).toContain('Open on the measurement.')
  })

  it('spells out all seven steps when the repo template is picked', () => {
    // Step 6, "what I rejected", is the one `docs/blog/authoring.md` calls the seniority
    // signal and the one a model drops unless it is asked for by name.
    const { spec } = normaliseSpec({ structure: { mode: 'manual', value: 'seven-step' } })

    const { user } = buildGenerationPrompt(spec, CONTEXT)

    expect(user).toContain('What I rejected')
    expect(user).toContain('What I would tell you')
  })

  it('bans the em dash, which is the tell this blog cannot afford', () => {
    const { system } = buildGenerationPrompt(AUTO, CONTEXT)

    expect(system).toContain('Never use an em dash')
  })

  it('tells the model to start at ## - the page owns the only h1', () => {
    const { system } = buildGenerationPrompt(AUTO, CONTEXT)

    expect(system).toContain('Start at `## `')
  })

  it('pins the fence language when one was chosen', () => {
    const { spec } = normaliseSpec({ codeLanguage: { mode: 'manual', value: 'sql' } })

    expect(buildGenerationPrompt(spec, CONTEXT).system).toContain('tagged `sql`')
  })

  it('says so when there is nothing to reference yet', () => {
    const { user } = buildGenerationPrompt(AUTO, { ...CONTEXT, relatedCandidates: [] })

    expect(user).toContain('`relatedSlugs` must be [].')
  })
})

describe('generationTemperature', () => {
  it('maps the three words, and defaults to balanced', () => {
    const grounded = normaliseSpec({ creativity: { mode: 'manual', value: 'grounded' } }).spec
    const inventive = normaliseSpec({ creativity: { mode: 'manual', value: 'inventive' } }).spec

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

    expect(draft.imagePrompts.map(entry => entry.key)).toEqual(['image1', 'image2'])
    expect(draft.coverImagePrompt).toBe('Matte painting of a server rack at dusk')
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
    for (const value of [null, 'image1', 42, [null], [{ prompt: 'no key' }], [{ key: 7 }]]) {
      const { draft } = parseGeneratedDraft(withImages({ imagePrompts: value }), AUTO, CONTEXT)
      expect(draft.imagePrompts.map(entry => entry.key)).toEqual(['image1', 'image2'])
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
    const { spec } = normaliseSpec({ imageCount: { mode: 'manual', value: '0' } })

    expect(resolveImageCount(spec)).toBe(0)
  })

  it('is null on auto', () => {
    expect(resolveImageCount(AUTO)).toBeNull()
  })

  it('reads a chosen count', () => {
    const { spec } = normaliseSpec({ imageCount: { mode: 'manual', value: '3' } })

    expect(resolveImageCount(spec)).toBe(3)
  })
})

describe('buildGenerationPrompt - images', () => {
  it('asks for exact keys when a count was chosen', () => {
    const { spec } = normaliseSpec({ imageCount: { mode: 'manual', value: '2' } })

    const { user } = buildGenerationPrompt(spec, CONTEXT)

    expect(user).toContain('exactly 2')
    expect(user).toContain('`image1`')
    expect(user).toContain('`image2`')
  })

  it('forbids placeholders outright at zero', () => {
    const { spec } = normaliseSpec({ imageCount: { mode: 'manual', value: '0' } })

    expect(buildGenerationPrompt(spec, CONTEXT).user).toContain('Images: none')
  })

  it('permits zero on auto rather than demanding one', () => {
    // A note is 150 words. Always asking for an image would put a picture larger than the post
    // on it, and block shipping until somebody made that picture.
    expect(buildGenerationPrompt(AUTO, CONTEXT).user).toContain('None at all is a fine answer')
  })

  it('forbids inventing an image URL', () => {
    // Any URL the model writes is dropped by `rehypeRestrictImageHosts`, silently.
    expect(buildGenerationPrompt(AUTO, CONTEXT).system).toContain('Never write a real image URL')
  })

  it('carries the no-lettering rule, which is the one that is not taste', () => {
    expect(buildGenerationPrompt(AUTO, CONTEXT).system).toContain('garble')
  })
})
