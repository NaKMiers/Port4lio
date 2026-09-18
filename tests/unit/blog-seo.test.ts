import type { Element, Root } from 'hast'
import { describe, expect, it } from 'vitest'

import type { PostListItem } from '@/lib/blog/post-data'
import { countProseWords, readingDuration, readingMinutes } from '@/lib/blog/reading'
import rehypeHeadingIds, { slugifyHeading } from '@/lib/blog/rehype-heading-ids'
import {
  blogEntityId,
  buildBlogIndexJsonLd,
  buildBlogIndexMetadata,
  buildPostJsonLd,
  buildPostMetadata,
} from '@/lib/blog/seo'
import { extractToc } from '@/lib/blog/toc'
import type { PublicProfile } from '@/lib/profile-public'
import { personEntityId, websiteEntityId } from '@/lib/structured-data'

/**
 * The blog's search surface.
 *
 * Same argument as `tests/unit/mbti-seo.test.ts`: these are cheap tests for something with a
 * very slow feedback loop. A `@graph` whose nodes do not reference each other, a breadcrumb
 * that disagrees with the page, or a title that silently lost its brand suffix are all
 * invisible in a browser and surface weeks later as a page that never ranked.
 *
 * The one test here that is not about ranking is the `</script>` case. That is a security
 * test: `post.title` is a stored field, and the post page interpolates this output into
 * `dangerouslySetInnerHTML`.
 */

const ORIGIN = 'https://example.com'

const PROFILE = {
  fullName: 'Anh Khoa Nguyen',
  avatar: 'https://res.cloudinary.com/demo/image/upload/avatar.png',
  socials: [
    { link: 'https://github.com/NaKMiers', icon: 'github', name: 'GitHub' },
    { link: 'https://x.com/somehandle', icon: 'x', name: 'X' },
    { link: 'not-a-url', icon: '', name: '' },
  ],
} as unknown as PublicProfile

function makePost(overrides: Partial<PostListItem> = {}): PostListItem {
  return {
    slug: 'measuring-revalidatepath',
    title: 'Measuring revalidatePath',
    excerpt: 'What the pattern form actually does, measured against a real build.',
    kind: 'article',
    series: 'measured-in-production',
    isPillar: false,
    language: 'en',
    coverImage: 'https://res.cloudinary.com/demo/image/upload/cover.png',
    coverCaption: 'The probe build output',
    tags: ['nextjs', 'isr'],
    publishedAt: new Date('2026-03-12T00:00:00.000Z'),
    contentUpdatedAt: new Date('2026-03-20T00:00:00.000Z'),
    ...overrides,
  } as PostListItem
}

/** Parses what the page actually inlines, so a broken escape shows up as a parse failure. */
function parseGraph(json: string): Record<string, unknown>[] {
  const parsed = JSON.parse(json) as { '@graph': Record<string, unknown>[] }
  return parsed['@graph']
}

function nodeOfType(graph: Record<string, unknown>[], type: string): Record<string, unknown> {
  const found = graph.find(node => node['@type'] === type)
  expect(found, `no ${type} node in the graph`).toBeDefined()
  return found as Record<string, unknown>
}

