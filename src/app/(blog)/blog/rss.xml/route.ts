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

/**
 * The byline on every item.
 *
 * A literal rather than a profile read, and that is a deliberate difference from the pages:
 * a feed is a cache of what was true when it was generated, it is re-read by aggregators for
 * years, and adding a database call here would put the whole feed behind a query that can
 * fail. `lib/blog/seo.ts` carries the same fallback for the same name.
 */
const AUTHOR = 'Anh Khoa Nguyen'

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
      /*
        `<category>` per tag, and `<dc:creator>` for the author.

        Both are how an aggregator files a post rather than merely listing it - a reader
        subscribed through a service that supports topic filtering sees this post under the
        tags it actually carries, and a syndicated copy is attributed instead of anonymous.
        The tags are the same values the page renders and the JSON-LD declares as `keywords`,
        so there is one source for all three.
      */
      const categories = post.tags
        .map(tag => `      <category>${escapeXml(tag)}</category>`)
        .join('\n')

      return `    <item>
      <title>${escapeXml(post.title)}</title>
      <link>${escapeXml(url)}</link>
      <guid isPermaLink="true">${escapeXml(url)}</guid>
      <dc:creator>${escapeXml(AUTHOR)}</dc:creator>
      ${post.publishedAt ? `<pubDate>${post.publishedAt.toUTCString()}</pubDate>` : ''}
      ${post.excerpt ? `<description>${escapeXml(post.excerpt)}</description>` : ''}
${categories}
    </item>`
    })
    .join('\n')

  /*
    `lastBuildDate` from the newest post's own `contentUpdatedAt`, never `new Date()`.

    The same cry-wolf failure `sitemap.ts` documents for `lastModified` applies here one
    channel over: with `revalidate = 300`, a live clock would tell every polling reader the
    feed changed five minutes ago, every time, forever. Aggregators use this field to decide
    whether to re-fetch, and one that learns the field is noise stops reading it - so the
    post that genuinely is new gets no priority either.
  */
  const lastBuild = posts[0]?.contentUpdatedAt ?? posts[0]?.publishedAt ?? null

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>${escapeXml(AUTHOR)} - Writing</title>
    <link>${escapeXml(blogIndexUrl(origin))}</link>
    <description>Things I measured while shipping side projects - mostly Next.js, mostly the parts the docs did not say.</description>
    <language>en</language>
    ${lastBuild ? `<lastBuildDate>${lastBuild.toUTCString()}</lastBuildDate>` : ''}
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
