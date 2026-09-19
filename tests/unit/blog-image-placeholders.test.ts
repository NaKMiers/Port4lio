import { describe, expect, it } from 'vitest'

import {
  carryForwardImages,
  countBodyImages,
  findImagePlaceholders,
  resolvedImageUrls,
  placeholderKeys,
  placeholderMarkdown,
  replacePlaceholder,
} from '@/lib/blog/image-placeholders'
import { contextAround, normaliseImagePrompt } from '@/lib/blog/image-prompt'

/**
 * The placeholder protocol, which is the whole contract between four separate things: the
 * generator that writes `![image](image1)`, the editor that renders a card for it, the upload
 * that replaces it, and the renderer that refuses its `src` until then - publishing a
 * sourceless `<img>`, which is a broken image on a live post rather than a silent omission.
 *
 * The tests that matter most here are the negative ones. A false positive - matching something
 * that is already a real image link - means the editor offers to "fix" a working image and
 * then rewrites it, which is the one failure in this feature that destroys work rather than
 * just failing to add any.
 */

describe('findImagePlaceholders', () => {
  it('finds them in document order', () => {
    const body = `## One\n\n![image](image2)\n\ntext\n\n![a chart](image1)`

    expect(findImagePlaceholders(body)).toEqual([
      { key: 'image2', alt: 'image' },
      { key: 'image1', alt: 'a chart' },
    ])
  })

  it('collapses a key used twice into one card', () => {
    // One key is one picture, so it is one prompt and one upload - and `replacePlaceholder`
    // fills both occurrences from that single upload.
    const body = `![image](image1)\n\n...\n\n![image](image1)`

    expect(findImagePlaceholders(body)).toHaveLength(1)
  })

  it('never matches a real image link', () => {
    const body = [
      '![a real one](https://res.cloudinary.com/demo/image/upload/v1/post/x.png)',
      '![relative](/images/local.png)',
      '![named like one](image1.png)',
      '![close](img1)',
      '![hyphenated](image-1)',
      '[not an image](image1)',
    ].join('\n\n')

    expect(findImagePlaceholders(body)).toEqual([])
  })

  it('is not confused by a module-level regex carrying lastIndex between calls', () => {
    /*
      `IMAGE_PLACEHOLDER_PATTERN` is a `/g` regex at module scope. A `while (exec())` loop over
      it would leave `lastIndex` partway through the string, so the NEXT caller - a different
      post, a second render - would start scanning from the middle and miss placeholders before
      that point. Two identical calls proving identical results is what pins that.
    */
    const body = '![image](image1) ... ![image](image2)'

    expect(findImagePlaceholders(body)).toEqual(findImagePlaceholders(body))
    expect(findImagePlaceholders(body)).toHaveLength(2)
  })

  it('finds nothing in an empty body', () => {
    expect(findImagePlaceholders('')).toEqual([])
  })
})

describe('replacePlaceholder', () => {
  const url = 'https://res.cloudinary.com/demo/image/upload/v1/post/chart.png'

  it('keeps the alt text', () => {
    // The alt is the one part an author is likely to have improved by hand - it is what a
    // screen reader reads - so arriving at the picture must not reset it to "image".
    const body = '![the two revalidate calls](image1)'

    expect(replacePlaceholder(body, 'image1', url)).toBe(`![the two revalidate calls](${url})`)
  })

  it('replaces every occurrence of the key', () => {
    const body = '![image](image1)\n\n![image](image1)'

    expect(replacePlaceholder(body, 'image1', url).match(/image1/g)).toBeNull()
  })

  it('does not match image1 inside image12', () => {
    // A prefix match here would rewrite `![image](image12)` to `![image](<url>2)`, producing a
    // URL that 404s and a placeholder that no longer shows a card to fix it.
    const body = '![image](image12)'

    expect(replacePlaceholder(body, 'image1', url)).toBe(body)
  })

  it('leaves other keys alone', () => {
    const body = '![image](image1)\n![image](image2)'
    const after = replacePlaceholder(body, 'image1', url)

    expect(findImagePlaceholders(after)).toEqual([{ key: 'image2', alt: 'image' }])
  })
})

describe('placeholderMarkdown and placeholderKeys', () => {
  it('produce exactly what findImagePlaceholders reads back', () => {
    // The round trip is the point: the generator is told to write `placeholderMarkdown`'s
    // output, and the editor finds it with `findImagePlaceholders`. A format agreed by copying
    // is a format that drifts.
    const body = placeholderKeys(3).map(placeholderMarkdown).join('\n\n')

    expect(findImagePlaceholders(body).map(item => item.key)).toEqual([
      'image1',
      'image2',
      'image3',
    ])
  })

  it('returns nothing for zero or a negative count', () => {
    expect(placeholderKeys(0)).toEqual([])
    expect(placeholderKeys(-3)).toEqual([])
  })
})

