'use client'

import Link from 'next/link'
import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react'

import BlogToolbar from '@/components/blog-admin/BlogToolbar'
import OwnerAuthGate from '@/components/settings/OwnerAuthGate'
import SettingErrorBanner from '@/components/settings/SettingErrorBanner'
import SettingLoading from '@/components/settings/SettingLoading'
import { inputCls, labelCls, uploadInputCls } from '@/components/settings/settings-utils'
import { uploadAssetToCloudinary } from '@/components/settings/settings-utils'
import { POST_SERIES } from '@/lib/blog/constants'

/**
 * The split-pane editor.
 *
 * ```
 *   ┌─────────────────────────┬─────────────────────────┐
 *   │  markdown source        │  rendered preview       │
 *   │  (textarea)             │  POST /api/admin/blog/  │
 *   │                         │       preview           │
 *   │  autosave, 1.2s debounce│  debounced with it      │
 *   └─────────────────────────┴─────────────────────────┘
 * ```
 *
 * ## Why the preview is a server round trip and not a client render
 *
 * `lib/blog/markdown.ts` opens with `import 'server-only'`, which a client component cannot
 * import - by design rather than by accident. Rendering here would mean shipping remark,
 * rehype, the sanitize schema and every Shiki grammar into the browser, and it would put the
 * sanitizer that decides what is safe on the machine of whoever is typing. The preview would
 * also stop matching what gets stored, which is the one thing a preview has to do.
 *
 * So the preview posts to `/api/admin/blog/preview` - the sixth gated handler - and renders
 * exactly the HTML the save path would produce, from the same function.
 *
 * ## Why autosave and preview share one debounce
 *
 * They are the same keystroke. Two timers would mean two requests per pause, each paying
 * Shiki, and the preview would sometimes show a render of text that had already been
 * superseded by the save. One timer, two requests, in order.
 *
 * The debounce is 1.2s rather than the more usual 300ms because each save re-renders the
 * whole document through Shiki server-side. `BLOG_SAVE_LIMIT` is the backstop if this is ever
 * wrong - it is generous enough that a person cannot hit it and tight enough that a broken
 * retry loop can.
 *
 * ## The slug field disappears after publishing
 *
 * Rather than rendering it disabled. A disabled input invites the question "why can I not
 * edit this", and the answer is a sentence about indexed URLs and feed readers that belongs
 * next to the field, not in a tooltip. The API refuses the change either way (409).
 */

type EditorPost = {
  _id: string
  slug: string
  title: string
  excerpt: string
  kind: 'article' | 'note'
  series: string | null
  isPillar: boolean
  bodyMarkdown: string
  coverImage: string | null
  tags: string[]
  relatedSlugs: string[]
  language: 'vi' | 'en'
  status: 'draft' | 'published' | 'archived' | 'deleted'
  publishedAt: string | null
}

const DEBOUNCE_MS = 1200

