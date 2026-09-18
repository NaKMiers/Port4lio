import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import Breadcrumbs from '@/components/blog/Breadcrumbs'
import PostToc from '@/components/blog/PostToc'

/**
 * The two navigation surfaces the blog's structured data depends on existing.
 *
 * Both of these are rendered so that something machine-readable stays true:
 *
 * ```
 *   Breadcrumbs   the trail the page's BreadcrumbList describes
 *   PostToc       the in-page anchors "jump to" links in a search result need
 * ```
 *
 * Google's guidelines require breadcrumb markup to describe a trail a visitor can see, and
 * anchor results require a visible list of in-page links. So these components disappearing,
 * or rendering without the `href`s that make them navigation, would quietly invalidate JSON-LD
 * that keeps on being emitted - a failure with no error and no visible symptom.
 *
 * The assertions are about the *contract*, not the styling: which anchors exist, which
 * element is marked as the current page, and that nothing renders when there is nothing to
 * render. A class name changing should not fail this file.
 */

describe('Breadcrumbs', () => {
  it('links every crumb except the last, which is marked as the current page', () => {
    const html = renderToStaticMarkup(
      <Breadcrumbs
        trail={[
          { name: 'Home', href: '/' },
          { name: 'Writing', href: '/blog' },
          { name: 'Measuring revalidatePath', href: '/blog/measuring-revalidatepath' },
        ]}
      />
    )

    expect(html).toContain('aria-label="Breadcrumb"')
    expect(html).toContain('href="/"')
    expect(html).toContain('href="/blog"')
    // The current page is text, not a link: a link to the URL you are on is a dead control.
    expect(html).not.toContain('href="/blog/measuring-revalidatepath"')
    expect(html).toContain('aria-current="page"')
  })

  it('renders nothing at all for an empty trail', () => {
    expect(renderToStaticMarkup(<Breadcrumbs trail={[]} />)).toBe('')
  })
})

describe('PostToc', () => {
  it('emits one in-page anchor per heading, in document order', () => {
    const html = renderToStaticMarkup(
      <PostToc
        entries={[
          { id: 'first', level: 2, text: 'First' },
          { id: 'nested', level: 3, text: 'Nested' },
        ]}
      />
    )

    expect(html).toContain('href="#first"')
    expect(html).toContain('href="#nested"')
    expect(html.indexOf('#first')).toBeLessThan(html.indexOf('#nested'))
    // Labelled rather than `aria-label`ed, so the visible heading names the landmark once.
    expect(html).toContain('aria-labelledby="post-toc-heading"')
  })

  it('renders nothing for a post with no anchored headings', () => {
    // The case a post stored as `blog-md-1` hits: no heading ids, so no entries, so no
    // empty box above the article.
    expect(renderToStaticMarkup(<PostToc entries={[]} />)).toBe('')
  })
})
