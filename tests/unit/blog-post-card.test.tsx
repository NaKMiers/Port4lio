import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import PostCard from '@/components/blog/PostCard'
import type { PostListItem } from '@/lib/blog/post-data'

/**
 * The card every list on the site renders, and the four contracts that are not styling.
 *
 * ```
 *   /blog            BlogIndexList  (client, under the locale provider)
 *   /blog/<slug>     series peers and related posts
 *   /                WritingTeaser  (server, NO provider above it)
 * ```
 *
 * Three call sites, one component, and it renders under a provider in two of them and without
 * one in the third - which is why `useBlogLocale` falls back to English instead of throwing,
 * and why this file can render the card bare.
 *
 * The assertions are about the contract and NOT the classes, same rule as
 * `blog-navigation-markup.test.tsx`: which elements exist, what is machine-readable, and which
 * branches render nothing. A Tailwind edit should not fail this file. The four things worth
 * holding:
 *
 * 1. **One anchor, named by the title.** The card is clickable via a stretched pseudo-element
 *    rather than a wrapping `<a>`, precisely so a screen reader announces the title as the
 *    link name instead of reading out the eyebrow, date, badge, excerpt and every tag as one
 *    enormous link name. Wrapping the card is the obvious refactor and it is the regression.
 * 2. **The absent-data branches render nothing, not "undefined".** A post outlives a deleted
 *    kind, a note ships with no excerpt and no cover, and a draft has no `publishedAt`. Each of
 *    those is a normal state, not a defensive edge.
 * 3. **The date is machine-readable.** It is rendered `en-GB` in UTC for hydration reasons, so
 *    the only stable thing to assert on is the `dateTime` attribute.
 * 4. **The language badge marks a mismatch before the click, not after.**
 */

const BASE: PostListItem = {
  slug: 'revalidatepath-did-nothing',
  title: 'revalidatePath did not revalidate',
  excerpt: 'The documented pattern form is a no-op.',
  kind: 'article',
  series: 'measured-in-production',
  isPillar: false,
  language: 'en',
  coverImage: null,
  coverCaption: '',
  tags: ['nextjs', 'caching'],
  publishedAt: new Date('2026-09-18T23:40:00.000Z'),
  contentUpdatedAt: new Date('2026-09-18T23:40:00.000Z'),
  createdAt: new Date('2026-09-18T23:30:00.000Z'),
}

function render(post: Partial<PostListItem> = {}, props = {}) {
  return renderToStaticMarkup(
    <PostCard
      post={{ ...BASE, ...post }}
      {...props}
    />
  )
}

/** Every `<a ...>` in the markup, so "how many links does this card have" is answerable. */
function anchors(html: string): string[] {
  return html.match(/<a\b[^>]*>.*?<\/a>/g) ?? []
}

describe('the link', () => {
  it('points at the post and contains exactly the title', () => {
    const html = render()

    expect(anchors(html)).toHaveLength(1)
    expect(html).toContain('href="/blog/revalidatepath-did-nothing"')
    expect(anchors(html)[0]).toContain('revalidatePath did not revalidate')
  })

  it('does not wrap the whole card in the anchor', () => {
    // The accessible-name regression. If the excerpt or the tags end up inside the `<a>`, the
    // link is announced as the entire card contents.
    const [anchor] = anchors(render())

    expect(anchor).not.toContain('The documented pattern form is a no-op.')
    expect(anchor).not.toContain('nextjs')
  })
})

describe('the kind eyebrow', () => {
  it('names the kind when that kind asks to be named', () => {
    // `note` ships with `eyebrow: true` so a card for one reads as complete rather than as an
    // article missing its cover and excerpt.
    expect(render({}, { kind: { label: 'Note', eyebrow: true } })).toContain(
      'Note'
    )
  })

  it('stays silent for a kind that does not', () => {
    const html = render({}, { kind: { label: 'Article', eyebrow: false } })

    expect(html).not.toContain('Article')
  })

  it('renders no eyebrow at all when the kind is gone', () => {
    // A post outlives the kind it names if that kind is deleted from the editor. The card has
    // to come out without a label rather than with the word "undefined" over the title.
    const html = render()

    expect(html).not.toContain('undefined')
  })
})