export default function BlogEditor({ id }: { id: string }) {
  const [post, setPost] = useState<EditorPost | null>(null)
  const [preview, setPreview] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [uploading, setUploading] = useState(false)

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch(`/api/admin/blog/${id}`, { cache: 'no-store' })
      if (res.status === 401) {
        setPost(null)
        return
      }
      const data = (await res.json()) as { post?: EditorPost; error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Could not load the post')
      if (data.post) setPost(data.post)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load the post')
    }
  }, [id])

  const bootstrap = useEffectEvent(() => {
    void load()
  })

  // Deferred to a macrotask so the fetch's setState does not run inside the effect body,
  // matching PublishBoard and AppProvider. The lint rule this satisfies is not a formality:
  // a setState in an effect body cascades a second render before paint.
  useEffect(() => {
    const timer = window.setTimeout(() => bootstrap(), 0)
    return () => window.clearTimeout(timer)
  }, [])

  /** Save, then refresh the preview from the same text. Order matters - see the header. */
  const flush = useCallback(
    async (next: EditorPost) => {
      setSaving(true)
      setError(null)
      try {
        const res = await fetch(`/api/admin/blog/${id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            slug: next.slug,
            title: next.title,
            excerpt: next.excerpt,
            kind: next.kind,
            series: next.series,
            isPillar: next.isPillar,
            bodyMarkdown: next.bodyMarkdown,
            coverImage: next.coverImage,
            tags: next.tags,
            relatedSlugs: next.relatedSlugs,
            language: next.language,
          }),
        })
        const data = (await res.json()) as { error?: string }
        if (!res.ok) throw new Error(data.error ?? 'Save failed')
        setSavedAt(new Date())

        const previewRes = await fetch('/api/admin/blog/preview', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ markdown: next.bodyMarkdown, slug: next.slug }),
        })
        const previewData = (await previewRes.json()) as { html?: string }
        if (previewRes.ok) setPreview(previewData.html ?? '')
      } catch (cause) {
        // Surfaced, never swallowed. A silent autosave failure is how an hour of writing is
        // lost - the author has no reason to suspect anything until they reload.
        setError(cause instanceof Error ? cause.message : 'Save failed')
      } finally {
        setSaving(false)
      }
    },
    [id]
  )

  function patch(changes: Partial<EditorPost>) {
    setPost(current => {
      if (!current) return current
      const next = { ...current, ...changes }

      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => void flush(next), DEBOUNCE_MS)

      return next
    })
  }

  const renderInitialPreview = useEffectEvent((current: EditorPost) => {
    void (async () => {
      const res = await fetch('/api/admin/blog/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ markdown: current.bodyMarkdown, slug: current.slug }),
      })
      if (res.ok) setPreview(((await res.json()) as { html?: string }).html ?? '')
    })()
  })

  // Render the preview once on load, so opening an existing post does not show a blank pane
  // until the first keystroke. Same macrotask defer as the bootstrap above.
  useEffect(() => {
    if (!post || preview) return
    const timer = window.setTimeout(() => renderInitialPreview(post), 0)
    return () => window.clearTimeout(timer)
  }, [post, preview])

  async function uploadCover(file: File) {
    setUploading(true)
    setError(null)
    try {
      // `post` kind: the only upload kind with a MIME allowlist, because what it produces
      // lands in markdown and the pipeline trusts that host unconditionally.
      const url = await uploadAssetToCloudinary(file, 'post')
      patch({ coverImage: url })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  if (!post) {
    return (
      <OwnerAuthGate onAuthed={() => void load()}>
        <SettingLoading title='Loading post...' subtitle='Opening the editor.' />
      </OwnerAuthGate>
    )
  }

  const isPublished = post.publishedAt !== null

  return (
    <OwnerAuthGate onAuthed={() => void load()}>
      <div className='portfolio-public-root min-h-screen pt-12 text-pp-text'>
        <div className='mx-auto max-w-[110rem] px-gutter py-8'>
          <BlogToolbar
            slug={post.slug}
            status={post.status}
            saving={saving}
            savedAt={savedAt}
            uploading={uploading}
            onPublish={() => patch({ status: 'published' })}
            onArchive={() => patch({ status: 'archived' })}
          />

          {error ? <div className='mt-4'><SettingErrorBanner message={error} /></div> : null}

          <div className='mt-6 grid gap-4 lg:grid-cols-2'>
            <div className='space-y-4'>
              <div>
                <label className={labelCls} htmlFor='title'>Title</label>
                <input
                  id='title'
                  className={inputCls}
                  value={post.title}
                  onChange={event => patch({ title: event.target.value })}
                />
              </div>

              {isPublished ? (
                <p className='text-xs leading-relaxed text-pp-muted'>
                  Slug is <code>{post.slug}</code> and is now frozen. This URL has been public,
                  so renaming it would 404 every inbound link and feed entry pointing at it.
                </p>
              ) : (
                <div>
                  <label className={labelCls} htmlFor='slug'>Slug</label>
                  <input
                    id='slug'
                    className={inputCls}
                    value={post.slug}
                    onChange={event => patch({ slug: event.target.value })}
                  />
                </div>
              )}

              <div>
                <label className={labelCls} htmlFor='excerpt'>Excerpt</label>
                <input
                  id='excerpt'
                  className={inputCls}
                  value={post.excerpt}
                  onChange={event => patch({ excerpt: event.target.value })}
                  placeholder='Optional for a note. Used as the meta description, cut at 155.'
                />
              </div>

              <div className='grid grid-cols-2 gap-3'>
                <div>
                  <label className={labelCls} htmlFor='kind'>Kind</label>
                  <select
                    id='kind'
                    className={inputCls}
                    value={post.kind}
                    onChange={event => patch({ kind: event.target.value as 'article' | 'note' })}
                  >
                    <option value='note'>note</option>
                    <option value='article'>article</option>
                  </select>
                </div>
                <div>
                  <label className={labelCls} htmlFor='series'>Series</label>
                  <select
                    id='series'
                    className={inputCls}
                    value={post.series ?? ''}
                    onChange={event => patch({ series: event.target.value || null })}
                  >
                    <option value=''>none</option>
                    {POST_SERIES.map(series => (
                      <option key={series} value={series}>
                        {series}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <label className='flex items-center gap-2 text-sm'>
                <input
                  type='checkbox'
                  checked={post.isPillar}
                  onChange={event => patch({ isPillar: event.target.checked })}
                />
                Pillar post for this series
                <span className='text-xs text-pp-muted'>(at most one per series)</span>
              </label>

              <div>
                <label className={labelCls} htmlFor='tags'>Tags</label>
                <input
                  id='tags'
                  className={inputCls}
                  value={post.tags.join(', ')}
                  onChange={event =>
                    patch({
                      tags: event.target.value
                        .split(',')
                        .map(tag => tag.trim())
                        .filter(Boolean),
                    })
                  }
                  placeholder='nextjs, caching'
                />
              </div>

              <div>
                <label className={labelCls} htmlFor='related'>Related slugs</label>
                <input
                  id='related'
                  className={inputCls}
                  value={post.relatedSlugs.join(', ')}
                  onChange={event =>
                    patch({
                      relatedSlugs: event.target.value
                        .split(',')
                        .map(slug => slug.trim())
                        .filter(Boolean),
                    })
                  }
                  placeholder='Resolved on read - unpublished ones simply render no link.'
                />
              </div>

              <div>
                <label className={labelCls} htmlFor='cover'>Cover image</label>
                <input
                  id='cover'
                  type='file'
                  accept='image/jpeg,image/png,image/webp,image/gif,image/avif'
                  className={uploadInputCls}
                  onChange={event => {
                    const file = event.target.files?.[0]
                    if (file) void uploadCover(file)
                  }}
                />
                {post.coverImage ? (
                  <p className='mt-1 truncate text-xs text-pp-muted'>{post.coverImage}</p>
                ) : null}
              </div>

              <div>
                <label className={labelCls} htmlFor='body'>Markdown</label>
                <textarea
                  id='body'
                  className={`${inputCls} min-h-[28rem] font-mono text-[13px] leading-relaxed`}
                  value={post.bodyMarkdown}
                  onChange={event => patch({ bodyMarkdown: event.target.value })}
                />
              </div>
            </div>

            <div className='lg:sticky lg:top-6 lg:h-[calc(100vh-8rem)] lg:overflow-y-auto'>
              <p className={labelCls}>Preview</p>
              {/*
                Rendered by the SAME function the save path uses, on the server. Not a
                client-side approximation - this is the stored HTML, sanitized and
                highlighted, so what is previewed is what publishes.
              */}
              <div
                className='blog-prose rounded-[1.2rem] border border-pp-line bg-white/72 p-5'
                dangerouslySetInnerHTML={{ __html: preview }}
              />
            </div>
          </div>

          <p className='mt-8 text-sm'>
            <Link href='/admin/blog' className='text-pp-muted no-underline hover:text-pp-text'>
              &larr; All posts
            </Link>
          </p>
        </div>
      </div>
    </OwnerAuthGate>
  )
}
