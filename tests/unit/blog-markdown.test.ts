import { beforeAll, describe, expect, it, vi } from 'vitest'

import {
  allAttributeNames,
  blogSanitizeSchema,
} from '@/lib/blog/sanitize-schema'

/**
 * The markdown pipeline, end to end, on real output.
 *
 * Two jobs, and the second is the one that justifies the file. The obvious job is proving
 * that hostile markdown is neutralised. The less obvious one is proving that the things the
 * sanitizer is *supposed to keep* survive - because the first version of this plan specified
 * a schema delta that would have stripped `className`, silently disabling every code block's
 * highlighting and breaking GFM footnotes and task lists, with no error anywhere. A test
 * suite that only asserts "the bad thing is gone" passes just as happily against a pipeline
 * that deletes everything.
 */

let renderMarkdown: (markdown: string, slug: string) => Promise<string>

beforeAll(async () => {
  process.env.CLOUDINARY_CLOUD_NAME = 'demo-cloud'
  renderMarkdown = (await import('@/lib/blog/markdown')).renderMarkdown
}, 30_000)

describe('the sanitize schema itself', () => {
  it("never admits `style` on any tag - it was never there to 'remove'", () => {
    // S-1. The first draft listed "remove style" as a delta, which was a no-op that read
    // like a control. This is the assertion that can actually fire: it fails the day
    // somebody ADDS it, which is the only direction the risk runs in.
    expect(allAttributeNames(blogSanitizeSchema)).not.toContain('style')
  })

  it('KEEPS the default className entries, including the one Shiki reads', () => {
    // The regression the first draft would have shipped. `code: [['className', /^language-./]]`
    // is how Shiki picks a grammar; strip className globally and every code block loses its
    // colour with no error at all.
    const codeAttributes = blogSanitizeSchema.attributes?.code ?? []
    const classNameEntry = codeAttributes.find(
      attribute => Array.isArray(attribute) && attribute[0] === 'className'
    )

    expect(
      classNameEntry,
      'code lost its className entry - Shiki cannot pick a grammar'
    ).toBeDefined()
  })

  it('narrows the URL schemes it accepts', () => {
    expect(blogSanitizeSchema.protocols?.href).toEqual([
      'http',
      'https',
      'mailto',
    ])
    expect(blogSanitizeSchema.protocols?.src).toEqual(['https'])
  })
})

describe('renderMarkdown - hostile input', () => {
  it('drops a raw <script> block entirely', async () => {
    const html = await renderMarkdown(
      'before\n\n<script>alert(1)</script>\n\nafter',
      'p'
    )

    expect(html).not.toContain('<script')
    expect(html).not.toContain('alert(1)')
    // The surrounding post still renders - dropping the tag is not dropping the document.
    expect(html).toContain('before')
    expect(html).toContain('after')
  })

  it('drops inline event handlers', async () => {
    const html = await renderMarkdown('<img src="x" onerror="alert(1)">', 'p')

    expect(html).not.toContain('onerror')
    expect(html).not.toContain('alert(1)')
  })

  it('drops a javascript: link but keeps the link text', async () => {
    const html = await renderMarkdown('[click](javascript:alert(1))', 'p')

    expect(html).not.toContain('javascript:')
    expect(html).toContain('click')
  })

  it('drops an author-written style attribute', async () => {
    const html = await renderMarkdown(
      '<p style="position:fixed;inset:0">x</p>',
      'p'
    )

    expect(html).not.toContain('position:fixed')
  })

  it('drops an off-host image but keeps the paragraph', async () => {
    const html = await renderMarkdown('![alt](https://evil.com/x.png)', 'p')

    expect(html).toContain('<img')
    expect(html).not.toContain('evil.com')
    // alt survives, so a reader with images off still gets the description.
    expect(html).toContain('alt')
  })
})

