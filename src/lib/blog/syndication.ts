/**
 * The cross-post bundle: everything a channel needs, in one copyable block.
 *
 * ## Why the availability footer is in here and not left to the author
 *
 * The first version of this bundle was markdown plus a canonical URL plus tags, and it
 * omitted the footer. That omission quietly defeats the feature's one P0 conversion
 * criterion: the availability block renders on `/blog/<slug>`, and `/blog/<slug>` is the page
 * almost nobody reads. The audience is on Viblo and DEV.to - that is the entire reason for
 * cross-posting - so a bundle without the footer puts the conversion path only on the domain
 * and never on the channel where the readers are.
 *
 * Generating it here rather than trusting a checklist is the difference between a thing that
 * happens every time and a thing that happens for the first two posts.
 *
 * ## Why the footer language follows the CHANNEL, not the post
 *
 * A Viblo cross-post is read by a Vietnamese audience whatever language the canonical post
 * is in. Under D7 the blog itself is English-only and the Vietnamese version of a post is a
 * native Viblo post, so the common case is exactly this: English source, Vietnamese footer.
 * Taking the language from `post.language` would put an English hire-me line at the bottom of
 * a Vietnamese post.
 */

export type SyndicationTarget = 'devto' | 'viblo'

const FOOTER: Record<SyndicationTarget, (canonical: string) => string> = {
  devto: canonical =>
    [
      '---',
      '',
      '*I build full stack products - I wrote both of the personality tests on my site, and',
      'this post came out of shipping them. I am open to full stack work, contract or full',
      `time. [Portfolio and contact](${canonical.replace(/\/blog\/.*$/, '/#contact')}).*`,
      '',
      `*Originally published at [${canonical}](${canonical}).*`,
    ].join('\n'),

  viblo: canonical =>
    [
      '---',
      '',
      '*Mình là lập trình viên full stack, tự viết cả hai bài test tính cách trên trang cá',
      'nhân - bài viết này ra đời từ quá trình đó. Nếu bạn muốn trao đổi về một dự án, cứ',
      `nhắn cho mình: [portfolio và liên hệ](${canonical.replace(/\/blog\/.*$/, '/#contact')}).*`,
      '',
      `*[Bản tiếng Anh đầy đủ](${canonical}).*`,
    ].join('\n'),
}

export function buildSyndicationBundle({
  target,
  title,
  bodyMarkdown,
  canonical,
  tags,
}: {
  target: SyndicationTarget
  title: string
  bodyMarkdown: string
  canonical: string
  tags: string[]
}): string {
  if (target === 'devto') {
    // DEV.to reads this front matter directly on paste, and `canonical_url` is what stops
    // the cross-post competing with the original in search results.
    return [
      '---',
      `title: ${title}`,
      'published: false',
      `tags: ${tags.slice(0, 4).join(', ')}`,
      `canonical_url: ${canonical}`,
      '---',
      '',
      bodyMarkdown,
      '',
      FOOTER.devto(canonical),
    ].join('\n')
  }

  // Viblo has no front-matter convention, so the metadata goes in as a comment the author
  // strips, and the canonical link is carried by the footer instead.
  return [
    `<!-- ${title} | tags: ${tags.join(', ')} | canonical: ${canonical} -->`,
    '',
    bodyMarkdown,
    '',
    FOOTER.viblo(canonical),
  ].join('\n')
}
