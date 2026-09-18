import { listPublishedPosts } from '@/lib/blog/post-data'
import { blogIndexUrl, postUrl } from '@/lib/blog/seo'
import { resolveSiteOrigin } from '@/lib/seo'

/**
 * `/blog/rss.xml`
 *
 * ## `revalidate` has to be declared HERE, on the route handler
 *
 * A page's `export const revalidate` covers that page. This is a Route Handler, not a page,
 * and it gets no caching behaviour from `(blog)/blog/page.tsx` sitting next to it - so
 * without this line the feed is either fully dynamic or cached forever depending on what
 * Next infers, and neither is what the index does. 300 matches the index and the post pages,
 * and `revalidatePublishedPost` names this exact path so a publish clears it immediately
 * rather than after the window.
 *
 * ## Why the feed carries excerpts and not bodies
 *
 * `bodyHtml` is `select: false` and `listPublishedPosts` does not ask for it, so this is
 * partly just the query. But it is also the right call: a full-text feed means a reader never
 * arrives at the post, and the one thing the blog is measured on is whether a reader reaches
 * the availability block at the foot of the page. A feed is a notification channel here, not
 * a reading surface.
 *
 * ## Escaping
 *
 * Every interpolated value goes through `escapeXml`. Titles and excerpts are author text, not
 * stranger text, so this is not a security boundary in the way the markdown pipeline is - but
 * an ampersand in a title produces a feed that is not well-formed XML, and a feed reader's
 * response to that is to drop the whole document silently. One `&` in one title would take
 * the entire feed offline with no error anywhere.
 */

export const revalidate = 300

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export async function GET() {
  const origin = resolveSiteOrigin().replace(/\/$/, '')
  const posts = await listPublishedPosts()

  const items = posts
    .map(post => {
      const url = postUrl(origin, post.slug)
      return `    <item>
      <title>${escapeXml(post.title)}</title>
      <link>${escapeXml(url)}</link>
      <guid isPermaLink="true">${escapeXml(url)}</guid>
      ${post.publishedAt ? `<pubDate>${post.publishedAt.toUTCString()}</pubDate>` : ''}
      ${post.excerpt ? `<description>${escapeXml(post.excerpt)}</description>` : ''}
    </item>`
    })
    .join('\n')

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Anh Khoa Nguyen - Writing</title>
    <link>${escapeXml(blogIndexUrl(origin))}</link>
    <description>Things I measured while shipping side projects.</description>
    <language>en</language>
    <atom:link href="${escapeXml(`${origin}/blog/rss.xml`)}" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>`

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
    },
  })
}