describe('renderMarkdown - what must survive', () => {
  it('keeps our own Cloudinary image', async () => {
    const url =
      'https://res.cloudinary.com/demo-cloud/image/upload/v1/cover.png'
    const html = await renderMarkdown(`![alt](${url})`, 'p')

    expect(html).toContain(url)
  })

  it('highlights a fenced code block, emitting Shiki style spans', async () => {
    const html = await renderMarkdown('```ts\nconst x: number = 1\n```', 'p')

    // Shiki's output is inline `style` on spans it creates itself - which only survives
    // because it runs AFTER the sanitize node. Running it before means the sanitizer
    // deletes every colour it just computed.
    expect(html).toContain('style=')
    expect(html).toContain('shiki')
  })

  it('renders GFM tables, task lists and footnotes', async () => {
    const html = await renderMarkdown(
      '| a | b |\n| - | - |\n| 1 | 2 |\n\n- [x] done\n- [ ] todo\n\nnote[^1]\n\n[^1]: the note',
      'p'
    )

    expect(html).toContain('<table')
    expect(html).toContain('type="checkbox"')
    // Footnotes are className-driven, so this is the other half of the S-1 regression.
    expect(html).toContain('footnotes')
  })

  it('keeps a normal external link', async () => {
    const html = await renderMarkdown('[docs](https://nextjs.org/docs)', 'p')

    expect(html).toContain('href="https://nextjs.org/docs"')
  })
})

describe('renderMarkdown - the error contract', () => {
  it('renders an unknown language as plain code instead of throwing', async () => {
    // F9. One unregistered fence must never 500 a live post for every reader. The fence is
    // downgraded on the way in, so Shiki is never handed a grammar it lacks.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})

    const html = await renderMarkdown(
      '```brainfuck\n+[-->-[>>+>-----<<]<--<---]\n```',
      'my-post'
    )

    expect(html).toContain('<pre')
    expect(html).toContain('+[--')
    expect(
      logged.mock.calls.some(call => String(call[0]).includes('my-post')),
      'the log does not name the post, so the author cannot find it'
    ).toBe(true)

    logged.mockRestore()
  })

  it('still highlights the other blocks on a page with one bad fence', async () => {
    // Why the fence is fixed on the way in rather than the whole render being try/caught:
    // catching around the pipeline would lose the entire post's HTML for one bad block.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})

    const html = await renderMarkdown(
      '```nope\nx\n```\n\n```ts\nconst y = 2\n```',
      'p'
    )

    expect(html).toContain('style=')
    logged.mockRestore()
  })

  it('handles an empty body without throwing', async () => {
    await expect(renderMarkdown('', 'p')).resolves.toBe('')
  })

  /*
    `rehypeHeadingIds` is the first plugin appended after the sanitize node, which the header
    of `lib/blog/markdown.ts` declares a closed list. These two assertions are what keeps that
    concession honest end to end: the ids have to actually appear in stringified output (the
    unit test in `blog-seo.test.ts` only exercises the visitor against a hand-built tree), and
    the value written has to stay inside the slug charset no matter what the heading says.
  */
  it('gives every h2/h3/h4 an id derived from its own text', async () => {
    const html = await renderMarkdown(
      '## First section\n\n### Nested `code` one',
      'p'
    )

    expect(html).toContain('<h2 id="first-section">')
    expect(html).toContain('<h3 id="nested-code-one">')
  })

  it('cannot be made to write anything but a slug into the id attribute', async () => {
    const html = await renderMarkdown('## Break" onmouseover="alert(1)', 'p')

    /*
      The quote and the handler survive as TEXT inside the heading, which is correct - that is
      literally what the author typed, and text content cannot execute. What matters is the
      opening tag: it must carry `id` and nothing else, because a slug that escaped its own
      attribute is how a heading becomes an event handler.
    */
    const openingTag = html.slice(html.indexOf('<h2'), html.indexOf('>') + 1)

    expect(openingTag).toBe('<h2 id="break-onmouseover-alert-1">')
  })
})
