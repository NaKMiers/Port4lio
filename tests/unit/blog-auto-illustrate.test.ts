import { describe, expect, it } from 'vitest'

import {
  applyIllustration,
  COVER_KEY,
  describeBlockers,
  planIllustration,
  publishBlockers,
  type IllustrationSource,
} from '@/lib/blog/auto-illustrate'

/**
 * The decisions behind "make every image, then publish".
 *
 * The orchestration itself lives in `GenerateBlogDialog` and is a fetch sequence; these three
 * functions are the part of it that can be wrong in a way that costs something - drawing an
 * image that already exists, skipping one that does not, or publishing a post with a broken
 * picture on it. Each is tested against a post shape rather than against a request log.
 */

const BODY = [
  '# Five things',
  '',
  'An opening that makes a claim.',
  '',
  '![a flame chart](image1)',
  '',
  'The middle.',
  '',
  '![the fix](image2)',
  '',
  'The close.',
].join('\n')

function source(
  overrides: Partial<IllustrationSource> = {}
): IllustrationSource {
  return {
    coverImage: null,
    coverImagePrompt: 'Isometric render of a build pipeline',
    bodyMarkdown: BODY,
    imagePrompts: [
      { key: 'image1', prompt: 'A flame chart with one tall bar' },
      { key: 'image2', prompt: 'The same chart, flat' },
    ],
    ...overrides,
  }
}

describe('planIllustration', () => {
  it('draws the cover first, then the placeholders in body order', () => {
    const { tasks } = planIllustration(source())

    expect(tasks.map(task => task.key)).toEqual([COVER_KEY, 'image1', 'image2'])
  })

  it('uses body order, not the order of the imagePrompts array', () => {
    // The prompts come back from the model in whatever order it wrote them. The reader's
    // order is the body's, and so is the order the progress label counts in.
    const { tasks } = planIllustration(
      source({
        imagePrompts: [
          { key: 'image2', prompt: 'second' },
          { key: 'image1', prompt: 'first' },
        ],
      })
    )

    expect(tasks.map(task => task.key)).toEqual([COVER_KEY, 'image1', 'image2'])
    expect(tasks[1].prompt).toBe('first')
  })

  it('carries the prompt for each key', () => {
    const { tasks } = planIllustration(source())

    expect(tasks[0].prompt).toBe('Isometric render of a build pipeline')
    expect(tasks[1].prompt).toBe('A flame chart with one tall bar')
  })

  it('labels each placeholder with its position and the total', () => {
    const { tasks } = planIllustration(source())

    expect(tasks[0].label).toBe('the cover')
    expect(tasks[1].label).toBe('image 1 of 2')
    expect(tasks[2].label).toBe('image 2 of 2')
  })

  it('leaves an existing cover alone rather than redrawing a paid-for image', () => {
    const { tasks, skipped } = planIllustration(
      source({ coverImage: 'https://res.cloudinary.com/x/a.jpg' })
    )

    expect(tasks.map(task => task.key)).toEqual(['image1', 'image2'])
    expect(skipped).toEqual([])
  })

  it('skips the cover and says so when there is no cover prompt', () => {
    const { tasks, skipped } = planIllustration(
      source({ coverImagePrompt: '   ' })
    )

    expect(tasks.map(task => task.key)).toEqual(['image1', 'image2'])
    expect(skipped).toHaveLength(1)
    expect(skipped[0]).toContain('no cover image prompt')
  })

  it('skips a placeholder with no prompt and keeps drawing the rest', () => {
    const { tasks, skipped } = planIllustration(
      source({
        imagePrompts: [{ key: 'image1', prompt: 'A flame chart' }],
      })
    )

    expect(tasks.map(task => task.key)).toEqual([COVER_KEY, 'image1'])
    expect(skipped).toEqual([
      '"image2" has no image prompt, so it was left as a placeholder.',
    ])
  })

  it('treats a whitespace-only prompt as no prompt', () => {
    const { tasks } = planIllustration(
      source({
        imagePrompts: [
          { key: 'image1', prompt: '\n  \t ' },
          { key: 'image2', prompt: 'real' },
        ],
      })
    )

    expect(tasks.map(task => task.key)).toEqual([COVER_KEY, 'image2'])
  })

  it('ignores a prompt whose placeholder is no longer in the body', () => {
    // `imagePrompts` is deliberately not pruned when a placeholder is resolved - see
    // `resolvePlaceholder` - so a post that has had one image uploaded by hand still carries
    // its prompt. Drawing from that would pay for a picture with nowhere to go.
    const { tasks } = planIllustration(
      source({
        bodyMarkdown:
          '![done](https://res.cloudinary.com/x/a.jpg)\n\n![b](image2)',
      })
    )

    expect(tasks.map(task => task.key)).toEqual([COVER_KEY, 'image2'])
  })

  it('plans nothing at all for a finished post', () => {
    const { tasks, skipped } = planIllustration(
      source({
        coverImage: 'https://res.cloudinary.com/x/cover.jpg',
        bodyMarkdown: 'No pictures here.',
      })
    )

    expect(tasks).toEqual([])
    expect(skipped).toEqual([])
  })
})