describe('post JSON-LD', () => {
  it('links every node to the next one by @id, all the way up to the site', () => {
    const graph = parseGraph(
      buildPostJsonLd({ post: makePost(), origin: ORIGIN, profile: PROFILE })
    )

    const person = nodeOfType(graph, 'Person')
    const blog = nodeOfType(graph, 'Blog')
    const webPage = nodeOfType(graph, 'WebPage')
    const posting = nodeOfType(graph, 'BlogPosting')

    // The chain the whole file exists to build: post → blog → website, author → the one
    // Person the portfolio already declares on `/`.
    expect(person['@id']).toBe(personEntityId(ORIGIN))
    expect(blog['@id']).toBe(blogEntityId(ORIGIN))
    expect(blog.isPartOf).toEqual({ '@id': websiteEntityId(ORIGIN) })
    expect(posting.isPartOf).toEqual({ '@id': blogEntityId(ORIGIN) })
    expect(posting.author).toEqual({ '@id': personEntityId(ORIGIN) })
    expect(webPage.isPartOf).toEqual({ '@id': blogEntityId(ORIGIN) })

    // WebPage and BlogPosting point at each other, which is the pairing that keeps
    // breadcrumb-and-links on the page and word-count-and-language on the article.
    expect(webPage.mainEntity).toEqual({ '@id': posting['@id'] })
    expect(posting.mainEntityOfPage).toEqual({ '@id': webPage['@id'] })
  })

  it('states the Person inline, because a bare @id reference would resolve to nothing', () => {
    const graph = parseGraph(
      buildPostJsonLd({ post: makePost(), origin: ORIGIN, profile: PROFILE })
    )
    const person = nodeOfType(graph, 'Person')

    // `name` is REQUIRED on author. The node carrying it lives on `/`, and a reference does
    // not reach across URLs to pull one in - see the comment on `personNode`.
    expect(person.name).toBe('Anh Khoa Nguyen')
    // Only `https://` socials, and the unparseable entry is dropped rather than emitted.
    expect(person.sameAs).toEqual(['https://github.com/NaKMiers', 'https://x.com/somehandle'])
  })

  it('carries the breadcrumb trail the page renders, in order', () => {
    const graph = parseGraph(
      buildPostJsonLd({ post: makePost(), origin: ORIGIN, profile: PROFILE })
    )
    const crumbs = nodeOfType(graph, 'BreadcrumbList').itemListElement as {
      position: number
      name: string
      item: string
    }[]

    expect(crumbs.map(c => c.position)).toEqual([1, 2, 3])
    expect(crumbs.map(c => c.name)).toEqual([
      'Home',
      'Writing',
      'Measuring revalidatePath',
    ])
    expect(crumbs[2].item).toBe(`${ORIGIN}/blog/measuring-revalidatepath`)
  })

  it('prefers the series title over the slug for articleSection', () => {
    const graph = parseGraph(
      buildPostJsonLd({
        post: makePost(),
        origin: ORIGIN,
        profile: PROFILE,
        seriesTitle: 'Measured in production',
      })
    )

    expect(nodeOfType(graph, 'BlogPosting').articleSection).toBe('Measured in production')
  })

  it('derives about and keywords from the same tags, and omits both when there are none', () => {
    const withTags = parseGraph(
      buildPostJsonLd({ post: makePost(), origin: ORIGIN, profile: PROFILE })
    )
    const posting = nodeOfType(withTags, 'BlogPosting')

    expect(posting.keywords).toBe('nextjs, isr')
    expect(posting.about).toEqual([
      { '@type': 'Thing', name: 'nextjs' },
      { '@type': 'Thing', name: 'isr' },
    ])

    const without = parseGraph(
      buildPostJsonLd({ post: makePost({ tags: [] }), origin: ORIGIN, profile: PROFILE })
    )
    const bare = nodeOfType(without, 'BlogPosting')

    expect(bare).not.toHaveProperty('keywords')
    expect(bare).not.toHaveProperty('about')
  })

  it('omits wordCount and timeRequired rather than claiming zero', () => {
    const graph = parseGraph(
      buildPostJsonLd({ post: makePost(), origin: ORIGIN, profile: PROFILE, wordCount: 0 })
    )
    const posting = nodeOfType(graph, 'BlogPosting')

    expect(posting).not.toHaveProperty('wordCount')
    expect(posting).not.toHaveProperty('timeRequired')
  })

  it('reports the reading time as the same duration the byline shows', () => {
    const graph = parseGraph(
      buildPostJsonLd({
        post: makePost(),
        origin: ORIGIN,
        profile: PROFILE,
        wordCount: 1400,
        readingMinutes: 7,
      })
    )

    expect(nodeOfType(graph, 'BlogPosting').timeRequired).toBe('PT7M')
    expect(nodeOfType(graph, 'BlogPosting').wordCount).toBe(1400)
  })

  it('cannot be broken out of by a title containing a closing script tag', () => {
    const json = buildPostJsonLd({
      post: makePost({ title: 'Breaking out </script><script>alert(1)</script>' }),
      origin: ORIGIN,
      profile: PROFILE,
    })

    // Nothing that could terminate the element survives into the emitted string, and what
    // does survive still parses back to the original title.
    expect(json).not.toContain('</script')
    expect(json).not.toContain('<')
    expect(nodeOfType(parseGraph(json), 'BlogPosting').headline).toContain('</script>')
  })
})

