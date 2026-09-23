import type { Locale } from '@/lib/i18n'

/**
 * Every string of blog CHROME, in both locales.
 *
 * ```
 *   layout   translated   headings, labels, buttons, placeholders, empty states
 *   content  never        post titles, excerpts, bodies, series titles, tags
 * ```
 *
 * ## The line between the two, and why it is where it is
 *
 * A post is written once, in one language, and stays in it - D7: the Vietnamese version of a
 * post is a native Viblo post rather than a translation of this URL. So translating post text
 * here is not an option, it is a different feature. What a Vietnamese reader gains from this
 * is that the furniture around the text stops being a second language to parse: "Start here",
 * "3 posts match", "Search titles, tags and series".
 *
 * Series titles and tags are content, not chrome, even though they look like labels. They are
 * author-entered, stored per record, and there is one of each - a `SERIES_COPY`-style
 * translation map would go stale the first time a series is renamed in the editor, and the
 * editor has no field to translate them into.
 *
 * ## Why this is a flat record and not a nested tree
 *
 * There are about twenty strings. A tree buys namespacing that twenty strings do not need,
 * and costs the thing that actually matters at this size: with a flat `Record<Locale, Copy>`
 * and a shared `Copy` type, TypeScript fails the build when one locale is missing a key.
 * Half-translated chrome is the normal failure mode of an i18n layer and this shape makes it
 * unrepresentable.
 */

export type BlogCopy = {
  eyebrow: string
  title: string
  writtenBy: string
  role: string
  intro: string
  postsCountOne: string
  postsCountMany: (n: number) => string
  mostlyAbout: string
  searchLabel: string
  searchPlaceholder: string
  searchClear: string
  resultsNone: string
  resultsOne: string
  resultsMany: (n: number) => string
  noMatchBody: (query: string) => string
  startHere: string
  morePosts: string
  viewLabel: string
  viewByCategory: string
  viewList: string
  searchShortcut: string
  emptyBlog: string
  backToWriting: string
}

export const BLOG_COPY: Record<Locale, BlogCopy> = {
  en: {
    eyebrow: 'Blog',
    title: 'Things I measured while shipping',
    writtenBy: 'Written by',
    role: 'Full stack developer, Vietnam',
    intro:
      'Practical write-ups about building and running web products with Next.js, React and MongoDB. Each post comes from something I built myself: what I expected, what actually happened, and the numbers that showed the difference.',
    postsCountOne: '1 post so far',
    postsCountMany: n => `${n} posts so far`,
    mostlyAbout: 'mostly',
    searchLabel: 'Search posts',
    searchPlaceholder: 'Search titles, tags and series',
    searchClear: 'Clear search',
    resultsNone: 'No matches',
    resultsOne: '1 post matches',
    resultsMany: n => `${n} posts match`,
    noMatchBody: query =>
      `Nothing here for "${query}". This searches titles, tags and series - not the text inside a post.`,
    startHere: 'Start here',
    morePosts: 'More posts',
    viewLabel: 'View',
    viewByCategory: 'By category',
    viewList: 'List',
    searchShortcut: 'Press / to search',
    emptyBlog: 'Nothing published yet. The first posts are in progress.',
    backToWriting: 'All posts',
  },
  vi: {
    eyebrow: 'Blog',
    title: 'Những thứ mình đo được khi làm sản phẩm',
    writtenBy: 'Viết bởi',
    role: 'Lập trình viên full stack, Việt Nam',
    intro:
      'Ghi chép thực tế về việc xây dựng và vận hành sản phẩm web với Next.js, React và MongoDB. Mỗi bài đều xuất phát từ một thứ mình tự làm: mình đã nghĩ nó sẽ chạy thế nào, thực tế ra sao, và con số cho thấy khác biệt ở đâu.',
    postsCountOne: 'Hiện có 1 bài',
    postsCountMany: n => `Hiện có ${n} bài`,
    mostlyAbout: 'chủ yếu về',
    searchLabel: 'Tìm bài viết',
    searchPlaceholder: 'Tìm theo tiêu đề, thẻ hoặc chuyên mục',
    searchClear: 'Xoá từ khoá',
    resultsNone: 'Không có kết quả',
    resultsOne: 'Khớp 1 bài',
    resultsMany: n => `Khớp ${n} bài`,
    noMatchBody: query =>
      `Không có gì cho "${query}". Ô này tìm trong tiêu đề, thẻ và chuyên mục - không tìm trong nội dung bài.`,
    startHere: 'Bắt đầu từ đây',
    morePosts: 'Các bài khác',
    viewLabel: 'Cách hiển thị',
    viewByCategory: 'Theo chuyên mục',
    viewList: 'Danh sách',
    searchShortcut: 'Nhấn / để tìm',
    emptyBlog: 'Chưa có bài nào được đăng. Những bài đầu tiên đang được viết.',
    backToWriting: 'Tất cả bài viết',
  },
}

/**
 * The locale a post's own text is in is NOT the reader's chrome locale.
 *
 * A Vietnamese reader with the interface in Vietnamese still reads an English post in
 * English. `PostCard` marks the mismatch so a link that turns out to be unreadable is
 * labelled before it is clicked rather than after.
 */
export const POST_LANGUAGE_LABEL: Record<string, string> = {
  vi: 'Tiếng Việt',
  en: 'English',
}