describe('contextAround', () => {
  it('returns the prose either side of the placeholder, not the whole post', () => {
    /*
      This is the difference between a body-image prompt and a second cover. Handed only the
      title, the model writes another picture of the article's subject and the post ends up
      with three images of the same idea.
    */
    const body = `${'a'.repeat(3000)}\n\nSHIKI COSTS 5.5 SECONDS\n\n![image](image1)\n\n${'b'.repeat(3000)}`
    const context = contextAround(body, 'image1')

    expect(context).toContain('SHIKI COSTS 5.5 SECONDS')
    expect(context.length).toBeLessThan(body.length)
  })

  it('falls back to the head of the post when the key has been deleted', () => {
    // Reachable from a card that has not re-rendered yet. A prompt from the wrong context
    // beats an error for something this recoverable.
    expect(contextAround('## A post about caching', 'image9')).toContain('caching')
  })
})

describe('normaliseImagePrompt', () => {
  it('collapses newlines, because the field exists to be pasted elsewhere', () => {
    // A prompt with a hard line break pasted into an image tool's single-line input is a
    // prompt that submits halfway through.
    expect(normaliseImagePrompt('Isometric render\nof a cable\n\nsplit in two')).toBe(
      'Isometric render of a cable split in two'
    )
  })

  it('caps at the length the schema stores', () => {
    expect(normaliseImagePrompt('x'.repeat(5000))).toHaveLength(2000)
  })

  it('returns empty for anything that is not a string', () => {
    for (const value of [null, undefined, 42, {}, ['a']]) {
      expect(normaliseImagePrompt(value)).toBe('')
    }
  })
})

describe('what an unresolved placeholder actually renders as', () => {
  /**
   * Measured against the real pipeline, because the two plausible answers lead to different
   * UI and the wrong one was written first.
   *
   * `rehypeRestrictImageHosts` refuses a `src` it does not trust. The assumption was that it
   * removed the NODE, making a placeholder invisible - which would have made the editor's
   * warning a nicety. It deletes the ATTRIBUTE and keeps the node, so the output is a
   * sourceless `<img>`: a broken-image icon with the alt text, shown to readers of a published
   * post. That is why the warning is a banner rather than a hint, and this test is what stops
   * a future change to that plugin quietly invalidating the reasoning in three files.
   */
  it('is a sourceless img, not an absent one', async () => {
    process.env.CLOUDINARY_CLOUD_NAME = 'demo-cloud'
    const { renderMarkdown } = await import('@/lib/blog/markdown')

    const html = await renderMarkdown('![a chart](image1)', 'x')

    expect(html).toContain('<img')
    expect(html).toContain('alt="a chart"')
    expect(html).not.toContain('src=')
  }, 30_000)
})

describe('countBodyImages vs findImagePlaceholders', () => {
  /**
   * Two functions, two questions, and confusing them shipped a bug.
   *
   * `findImagePlaceholders` answers "what is still outstanding" - the editor's warning and its
   * upload cards. `countBodyImages` answers "how many pictures does this post have" - what a
   * regeneration preset needs. They agree on a fresh generated post and diverge the moment an
   * image is uploaded, which is precisely when the preset was reading the wrong one and
   * regenerating a visibly illustrated post with no images at all.
   */
  const RESOLVED = 'https://res.cloudinary.com/demo/image/upload/v1/post/a.png'

  it('diverge exactly when an image has been uploaded', () => {
    const body = `![image](image1)\n\n![image](${RESOLVED})`

    expect(findImagePlaceholders(body)).toHaveLength(1)
    expect(countBodyImages(body)).toBe(2)
  })

  it('counts a fully illustrated post that has no placeholders left', () => {
    // The regression case. Outstanding placeholders is 0 here, and presetting that as the
    // post's image count is what told the model to write none.
    const body = `![one](${RESOLVED})\n\n![two](${RESOLVED})`

    expect(findImagePlaceholders(body)).toHaveLength(0)
    expect(countBodyImages(body)).toBe(2)
  })

  it('counts an image with no alt text', () => {
    expect(countBodyImages(`![](${RESOLVED})`)).toBe(1)
  })

  it('does not count a plain link', () => {
    expect(countBodyImages(`[not an image](${RESOLVED})`)).toBe(0)
  })

  it('is zero on a post with no images', () => {
    expect(countBodyImages('## Just words\n\nand more words.')).toBe(0)
  })
})

