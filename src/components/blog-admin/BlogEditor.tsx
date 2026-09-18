'use client'

import React, { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react'

import BlogSaveDock from '@/components/blog-admin/BlogSaveDock'
import TaxonomyDialog, { type TaxonomyResource } from '@/components/blog-admin/TaxonomyDialog'
import BlogToolbar from '@/components/blog-admin/BlogToolbar'
import OwnerAuthGate from '@/components/settings/OwnerAuthGate'
import RailResizeHandle from '@/components/settings/RailResizeHandle'
import SelectField, { type SelectOption } from '@/components/settings/SelectField'
import Section from '@/components/settings/Section'
import { SectionOpenProvider } from '@/components/settings/SectionOpenContext'
import SettingErrorBanner from '@/components/settings/SettingErrorBanner'
import SettingLoading from '@/components/settings/SettingLoading'
import {
  emptyStateCls,
  ghostBtnCls,
  helpTextCls,
  inputCls,
  labelCls,
  uploadInputCls,
} from '@/components/settings/settings-utils'
import { uploadAssetToCloudinary } from '@/components/settings/settings-utils'
import { MAX_RAIL_WIDTH, MIN_RAIL_WIDTH } from '@/components/settings/useRailWidth'
import { buildSyndicationBundle, type SyndicationTarget } from '@/lib/blog/syndication'

/**
 * The split-pane editor.
 *
 * ```
 *   BlogToolbar            title · slug · saved-at · Publish · [Extend]
 *   ┌─────────────────────────────────────────┬──────────────────────┐
 *   │  Section  Post                          │  rendered preview    │
 *   │  Section  Classification                │  POST /api/admin/    │
 *   │  Section  Cover image                   │       blog/preview   │
 *   │  Section  Markdown  (the textarea)      │  sticky, resizable   │
 *   │  autosave, 1.2s debounce                │  debounced with it   │
 *   └─────────────────────────────────────────┴──────────────────────┘
 *                                             ^ RailResizeHandle
 * ```
 *
 * ## Why it borrows the settings editor's shell
 *
 * The two boards do the same job - a long form on the left, a live render of its result on
 * the right - and until now they looked like different products doing it. The pieces reused
 * here are the ones with no profile in their contract: `Section` (a collapsible card, which
 * also fixes eleven fields in one unbroken column), `SectionOpenProvider` (so which cards are
 * open survives a reload), `RailResizeHandle`, and the button and field classes.
 *
 * ## The two-column breakpoint is `lg`, and that is load-bearing
 *
 * It was briefly `xl` (1200px), copied from the settings page, and that is the one thing
 * about this layout that cannot be copied from there. Below the breakpoint the grid is a
 * single column and the preview sits UNDER the editor - which on the settings page costs a
 * scroll, and here costs the whole feature: the markdown card alone is `min-h-[32rem]`, so
 * the preview landed roughly four thousand pixels down and read as simply absent. At `lg` it
 * is beside the editor from 960px, which is where it was before the cards arrived.
 *
 * The rail track is `minmax(0, var(--rail-width))` rather than a bare `var(--rail-width)`
 * for the same reason at the other end: a width dragged wide on a large screen is remembered,
 * and a fixed track would then crush the markdown column on a smaller one. `minmax` lets the
 * rail give space back instead. `RailResizeHandle` stays `xl`-only - it is a shared component
 * and the settings grid really is `xl` - so between 960 and 1200 the rail is a fixed width,
 * which is exactly what this editor had before it was resizable at all.
 *
 * `useRailWidth` is deliberately NOT reused: it is keyed by `SettingTabId`, and this editor
 * has no tabs. Reusing it would mean widening that union with blog ids so a profile-shaped
 * hook could describe a second caller badly - the same trade this file's toolbar declined.
 * The rail width is local state here, persisted under its own key.
 *
 * ## `max-w-editorial` by default, full width on demand
 *
 * The editorial column is the width the rest of the site is set in, and it is the right
 * default for reading back what you wrote. It is the wrong width for a two-pane markdown
 * editor on a large screen, which is why the toolbar carries the same Extend/Shrink toggle
 * the profile editor has, remembered per browser.
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
  kind: string
  series: string | null
  isPillar: boolean
  bodyMarkdown: string
  coverImage: string | null
  coverCaption: string
  tags: string[]
  relatedSlugs: string[]
  language: 'vi' | 'en'
  status: 'draft' | 'published' | 'archived' | 'deleted'
  publishedAt: string | null
}

const DEBOUNCE_MS = 1200

/** Remembered so a wide-screen setup does not have to be re-chosen on the next post. */
const FULL_WIDTH_STORAGE_KEY = 'portfolio:blog-editor:full-width'
/** See the header - the rail width is local here rather than borrowed from `useRailWidth`. */
const RAIL_WIDTH_STORAGE_KEY = 'portfolio:blog-editor:rail-width'
/**
 * Sized for the DEFAULT layout, not the extended one.
 *
 * The editor opens inside `max-w-editorial` (1160px), so a rail wide enough to look right
 * edge-to-edge leaves the markdown column under 550px - and the markdown column is the one
 * being typed into. 440 leaves it ~620 here and is the wrong-but-recoverable direction:
 * Extend plus a drag widens the preview and the drag is remembered, while a default that
 * starts too wide has to be fought on every first visit.
 */
const DEFAULT_RAIL_WIDTH = 440
/**
 * Whether a string is far enough along to be worth putting in an `<img src>`.
 *
 * Only `http` and `https` - not `data:`, not a bare path. The value ends up in
 * `openGraph.images`, and a share card URL that only resolves relative to the editor is one
 * that resolves to nothing on LinkedIn.
 */
function isLikelyImageUrl(value: string | null): boolean {
  if (!value) return false
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/** How much of the markdown column must survive a rail drag. */
const MIN_EDITOR_WIDTH = 420

function readStoredFullWidth(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(FULL_WIDTH_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

/** Clamped on read as well as on write: the value is user-writable and a bad one lays out
 * the whole editor at `NaN`. */
function readStoredRailWidth(): number {
  if (typeof window === 'undefined') return DEFAULT_RAIL_WIDTH
  try {
    const raw = Number(window.localStorage.getItem(RAIL_WIDTH_STORAGE_KEY))
    if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_RAIL_WIDTH
    return Math.min(MAX_RAIL_WIDTH, Math.max(MIN_RAIL_WIDTH, Math.round(raw)))
  } catch {
    return DEFAULT_RAIL_WIDTH
  }
}

export default function BlogEditor({ id }: { id: string }) {
  const [post, setPost] = useState<EditorPost | null>(null)
  const [preview, setPreview] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [uploading, setUploading] = useState(false)
  const [copied, setCopied] = useState<SyndicationTarget | null>(null)
  /**
   * Whether an edit has been made that the server has not acknowledged yet.
   *
   * The toolbar used to derive its whole status from `saving` and `savedAt`, which left a
   * real state unrepresented: during the 1.2s debounce nothing is in flight and nothing has
   * been saved, so a freshly typed paragraph reported "No changes yet". That is the one
   * sentence an autosave editor must never say while holding unsaved work.
   */
  const [dirty, setDirty] = useState(false)
  /**
   * The series dropdown's options, fetched rather than imported.
   *
   * It used to be `POST_SERIES.map(...)` at module scope, which worked while the list was a
   * build-time constant. The list lives in `blog_series` now, and a client component cannot
   * import `SeriesModel` without pulling mongoose - and through it the whole mongodb driver -
   * into the browser bundle, which is the exact failure `lib/blog/constants.ts` documents.
   *
   * Starts as just `none` so the field renders something real before the fetch lands. The
   * post's own series is spliced in below if it is missing from the list, so an in-flight
   * load never makes the select look like the value was cleared.
   */
  const [seriesOptions, setSeriesOptions] = useState<SelectOption[]>([
    { value: '', label: 'none' },
  ])
  /** Same story as `seriesOptions`, minus the `none` - a post must always have a kind. */
  const [kindOptions, setKindOptions] = useState<SelectOption[]>([])
  /** Which taxonomy dialog is open, if any. One slot: they are modal, so never both. */
  const [taxonomyDialog, setTaxonomyDialog] = useState<TaxonomyResource | null>(null)
  const [fullWidth, setFullWidth] = useState(readStoredFullWidth)
  const [railWidth, setRailWidth] = useState(readStoredRailWidth)

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const layoutRef = useRef<HTMLDivElement | null>(null)
  const saveButtonRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    try {
      window.localStorage.setItem(FULL_WIDTH_STORAGE_KEY, JSON.stringify(fullWidth))
    } catch {
      // A blocked or full storage quota costs the preference, nothing more.
    }
  }, [fullWidth])

  useEffect(() => {
    try {
      window.localStorage.setItem(RAIL_WIDTH_STORAGE_KEY, String(railWidth))
    } catch {
      // A blocked or full storage quota costs the preference, nothing more.
    }
  }, [railWidth])

  /**
   * Clamped against the container as well as the absolute bounds, so dragging the rail wide
   * cannot squeeze the markdown column out of existence. Mirrors `useRailWidth.setWidth`.
   */
  const resizeRail = useCallback((next: number, containerWidth: number) => {
    const ceiling =
      containerWidth > 0
        ? Math.min(MAX_RAIL_WIDTH, Math.max(MIN_RAIL_WIDTH, containerWidth - MIN_EDITOR_WIDTH))
        : MAX_RAIL_WIDTH
    setRailWidth(Math.round(Math.min(ceiling, Math.max(MIN_RAIL_WIDTH, next))))
  }, [])

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

  const loadSeries = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/blog/series', { cache: 'no-store' })
      if (!res.ok) return
      const data = (await res.json()) as { series?: { slug: string; title: string }[] }
      setSeriesOptions([
        { value: '', label: 'none' },
        ...(data.series ?? []).map(item => ({ value: item.slug, label: item.title })),
      ])
    } catch {
      // Silent: the dropdown keeps whatever it has. A failed series fetch must not stop
      // someone editing the body of a post, which is what this page is for.
    }
  }, [])

  const loadKinds = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/blog/kinds', { cache: 'no-store' })
      if (!res.ok) return
      const data = (await res.json()) as { kinds?: { slug: string; label: string }[] }
      setKindOptions((data.kinds ?? []).map(item => ({ value: item.slug, label: item.label })))
    } catch {
      // Silent, same as series: a failed taxonomy fetch must not stop someone writing.
    }
  }, [])

  const bootstrap = useEffectEvent(() => {
    void load()
    void loadSeries()
    void loadKinds()
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
            coverCaption: next.coverCaption,
            tags: next.tags,
            relatedSlugs: next.relatedSlugs,
            language: next.language,
          }),
        })
        const data = (await res.json()) as { error?: string }
        if (!res.ok) throw new Error(data.error ?? 'Save failed')
        setSavedAt(new Date())
        setDirty(false)

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
    setDirty(true)
  }

  /**
   * Commit now rather than in `DEBOUNCE_MS`.
   *
   * Not a second way to save - the same `flush`, with the pending timer cancelled so the
   * debounced call cannot land a second, identical PATCH behind it. It exists because
   * "it saves by itself" and "I am about to close this tab" are not the same confidence:
   * autosave answers the first and nothing answered the second.
   */
  const saveNow = useCallback(() => {
    if (!post) return
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    void flush(post)
  }, [post, flush])

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

  /**
   * Copy a channel-ready bundle to the clipboard.
   *
   * Built from the CURRENT editor state rather than from what was last saved, so the author
   * can copy without waiting on the debounce - the bundle is for pasting elsewhere and never
   * touches the stored document.
   */
  async function copyBundle(target: SyndicationTarget) {
    if (!post) return
    const canonical = `${window.location.origin}/blog/${post.slug}`
    const bundle = buildSyndicationBundle({
      target,
      title: post.title,
      bodyMarkdown: post.bodyMarkdown,
      canonical,
      tags: post.tags,
    })

    try {
      await navigator.clipboard.writeText(bundle)
      setCopied(target)
      window.setTimeout(() => setCopied(null), 2000)
    } catch {
      setError('Could not reach the clipboard. Copy the markdown pane instead.')
    }
  }

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

  /**
   * The fetched options, plus this post's own series if it is not among them.
   *
   * Two cases produce that, and both would otherwise render as `none`: the fetch has not
   * landed yet, and the series was deleted from under a post that still references it. A
   * select showing `none` for a post that HAS a series is a lie the author would fix by
   * re-picking - and on the second case there is nothing to re-pick, so the honest thing is
   * to keep showing the orphaned value and say what it is.
   */
  const seriesChoices: SelectOption[] = seriesOptions.some(o => o.value === (post.series ?? ''))
    ? seriesOptions
    : [...seriesOptions, { value: post.series ?? '', label: `${post.series} (deleted)` }]

  /** Same splice as `seriesChoices`, and it matters more: a kind cannot be cleared to none. */
  const kindChoices: SelectOption[] = kindOptions.some(o => o.value === post.kind)
    ? kindOptions
    : [...kindOptions, { value: post.kind, label: `${post.kind} (deleted)` }]

  return (
    <OwnerAuthGate onAuthed={() => void load()}>
      {/* `max-w-editorial` matches the public site's column. Dropping the class entirely
          rather than swapping in `max-w-none` keeps this working regardless of which
          utilities Tailwind happened to generate - the same shape `/admin/settings` uses. */}
      <div
        className={`mx-auto w-full px-gutter py-10 md:py-12 ${fullWidth ? '' : 'max-w-editorial'}`}
      >
        <BlogToolbar
          slug={post.slug}
          title={post.title}
          status={post.status}
          saving={saving}
          savedAt={savedAt}
          dirty={dirty}
          uploading={uploading}
          fullWidth={fullWidth}
          onToggleFullWidth={() => setFullWidth(value => !value)}
          onSave={saveNow}
          saveButtonRef={saveButtonRef}
          onPublish={() => patch({ status: 'published' })}
          onArchive={() => patch({ status: 'archived' })}
        />

        <SettingErrorBanner message={error} />

        <SectionOpenProvider>
          {/* The rail track is a variable so `RailResizeHandle` can drive it without this
              layout being rebuilt on every pointer move, and so the single-column stack
              below `xl` stays a plain Tailwind class rather than an inline override. */}
          <div
            ref={layoutRef}
            className='grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,var(--rail-width))] lg:gap-8'
            style={{ '--rail-width': `${railWidth}px` } as React.CSSProperties}
          >
            <div className='space-y-5'>
              <Section id='blog-post' eyebrow='Blog editor' title='Post' defaultOpen>
                <div className='space-y-4'>
                  <div>
                    <label className={labelCls} htmlFor='title'>
                      Title
                    </label>
                    <input
                      id='title'
                      className={inputCls}
                      value={post.title}
                      onChange={event => patch({ title: event.target.value })}
                    />
                  </div>

                  {isPublished ? (
                    <p className={helpTextCls}>
                      Slug is <code>{post.slug}</code> and is now frozen. This URL has been
                      public, so renaming it would 404 every inbound link and feed entry
                      pointing at it.
                    </p>
                  ) : (
                    <div>
                      <label className={labelCls} htmlFor='slug'>
                        Slug
                      </label>
                      <input
                        id='slug'
                        className={inputCls}
                        value={post.slug}
                        onChange={event => patch({ slug: event.target.value })}
                      />
                    </div>
                  )}

                  <div>
                    <label className={labelCls} htmlFor='excerpt'>
                      Excerpt
                    </label>
                    <input
                      id='excerpt'
                      className={inputCls}
                      value={post.excerpt}
                      onChange={event => patch({ excerpt: event.target.value })}
                      placeholder='Optional for a note. Used as the meta description, cut at 155.'
                    />
                  </div>
                </div>
              </Section>

              <Section id='blog-classification' eyebrow='Blog editor' title='Classification'>
                <div className='space-y-4'>
                  <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
                    <div>
                      <div className='mb-1.5 flex items-baseline justify-between gap-2'>
                        <label className={`${labelCls} mb-0`} htmlFor='kind'>
                          Kind
                        </label>
                        <button
                          type='button'
                          className='text-[11px] font-semibold uppercase tracking-[0.14em] text-pp-blue transition hover:underline'
                          onClick={() => setTaxonomyDialog('kinds')}
                        >
                          Manage
                        </button>
                      </div>
                      <SelectField
                        id='kind'
                        value={post.kind}
                        options={kindChoices}
                        onChange={next => patch({ kind: next })}
                      />
                    </div>
                    <div>
                      <div className='mb-1.5 flex items-baseline justify-between gap-2'>
                        <label className={`${labelCls} mb-0`} htmlFor='series'>
                          Series
                        </label>
                        <button
                          type='button'
                          className='text-[11px] font-semibold uppercase tracking-[0.14em] text-pp-blue transition hover:underline'
                          onClick={() => setTaxonomyDialog('series')}
                        >
                          Manage
                        </button>
                      </div>
                      {/* `''` is the wire value for "no series"; the model stores `null`. The
                          empty string exists only so the option has a value at all. */}
                      <SelectField
                        id='series'
                        value={post.series ?? ''}
                        options={seriesChoices}
                        onChange={next => patch({ series: next || null })}
                      />
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
                    <label className={labelCls} htmlFor='tags'>
                      Tags
                    </label>
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
                    <label className={labelCls} htmlFor='related'>
                      Related slugs
                    </label>
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
                </div>
              </Section>

              <Section id='blog-cover' eyebrow='Blog editor' title='Cover image'>
                <label className={labelCls} htmlFor='cover'>
                  Upload
                </label>
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

                {/*
                  A URL field beside the upload, mirroring the CV photo in
                  `ResumeMastheadSection`. Uploading writes the Cloudinary URL into this same
                  field, so the two are one value with two ways in rather than two settings -
                  which is why it is bound to `post.coverImage` directly and not to a separate
                  piece of state that would then need reconciling.

                  `onChange`, not `onBlur`: `patch` already debounces at 1.2s, so per-keystroke
                  costs nothing extra and the preview below tracks a pasted URL as it is typed.
                */}
                <div className='mt-3'>
                  <label className={labelCls} htmlFor='cover-url'>
                    Image URL
                  </label>
                  <input
                    id='cover-url'
                    className={inputCls}
                    value={post.coverImage ?? ''}
                    placeholder='https://... or upload a file above'
                    onChange={event => patch({ coverImage: event.target.value.trim() || null })}
                  />
                </div>

                {/*
                  Under the preview rather than beside the URL, because that is where it
                  lands on the card: the field's position in the form mirrors the position of
                  what it produces.

                  Only shown when there is a cover. A caption field on a post with no image is
                  a field for text that has nothing to caption.
                */}
                {post.coverImage ? (
                  <div className='mt-3'>
                    <label className={labelCls} htmlFor='cover-caption'>
                      Caption
                    </label>
                    <input
                      id='cover-caption'
                      className={inputCls}
                      value={post.coverCaption}
                      maxLength={140}
                      placeholder='Credit or context, e.g. Photo: Anh Khoa Nguyen'
                      onChange={event => patch({ coverCaption: event.target.value })}
                    />
                    <p className={`${helpTextCls} mt-1`}>
                      Printed under the thumbnail in the post list. Leave empty and the image
                      is treated as decoration.
                    </p>
                  </div>
                ) : null}

                {/*
                  This help text used to say "and nowhere on the post itself", which was true
                  when the image's only consumers were `buildPostMetadata`'s
                  `openGraph.images` / `twitter.images` and the JSON-LD `image`. It now also
                  renders as a thumbnail on `/blog` and on the admin board, so the sentence
                  would have been a lie left in the UI.

                  Still NOT on `/blog/<slug>`: the post page renders no cover, and the wording
                  says "in the list" rather than "on the post" for that reason.
                */}
                <p className={`${helpTextCls} mt-2`}>
                  The share card on LinkedIn, DEV and Twitter, and the thumbnail in the post
                  list. The post page itself does not render it.
                </p>

                {uploading ? (
                  <p className={`${helpTextCls} mt-3`}>Uploading...</p>
                ) : /*
                    `isLikelyImageUrl` rather than a bare truthiness check. The field now
                    accepts typing, so it holds `h`, then `ht`, then `htt` on the way to a
                    real URL - and an `<img src='h'>` is a request to the current page that
                    fails and paints a broken-image icon on every keystroke.
                  */
                  isLikelyImageUrl(post.coverImage) ? (
                  <div className='mt-3 space-y-2'>
                    {/*
                      Framed at 1200x630 with `object-cover`, which is the OG card ratio - so
                      what is cropped out here is what will be cropped out there. `PostCard`
                      crops its thumbnail at the same ratio, so one approval covers both
                      surfaces; a preview showing the whole image at its own proportions would
                      be a preview of a framing nobody ever sees.

                      A plain `<img>`, matching `BasicsSection`: `next/image` wants known
                      dimensions and a layout slot, and this is a Cloudinary URL of unknown
                      size inside a resizable rail.
                    */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={post.coverImage ?? ''}
                      alt='Share card preview'
                      className='aspect-[1200/630] w-full rounded-[1.1rem] border border-pp-line bg-white/60 object-cover shadow-[0_14px_28px_rgba(46,35,28,0.08)]'
                    />
                    <p className='truncate text-xs text-pp-muted'>{post.coverImage}</p>
                    <button
                      type='button'
                      className={ghostBtnCls}
                      onClick={() => patch({ coverImage: null, coverCaption: '' })}
                    >
                      {/*
                        Clears the caption too. A credit line left behind after its picture is
                        gone would be attached to nothing, and would silently reappear under
                        the NEXT cover uploaded to this post - crediting the wrong photograph.
                      */}
                      Remove cover
                    </button>
                  </div>
                ) : (
                  <div className={`${emptyStateCls} mt-3`}>
                    {post.coverImage
                      ? 'Waiting for a complete http(s) URL before previewing.'
                      : 'No cover set. A post without one shares as a bare link rather than with a placeholder.'}
                  </div>
                )}
              </Section>

              <Section id='blog-markdown' eyebrow='Blog editor' title='Markdown' defaultOpen>
                <label className='sr-only' htmlFor='body'>
                  Markdown
                </label>
                <textarea
                  id='body'
                  className={`${inputCls} min-h-[32rem] font-mono text-[13px] leading-relaxed`}
                  value={post.bodyMarkdown}
                  onChange={event => patch({ bodyMarkdown: event.target.value })}
                />
              </Section>

              <div className='flex flex-wrap items-center gap-3 rounded-[1.4rem] border border-pp-line bg-white/72 px-4 py-3'>
                <span className='text-[11px] font-semibold uppercase tracking-[0.16em] text-pp-muted'>
                  Cross-post
                </span>
                {/*
                  Both bundles carry the availability footer in the TARGET's language. Without
                  it the one P0 conversion criterion exists only on /blog/<slug>, which is the
                  page almost nobody reads - the audience is on these two channels, which is
                  the whole reason for cross-posting at all.
                */}
                <button className={ghostBtnCls} onClick={() => void copyBundle('devto')}>
                  {copied === 'devto' ? 'Copied' : 'DEV.to (EN)'}
                </button>
                <button className={ghostBtnCls} onClick={() => void copyBundle('viblo')}>
                  {copied === 'viblo' ? 'Copied' : 'Viblo (VI)'}
                </button>
              </div>
            </div>

            <div className='relative lg:pl-2'>
              <RailResizeHandle
                width={railWidth}
                onResize={resizeRail}
                onReset={() => setRailWidth(DEFAULT_RAIL_WIDTH)}
                containerRef={layoutRef}
              />
              <div className='lg:sticky lg:top-6 lg:max-h-[calc(100vh-4rem)] lg:overflow-y-auto'>
                <p className={labelCls}>Preview</p>
                {/*
                  Rendered by the SAME function the save path uses, on the server. Not a
                  client-side approximation - this is the stored HTML, sanitized and
                  highlighted, so what is previewed is what publishes.

                  The empty branch is not decoration. An empty post and a preview that failed
                  to arrive rendered as the identical blank box, so the one state that says
                  "you have not written anything yet" was indistinguishable from the one that
                  says "the render did not come back" - and the second is worth knowing about
                  immediately, because it means what publishes is not what is on screen.
                */}
                {preview ? (
                  <div
                    className='blog-prose rounded-[1.75rem] border border-pp-line bg-white/72 p-5 shadow-panel backdrop-blur-md'
                    dangerouslySetInnerHTML={{ __html: preview }}
                  />
                ) : (
                  <div className='rounded-[1.75rem] border border-dashed border-pp-line bg-white/50 p-5'>
                    <p className={helpTextCls}>
                      {post.bodyMarkdown.trim()
                        ? 'Rendering...'
                        : 'Nothing to preview yet. What you type in Markdown renders here, through the same pipeline that publishes it.'}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </SectionOpenProvider>

        {/* Takes over the moment the toolbar's own button leaves the viewport - which on this
            page is almost immediately, and stays true for the entire time anyone is writing. */}
        <TaxonomyDialog
          resource='series'
          open={taxonomyDialog === 'series'}
          onClose={() => setTaxonomyDialog(null)}
          onChanged={() => void loadSeries()}
        />
        <TaxonomyDialog
          resource='kinds'
          open={taxonomyDialog === 'kinds'}
          onClose={() => setTaxonomyDialog(null)}
          onChanged={() => void loadKinds()}
        />

        <BlogSaveDock
          anchorRef={saveButtonRef}
          saving={saving}
          savedAt={savedAt}
          dirty={dirty}
          uploading={uploading}
          onSave={saveNow}
        />
      </div>
    </OwnerAuthGate>
  )
}