describe('applyIllustration', () => {
  it('puts a cover URL on coverImage and leaves the body alone', () => {
    const next = applyIllustration(
      { coverImage: null, bodyMarkdown: BODY },
      COVER_KEY,
      'https://res.cloudinary.com/x/cover.jpg'
    )

    expect(next.coverImage).toBe('https://res.cloudinary.com/x/cover.jpg')
    expect(next.bodyMarkdown).toBe(BODY)
  })

  it('rewrites the placeholder and keeps its alt text', () => {
    const next = applyIllustration(
      { coverImage: null, bodyMarkdown: BODY },
      'image1',
      'https://res.cloudinary.com/x/one.jpg'
    )

    expect(next.bodyMarkdown).toContain(
      '![a flame chart](https://res.cloudinary.com/x/one.jpg)'
    )
    expect(next.bodyMarkdown).toContain('![the fix](image2)')
  })

  it('does not mutate its input, so the loop can accumulate safely', () => {
    const before = { coverImage: null, bodyMarkdown: BODY }
    applyIllustration(before, 'image1', 'https://res.cloudinary.com/x/one.jpg')

    expect(before.bodyMarkdown).toBe(BODY)
    expect(before.coverImage).toBeNull()
  })

  it('accumulates across calls the way the run does', () => {
    let state: { coverImage: string | null; bodyMarkdown: string } = {
      coverImage: null,
      bodyMarkdown: BODY,
    }
    state = applyIllustration(
      state,
      COVER_KEY,
      'https://res.cloudinary.com/x/c.jpg'
    )
    state = applyIllustration(
      state,
      'image1',
      'https://res.cloudinary.com/x/1.jpg'
    )
    state = applyIllustration(
      state,
      'image2',
      'https://res.cloudinary.com/x/2.jpg'
    )

    expect(publishBlockers({ title: 'Five things', ...state })).toEqual([])
  })
})

describe('publishBlockers', () => {
  const finished = {
    title: 'Five things',
    bodyMarkdown: 'A post with no placeholders.',
    coverImage: 'https://res.cloudinary.com/x/cover.jpg',
  }

  it('is empty for a finished post', () => {
    expect(publishBlockers(finished)).toEqual([])
  })

  it('refuses a post that still has a placeholder, named', () => {
    expect(
      publishBlockers({ ...finished, bodyMarkdown: 'text ![a](image3)' })
    ).toEqual(['"image3" is still a placeholder'])
  })

  it('counts rather than lists when more than one is missing', () => {
    expect(
      publishBlockers({
        ...finished,
        bodyMarkdown: '![a](image1) ![b](image2)',
      })
    ).toEqual(['2 images are still placeholders'])
  })

  it('refuses a post with no cover, because a share of it is a bare link', () => {
    expect(publishBlockers({ ...finished, coverImage: null })).toEqual([
      'it has no cover image',
    ])
  })

  it('refuses an empty title and an empty body', () => {
    expect(
      publishBlockers({ title: '  ', bodyMarkdown: '\n', coverImage: null })
    ).toEqual(['it has no title', 'it has no body', 'it has no cover image'])
  })

  it('does not hold a post back for a missing excerpt', () => {
    // Deliberate: a missing excerpt is a worse search result, not a broken page. The type
    // has no excerpt field at all, which is the enforcement - this test is the record of why.
    expect(publishBlockers(finished)).toEqual([])
  })
})

describe('describeBlockers', () => {
  it('is empty for no blockers', () => {
    expect(describeBlockers([])).toBe('')
  })

  it('passes one through unchanged', () => {
    expect(describeBlockers(['it has no cover image'])).toBe(
      'it has no cover image'
    )
  })

  it('joins several into a sentence rather than a list', () => {
    expect(
      describeBlockers([
        'it has no title',
        'it has no cover image',
        '2 images are still placeholders',
      ])
    ).toBe(
      'it has no title, it has no cover image and 2 images are still placeholders'
    )
  })
})