const A = 'https://res.cloudinary.com/demo/image/upload/v1/a.png'
const B = 'https://res.cloudinary.com/demo/image/upload/v1/b.png'

describe('resolvedImageUrls - the third question this file answers', () => {
  it('returns real URLs and skips placeholders', () => {
    // Not `findImagePlaceholders` (what is outstanding) and not `countBodyImages` (how many
    // pictures). This one is "which pictures does this post already have", which is what a
    // rewrite needs in order not to throw them away.
    expect(resolvedImageUrls(`![a](${A})\n\n![image](image1)\n\n![b](${B})`)).toEqual([A, B])
  })

  it('returns them in document order, because position is the only thing a rewrite can match on', () => {
    expect(resolvedImageUrls(`![b](${B})\n\n![a](${A})`)).toEqual([B, A])
  })

  it('is empty for a body of nothing but placeholders', () => {
    expect(resolvedImageUrls('![image](image1)\n\n![image](image2)')).toEqual([])
  })

  it('ignores a markdown title on the image', () => {
    // `![alt](url "title")` is valid markdown. Capturing the title as part of the URL would
    // carry a broken string forward into the new body.
    expect(resolvedImageUrls(`![a](${A} "A caption")`)).toEqual([A])
  })
})

describe('carryForwardImages - what stops a rewrite publishing broken images', () => {
  it('puts the old pictures under the new placeholders, in order', () => {
    /*
      The regression this exists for, in one assertion. Regenerating a PUBLISHED post replaced
      its body with bare placeholders and kept `status: 'published'` - and an unresolved
      placeholder renders as `<img>` with no src, which every browser paints as a broken-image
      icon. Two uploads that had been made and paid for were orphaned at the same time.
    */
    const result = carryForwardImages(
      '## New\n\n![image](image1)\n\ntext\n\n![image](image2)',
      `## Old\n\n![one](${A})\n\n![two](${B})`
    )

    expect(result.markdown).toContain(A)
    expect(result.markdown).toContain(B)
    expect(result.markdown).not.toContain('(image1)')
    expect(result.carried).toBe(2)
    expect(result.dropped).toEqual([])
  })

  it('keeps the alt text the NEW body chose, not the old one', () => {
    // `replacePlaceholder` preserves the alt on the placeholder it replaces. The new body is
    // new prose, so its alt describes the new context - carrying the old alt forward would
    // caption a picture against text that no longer exists.
    const result = carryForwardImages('![a fresh caption](image1)', `![the old caption](${A})`)

    expect(result.markdown).toBe(`![a fresh caption](${A})`)
  })

  it('leaves surplus placeholders alone - they are genuinely new slots', () => {
    const result = carryForwardImages('![image](image1)\n\n![image](image2)', `![one](${A})`)

    expect(result.carried).toBe(1)
    expect(result.markdown).toContain(A)
    expect(result.markdown).toContain('(image2)')
  })

  it('reports surplus PICTURES rather than dropping them silently', () => {
    // The caller quotes these back in full. A picture that no longer fits is a URL the author
    // may want to re-place by hand, and losing it without a word is the same failure class as
    // blanking it.
    const result = carryForwardImages('![image](image1)', `![one](${A})\n\n![two](${B})`)

    expect(result.carried).toBe(1)
    expect(result.dropped).toEqual([B])
  })

  it('is a no-op when the old body had no pictures', () => {
    const next = '## New\n\n![image](image1)'

    expect(carryForwardImages(next, '## Old\n\nJust prose.')).toEqual({
      markdown: next,
      carried: 0,
      dropped: [],
    })
  })

  it('is a no-op when the new body has no placeholders', () => {
    // A rewrite that asked for no images. The old pictures are reported as dropped rather than
    // forced into a body that has nowhere to put them.
    const result = carryForwardImages('## New\n\nJust prose.', `![one](${A})`)

    expect(result.markdown).toBe('## New\n\nJust prose.')
    expect(result.dropped).toEqual([A])
  })

  it('does not reuse one picture for two placeholders', () => {
    // Position matching means one URL per slot. Filling both from the single old image would
    // duplicate a picture the author never chose to repeat.
    const result = carryForwardImages('![image](image1)\n\n![image](image2)', `![one](${A})`)

    expect((result.markdown.match(/res\.cloudinary\.com/g) ?? [])).toHaveLength(1)
  })
})
