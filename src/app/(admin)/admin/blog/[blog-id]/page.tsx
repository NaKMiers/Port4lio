import type { Metadata } from 'next'

import BlogEditor from '@/components/blog-admin/BlogEditor'

export const metadata: Metadata = {
  title: 'Edit post',
}

/**
 * `/admin/blog/<id>` - the split-pane editor.
 *
 * The id is handed to a client island rather than used to fetch here. The editor autosaves,
 * so it owns the document's lifecycle in the browser anyway, and a server fetch would only
 * produce an initial value that is stale the moment the first keystroke lands.
 */
export default async function AdminBlogEditorPage({
  params,
}: {
  params: Promise<{ 'blog-id': string }>
}) {
  const { 'blog-id': id } = await params
  return <BlogEditor id={id} />
}