describe('blog index JSON-LD', () => {
  it('declares the Blog node the posts point at, with its posts listed', () => {
    const posts = [makePost(), makePost({ slug: 'second', title: 'Second post' })]
    const graph = parseGraph(buildBlogIndexJsonLd(ORIGIN, PROFILE, posts))
    const blog = nodeOfType(graph, 'Blog')

    expect(blog['@id']).toBe(blogEntityId(ORIGIN))
    expect(blog.url).toBe(`${ORIGIN}/blog`)
    expect(blog.isPartOf).toEqual({ '@id': websiteEntityId(ORIGIN) })

    const listed = blog.blogPost as { '@id': string; url: string }[]
    expect(listed).toHaveLength(2)
    // The `@id` of each entry matches the full node the post page emits, so the two merge
    // instead of describing two different articles at one URL.
    expect(listed[1]['@id']).toBe(`${ORIGIN}/blog/second#post`)
  })

  it('omits blogPost entirely on an empty blog rather than emitting an empty list', () => {
    const blog = nodeOfType(parseGraph(buildBlogIndexJsonLd(ORIGIN, PROFILE, [])), 'Blog')
    expect(blog).not.toHaveProperty('blogPost')
  })

  it('stops the breadcrumb at Writing, matching the two crumbs the page renders', () => {
    const graph = parseGraph(buildBlogIndexJsonLd(ORIGIN, PROFILE, []))
    const crumbs = nodeOfType(graph, 'BreadcrumbList').itemListElement as { name: string }[]

    expect(crumbs.map(c => c.name)).toEqual(['Home', 'Writing'])
  })
})

describe('post metadata', () => {
  it('appends the brand only when the whole title still fits the budget', () => {
    const short = buildPostMetadata(makePost({ title: 'Short title' }), ORIGIN, PROFILE)
    expect(short.title).toBe('Short title | Anh Khoa Nguyen')

    const long = buildPostMetadata(
      makePost({ title: 'A title long enough that the brand suffix would push it past sixty' }),
      ORIGIN,
      PROFILE
    )
    expect(long.title).not.toContain('| Anh Khoa Nguyen')
  })

  it('falls back to the site share card when a post has no cover of its own', () => {
    const withCover = buildPostMetadata(makePost(), ORIGIN, PROFILE)
    const withoutCover = buildPostMetadata(makePost({ coverImage: null }), ORIGIN, PROFILE)

    expect(withCover.openGraph?.images).toEqual([
      {
        url: 'https://res.cloudinary.com/demo/image/upload/cover.png',
        alt: 'The probe build output',
      },
    ])
    // Never `undefined`, which is what rendered a grey rectangle in every chat client.
    expect(withoutCover.openGraph?.images).toEqual([
      { url: `${ORIGIN}/opengraph-image`, alt: 'Measuring revalidatePath' },
    ])
  })

  it('reads the X handle off the profile, and stays silent when there is not one', () => {
    const withHandle = buildPostMetadata(makePost(), ORIGIN, PROFILE)
    expect(withHandle.twitter).toMatchObject({ creator: '@somehandle' })

    const noSocials = { ...PROFILE, socials: [] } as unknown as PublicProfile
    expect(buildPostMetadata(makePost(), ORIGIN, noSocials).twitter).not.toHaveProperty(
      'creator'
    )
  })

  it('canonicalises to the post URL and declares no hreflang (D7)', () => {
    const meta = buildPostMetadata(makePost(), ORIGIN, PROFILE)

    expect(meta.alternates?.canonical).toBe(`${ORIGIN}/blog/measuring-revalidatepath`)
    expect(meta.alternates).not.toHaveProperty('languages')
  })
})