describe('the language badge', () => {
  it('marks a post whose language is not the reader chrome language', () => {
    /*
      Outside a provider `useBlogLocale` falls back to `en`, which is also what the server
      renders - so a `vi` post is a mismatch here.

      Worth noticing rather than just asserting: `Post.language` now defaults to `vi`, and the
      blog chrome still server-renders `en`. That makes this the COMMON case on /blog rather
      than the exception it was written for, and every card in the list carries a badge until
      the chrome default moves too.
    */
    expect(render({ language: 'vi' })).toContain('Tiếng Việt')
  })

  it('says nothing when the post and the chrome agree', () => {
    expect(render({ language: 'en' })).not.toContain('English')
  })

  it('falls back to the raw code for a language it has no label for', () => {
    // `POST_LANGUAGE_LABEL` is a widened `Record<string, string>`, so a language added to the
    // schema without a label here must degrade to something rather than to `undefined`.
    const html = render({ language: 'ja' as PostListItem['language'] })

    expect(html).toContain('ja')
    expect(html).not.toContain('undefined')
  })
})

describe('the date', () => {
  it('is machine-readable regardless of how it is formatted', () => {
    // Case-insensitive on the attribute name: React's own SSR casing for it has moved between
    // majors, and which of `datetime` and `dateTime` lands in the string is not the contract.
    // The ISO value being there is.
    expect(render()).toMatch(/datetime="2026-09-18T23:40:00\.000Z"/i)
  })

  it('formats in UTC, which is what keeps the two render paths agreeing', () => {
    /*
      This card renders on the server AND inside `BlogIndexList`, a client component. Without a
      pinned `timeZone` the two format in whatever zone each environment has, a post published
      near midnight resolves to different days on each side, and React reports a hydration
      mismatch.

      23:40Z is chosen for exactly that: it is the following day in any zone east of UTC, so a
      formatter that lost its `timeZone: 'UTC'` prints "19 September" here.
    */
    expect(render()).toContain('18 September 2026')
  })

  it('renders no time element for a post that was never published', () => {
    const html = render({ publishedAt: null })

    expect(html).not.toContain('<time')
  })
})

describe('the parts a note is allowed not to have', () => {
  it('renders no excerpt paragraph when there is no excerpt', () => {
    // The cheap tier has to read as complete without one, or the tier is nominal and the author
    // still pays the full cost of a post every time.
    const html = render({ excerpt: '' })

    expect(html).not.toContain('The documented pattern form is a no-op.')
    expect(html).toContain('revalidatePath did not revalidate')
  })

  it('renders no image when there is no cover', () => {
    expect(render()).not.toContain('<img')
  })

  it('renders no tag list when there are no tags', () => {
    expect(render({ tags: [] })).not.toContain('<ul')
  })
})

describe('the cover image', () => {
  it('becomes a figure with a caption when the author wrote one', () => {
    const html = render({
      coverImage: 'https://res.cloudinary.com/demo/image/upload/cover.jpg',
      coverCaption: 'The sitemap, in Chrome',
    })

    expect(html).toContain('<figcaption')
    expect(html).toContain('The sitemap, in Chrome')
  })

  it('is decorative and hidden from assistive tech when there is no caption', () => {
    // An uncaptioned cover carries no information a screen reader user needs, and an empty alt
    // plus `aria-hidden` says that, where a guessed alt would say something untrue.
    const html = render({
      coverImage: 'https://res.cloudinary.com/demo/image/upload/cover.jpg',
    })

    expect(html).toContain('aria-hidden')
    expect(html).not.toContain('<figcaption')
  })

  it('renders whatever the author attached, regardless of the tier', () => {
    // Deliberately not gated on `article`: a note that carries a picture shows it. The tier
    // shows through the data rather than through a branch that overrules the author.
    const html = render(
      { coverImage: 'https://res.cloudinary.com/demo/image/upload/cover.jpg' },
      { kind: { label: 'Note', eyebrow: true } }
    )

    expect(html).toContain('<img')
  })
})

describe('the tag list', () => {
  it('shows at most four, so a well-tagged post does not become a tag cloud', () => {
    const html = render({
      tags: ['one', 'two', 'three', 'four', 'five', 'six'],
    })

    expect(html).toContain('>four<')
    expect(html).not.toContain('>five<')
  })
})

describe('the category', () => {
  it('shows the category above the title when the List view passes one', () => {
    const html = render({}, { category: 'Measured in production' })

    expect(html).toContain('Measured in production')
    // Above the title, and outside the link - the link's name stays the title alone.
    expect(html.indexOf('Measured in production')).toBeLessThan(
      html.indexOf('revalidatePath did not revalidate')
    )
    expect(anchors(html)[0]).not.toContain('Measured in production')
  })

  it('shows no category when none is passed, as under "By category"', () => {
    expect(render()).not.toContain('Measured in production')
  })

  it('shares the eyebrow line with the kind label when a post has both', () => {
    const html = render(
      {},
      {
        category: 'Measured in production',
        kind: { label: 'Note', eyebrow: true },
      }
    )

    expect(html).toContain('Measured in production')
    expect(html).toContain('>Note<')
  })
})
