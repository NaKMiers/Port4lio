import type { Metadata } from 'next'

import BlogBoard from '@/components/blog-admin/BlogBoard'

export const metadata: Metadata = {
  title: 'Blog',
}

/**
 * `/admin/blog` - the board.
 *
 * A thin server shell around a client island, the same shape `/admin/metrics`
 * uses: the list is owner-only and force-dynamic anyway (the `(admin)`
 * layout sets it), so there is nothing for a server component to prerender, and the board
 * needs mutation handlers on every row.
 */
export default function AdminBlogPage() {
  return <BlogBoard />
}