describe('index metadata', () => {
  it('derives keywords from the tags actually published, most-used first', () => {
    const meta = buildBlogIndexMetadata(ORIGIN, [
      makePost({ slug: 'a', tags: ['nextjs', 'isr'] }),
      makePost({ slug: 'b', tags: ['nextjs'] }),
    ])

    expect(meta.keywords).toEqual(['nextjs', 'isr'])
  })

  it('omits keywords on an empty blog rather than inventing a subject', () => {
    expect(buildBlogIndexMetadata(ORIGIN)).not.toHaveProperty('keywords')
  })
})

describe('reading time', () => {
  it('does not count code blocks', () => {
    const prose = '<p>one two three four five</p>'
    const withCode = `${prose}<pre><code>${'token '.repeat(500)}</code></pre>`

    expect(countProseWords(prose)).toBe(5)
    expect(countProseWords(withCode)).toBe(5)
  })

  it('counts accented Vietnamese as words and stray punctuation as not', () => {
    expect(countProseWords('<p>đo lường được · -</p>')).toBe(3)
  })

  it('never reports zero minutes', () => {
    expect(readingMinutes(0)).toBe(1)
    expect(readingMinutes(12)).toBe(1)
    expect(readingMinutes(1400)).toBe(7)
    expect(readingDuration(7)).toBe('PT7M')
  })
})

describe('heading anchors and the table of contents', () => {
  it('slugifies to a charset that cannot escape an attribute', () => {
    expect(slugifyHeading('Why the order is this, and not the obvious one')).toBe(
      'why-the-order-is-this-and-not-the-obvious-one'
    )
    expect(slugifyHeading('Đo lường ISR')).toBe('do-luong-isr')
    expect(slugifyHeading('" onmouseover="alert(1)')).toBe('onmouseover-alert-1')
    // Nothing alphanumeric at all: no id, rather than the id `-`.
    expect(slugifyHeading('!!!')).toBe('')
  })

  it('reads levels, ids and labels back out of rendered HTML', () => {
    const html =
      '<h2 id="first">First</h2><p>x</p><h3 id="nested">A <code>nested</code> one</h3>' +
      '<h4 id="deep">Deep</h4>'

    expect(extractToc(html)).toEqual([
      { id: 'first', level: 2, text: 'First' },
      { id: 'nested', level: 3, text: 'A nested one' },
      { id: 'deep', level: 4, text: 'Deep' },
    ])
  })

  it('finds nothing in a body rendered before the pipeline added ids', () => {
    expect(extractToc('<h2>First</h2><h3>Second</h3>')).toEqual([])
  })

  it('does not leak lastIndex between calls on the shared regex', () => {
    const html = '<h2 id="a">A</h2><h2 id="b">B</h2>'

    // The `while (exec())` version of this returned [] on the second call.
    expect(extractToc(html)).toHaveLength(2)
    expect(extractToc(html)).toHaveLength(2)
  })

  it('suffixes duplicate headings instead of emitting the same id twice', () => {
    const heading = (tagName: string, text: string): Element => ({
      type: 'element',
      tagName,
      properties: {},
      children: [{ type: 'text', value: text }],
    })

    const tree: Root = {
      type: 'root',
      children: [heading('h2', 'Why'), heading('h2', 'Why'), heading('h1', 'Title')],
    }

    rehypeHeadingIds()(tree)

    const ids = (tree.children as Element[]).map(child => child.properties.id)
    expect(ids).toEqual(['why', 'why-2', undefined])
  })
})
