'use client'

import { ImageOff } from 'lucide-react'
import React, {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from 'react'

import BlogSaveDock from '@/components/blog-admin/BlogSaveDock'
import GenerateBlogButton from '@/components/blog-admin/GenerateBlogButton'
import GenerateBlogDialog from '@/components/blog-admin/GenerateBlogDialog'
import ImagePromptField from '@/components/blog-admin/ImagePromptField'
import MissingImagesPanel from '@/components/blog-admin/MissingImagesPanel'
import TaxonomyDialog, {
  type TaxonomyResource,
} from '@/components/blog-admin/TaxonomyDialog'
import BlogToolbar from '@/components/blog-admin/BlogToolbar'
import OwnerAuthGate from '@/components/settings/OwnerAuthGate'
import RailResizeHandle from '@/components/settings/RailResizeHandle'
import SelectField, {
  type SelectOption,
} from '@/components/settings/SelectField'
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
import {
  MAX_RAIL_WIDTH,
  MIN_RAIL_WIDTH,
} from '@/components/settings/useRailWidth'
import {
  IMAGE_MODEL_SELECT_OPTIONS,
  presetSpecFromPost,
} from '@/lib/blog/generation-fields'
import {
  countBodyImages,
  findImagePlaceholders,
  replacePlaceholder,
} from '@/lib/blog/image-placeholders'

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
 *   │  Save now / dock - text waits, images   │  refreshed with it   │
 *   │  and status commit on click             │                      │
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
 * ## Save is manual for text; the preview is not; images are not
 *
 * These two used to share one debounce, back when there was an autosave to share it with.
 * Save is manual for TEXT now - no PATCH happens because the author paused typing - but the
 * preview kept its own 1.2s-debounced timer, firing on every edit to `bodyMarkdown` regardless
 * of whether anything is ever saved. A split-pane editor whose right pane goes stale until a
 * deliberate click is a worse product than the save behaviour is worth; "what you see is what
 * publishes" has to be true while typing, not just after Save.
 *
 * Three controls commit on click rather than staging for later, and each has its own header
 * saying why: `applyStatus` (Publish and Archive - a button labelled with a verb has to do the
 * verb), `regenerateImagePrompt` (the route reads the STORED body, so it pre-flushes), and
 * `commitImage` (an uploaded or generated image is an asset that already exists and costs
 * money to make again - losing it is not the same as losing a retypable paragraph). Everything
 * else goes through `patch` and waits for the button.
 *
 * `flush` still re-fetches the preview once after a successful save, which is close to
 * redundant now - the debounced timer has usually already caught up - but cheap, and it is the
 * thing that resyncs the pane if a keystroke landed exactly inside the debounce window.
 *
 * `BLOG_SAVE_LIMIT` gates PATCH; the preview endpoint has no rate limit of its own (see its own
 * file) because it is read-only and owner-gated - the debounce here is about not paying Shiki
 * on every keystroke, not about a backend guard.
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
  coverImagePrompt: string
  imagePrompts: { key: string; prompt: string }[]
  tags: string[]
  relatedSlugs: string[]
  language: 'vi' | 'en'
  status: 'draft' | 'published' | 'archived' | 'deleted'
  publishedAt: string | null
}

/**
 * What `patch` and `commitImage` accept.
 *
 * The function form is for callers that compute the new value FROM the old one after an await -
 * `commitPlaceholder` rewrites a placeholder out of a body the author has gone on typing into,
 * and the object form built from a stale closure would drop every keystroke typed during the
 * upload. See `patch`'s own header.
 */
type PostPatch =
  Partial<EditorPost> | ((current: EditorPost) => Partial<EditorPost>)

/**
 * How long the markdown pane waits after a keystroke before re-rendering the preview.
 *
 * Not 300ms: every call pays Shiki server-side, on an endpoint with no rate limit of its own
 * (see `api/admin/blog/preview/route.ts`) because it is trusted to the owner gate instead. 1.2s
 * is the same figure the old combined autosave-and-preview debounce used, for the same reason -
 * it is long enough that a fast typist's pause reads as "done with this thought" rather than
 * "between two keystrokes", and short enough that the pane never feels like it is ignoring you.
 */
const PREVIEW_DEBOUNCE_MS = 1200

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
  /** Bumped by `commitImage` to mean "save what is on screen now"; see the effect it drives. */
  const [commitRequests, setCommitRequests] = useState(0)
  const [uploading, setUploading] = useState(false)
  /** The chosen model for "Generate image". Empty until picked - Generate stays disabled until then. */
  const [imageModel, setImageModel] = useState('')
  /**
   * A generation failure (`GOOGLE_API_KEY is not set`, a model rejecting the prompt, ...),
   * kept apart from `error`. `error` renders in the page-top banner, which is the right place
   * for "the post failed to load" or "the save failed" - but a generation failure is scoped to
   * the model picker the author is looking at, not the whole page, and the top banner put it
   * a full scroll away from the button that caused it.
   *
   * `imageGenErrorSource` says which picker: `'cover'` or a placeholder's key. Without it, a
   * cover-image failure would render under every placeholder card too (and vice versa) - the
   * state is shared because only one generation call is ever in flight, but the error still
   * belongs to a single row on screen.
   */
  const [imageGenError, setImageGenError] = useState<string | null>(null)
  const [imageGenErrorSource, setImageGenErrorSource] = useState<string | null>(
    null
  )
  /** Whether a cover-image generation call is in flight. */
  const [generatingImage, setGeneratingImage] = useState(false)
  /** Which placeholder has an image generation call in flight. Separate from `generatingImage`, which is the cover's. */
  const [generatingImageKey, setGeneratingImageKey] = useState<string | null>(
    null
  )
  /** Which image prompt has a rewrite in flight: a placeholder key, or `cover`. */
  const [promptBusy, setPromptBusy] = useState<string | null>(null)
  /** Which placeholder has a file upload in flight. Separate from `uploading`, which is the cover's. */
  const [imageUploading, setImageUploading] = useState<string | null>(null)
  /** Whether the regeneration dialog is up. The dialog is mounted only while this is true. */
  const [regenerating, setRegenerating] = useState(false)
  /**
   * Whether an edit has been made that the server has not acknowledged yet.
   *
   * Save is manual, so this is the only thing standing between the toolbar and "No changes
   * yet" while a whole paragraph sits typed and unsaved. `saving` and `savedAt` alone cannot
   * tell that story: neither is true the instant after a keystroke and before Save is clicked,
   * which is exactly the state an editor must never describe as nothing pending.
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
  const [taxonomyDialog, setTaxonomyDialog] = useState<TaxonomyResource | null>(
    null
  )
  const [fullWidth, setFullWidth] = useState(readStoredFullWidth)
  const [railWidth, setRailWidth] = useState(readStoredRailWidth)

  const layoutRef = useRef<HTMLDivElement | null>(null)
  const saveButtonRef = useRef<HTMLButtonElement | null>(null)
  /** The pending debounced preview re-render, if a keystroke is still waiting one out. */
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Cancels a pending preview render on unmount, so a `setPreview` never fires after this
  // component is gone - the confirm-leave guards make that a narrow window, not a closed one.
  useEffect(() => {
    return () => {
      if (previewTimer.current) clearTimeout(previewTimer.current)
    }
  }, [])

  /**
   * The browser's own "leave site?" prompt, gated on `dirty`.
   *
   * Save being manual means a closed tab is the one exit this editor cannot recover from - the
   * toolbar and the dock can say "Unsaved changes" all they like, but neither does anything if
   * the page is already gone. `beforeunload` is the one hook that can still stop that, and only
   * `preventDefault` plus setting `returnValue` reaches it in every engine; every modern browser
   * ignores whatever string is assigned and shows its own fixed wording anyway, which is a
   * deliberate anti-annoyance measure on their end, not a bug on this one.
   *
   * Registered unconditionally, gated on `dirty` inside the handler: `dirty` flips on every
   * keystroke, and re-subscribing an event listener that often is wasted work a plain closure
   * check avoids.
   */
  useEffect(() => {
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      if (!dirty) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [dirty])

  useEffect(() => {
    try {
      window.localStorage.setItem(
        FULL_WIDTH_STORAGE_KEY,
        JSON.stringify(fullWidth)
      )
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
        ? Math.min(
            MAX_RAIL_WIDTH,
            Math.max(MIN_RAIL_WIDTH, containerWidth - MIN_EDITOR_WIDTH)
          )
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
      setError(
        cause instanceof Error ? cause.message : 'Could not load the post'
      )
    }
  }, [id])

  const loadSeries = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/blog/series', { cache: 'no-store' })
      if (!res.ok) return
      const data = (await res.json()) as {
        series?: { slug: string; title: string }[]
      }
      setSeriesOptions([
        { value: '', label: 'none' },
        ...(data.series ?? []).map(item => ({
          value: item.slug,
          label: item.title,
        })),
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
      const data = (await res.json()) as {
        kinds?: { slug: string; label: string }[]
      }
      setKindOptions(
        (data.kinds ?? []).map(item => ({
          value: item.slug,
          label: item.label,
        }))
      )
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

  /** Render markdown through the same pipeline the save path uses, without saving anything. */
  const refreshPreview = useCallback(async (markdown: string, slug: string) => {
    const res = await fetch('/api/admin/blog/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ markdown, slug }),
    })
    if (res.ok) setPreview(((await res.json()) as { html?: string }).html ?? '')
  }, [])

  /**
   * Save, then resync the preview from what was just saved. Order matters - see the header.
   *
   * Returns whether the save landed. It used to return nothing while swallowing its own error
   * into the banner, which meant no caller could tell - so `regenerateImagePrompt` would go on
   * to ask the server for a prompt against a body that had just failed to save, and the 409 it
   * got back ("that placeholder is no longer in the post body") overwrote the real message. The
   * author was told a placeholder had vanished and never learned the save had failed.
   */
  const flush = useCallback(
    async (next: EditorPost): Promise<boolean> => {
      // Whatever the debounce below was about to fetch, this is about to fetch too, from
      // definitely-current text - so the pending one is now wasted work, not a second answer.
      if (previewTimer.current) {
        clearTimeout(previewTimer.current)
        previewTimer.current = null
      }
      setSaving(true)
      setError(null)
      try {
        const res = await fetch(`/api/admin/blog/${id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            /*
              `status` is in this body, and its absence was a real bug rather than a deliberate
              omission. Publish and Archive commit through `applyStatus` now, which is what
              actually fixed the button - but this field is what makes that possible, and it is
              also what stops a plain Save from silently reverting a transition that happened
              while the editor was open.

              Safe to send unconditionally because the route ignores a status equal to the
              current one and refuses the two transitions that must not happen here
              (`archived -> draft`, and `deleted` at all, which is DELETE's job).
            */
            status: next.status,
            slug: next.slug,
            title: next.title,
            excerpt: next.excerpt,
            kind: next.kind,
            series: next.series,
            isPillar: next.isPillar,
            bodyMarkdown: next.bodyMarkdown,
            coverImage: next.coverImage,
            coverCaption: next.coverCaption,
            coverImagePrompt: next.coverImagePrompt,
            imagePrompts: next.imagePrompts,
            tags: next.tags,
            relatedSlugs: next.relatedSlugs,
            language: next.language,
          }),
        })
        const data = (await res.json()) as { error?: string }
        if (!res.ok) throw new Error(data.error ?? 'Save failed')
        setSavedAt(new Date())
        setDirty(false)

        await refreshPreview(next.bodyMarkdown, next.slug)
        return true
      } catch (cause) {
        // Surfaced, never swallowed. A silent save failure is how an hour of writing is lost -
        // the author clicked Save, believes it worked, and has no reason to suspect anything
        // until they reload.
        setError(cause instanceof Error ? cause.message : 'Save failed')
        return false
      } finally {
        setSaving(false)
      }
    },
    [id, refreshPreview]
  )

  /**
   * Update the in-memory post. Nothing is written to the server by this - a change to the body
   * only schedules a debounced preview render, because the preview is not "what was saved", it
   * is "what is on screen right now". The three controls that DO write on the spot
   * (`applyStatus`, `regenerateImagePrompt`, `commitImage`) each say why in their own header.
   *
   * `changes` may be a function of the current post, for the callers that compute the new value
   * FROM the old one after an await - `commitPlaceholder` rewrites a placeholder out of a body
   * the author has gone on typing into. Passing the object form from a stale closure there would
   * drop every keystroke typed during the upload.
   */
  function patch(changes: PostPatch) {
    setPost(current => {
      if (!current) return current
      const applied = typeof changes === 'function' ? changes(current) : changes
      const next = { ...current, ...applied }

      if (applied.bodyMarkdown !== undefined) {
        if (previewTimer.current) clearTimeout(previewTimer.current)
        previewTimer.current = setTimeout(
          () => void refreshPreview(next.bodyMarkdown, next.slug),
          PREVIEW_DEBOUNCE_MS
        )
      }

      return next
    })
    setDirty(true)
  }

  /** The only path to the server: `flush` on the post as it stands right now. */
  const saveNow = useCallback(() => {
    if (!post) return
    void flush(post)
  }, [post, flush])

  /**
   * Publish / Archive - a transition that happens NOW, not one that is staged for later.
   *
   * ## Why these do not go through `patch`
   *
   * They used to, and `patch` only writes to local state: "Nothing is written to the server
   * until Save is clicked". So pressing Publish repainted the badge to PUBLISHED, flipped the
   * editor to dirty, and saved nothing. The author had done the thing the button is named
   * after, could see it had worked, and the post was still archived - until they happened to
   * press Save as well, or navigated away and lost it.
   *
   * Every other mutating control in this product commits on click: the board's Publish PATCHes
   * directly, Delete PATCHes directly. A button labelled with a verb has to do the verb.
   *
   * ## Why it flushes the WHOLE post rather than just the status
   *
   * Publishing with unsaved edits in the textarea and having them not go live is the same
   * surprise one level down - the author pressed Publish, the page is public, and it is public
   * with yesterday's text. `flush` already sends every field, so publishing saves the pending
   * work with it, which is what "make this live" means.
   *
   * ## Why the local state is rolled back on failure
   *
   * The optimistic update is what makes the badge feel instant, but a PATCH can legitimately
   * refuse - `archived -> draft` on a post that was once public is a 409 by design. Leaving the
   * badge on the state the server rejected would be the original bug wearing a different hat:
   * the screen claiming something the database does not agree with.
   */
  const applyStatus = useCallback(
    async (status: EditorPost['status']) => {
      if (!post || post.status === status) return

      const previous = post
      const next = { ...post, status }
      setPost(next)

      if (!(await flush(next))) {
        // `flush` has already put the reason in the banner. Put the badge back so the toolbar
        // is not showing a state the save was refused.
        setPost(previous)
        setDirty(true)
      }
    },
    [post, flush]
  )

  /**
   * Put an image into the post and write it to the server in the same action.
   *
   * ## Why this does not wait for Save, when the rest of the editor does
   *
   * Save is manual here and stays manual for text: an author who types a paragraph and closes
   * the tab loses a paragraph they can type again. An image is not that. By the time this runs
   * the asset already EXISTS - an upload is sitting in Cloudinary, a generation has already
   * cost a model call - and the only record of where it lives is a URL in React state. Close
   * the tab and the file is still up there, orphaned and unreachable, and the picture has to be
   * paid for a second time. That is not a retypable loss, so it does not get retypable
   * treatment.
   *
   * It is worse for a body placeholder than for the cover. `replacePlaceholder` rewrites
   * `![alt](imageN)` out of the markdown, and the card in `MissingImagesPanel` is derived from
   * the body - so the card vanishes the instant the URL lands. The screen stops showing any
   * sign that something is pending at exactly the moment the author stops thinking about Save.
   *
   * Pasting a URL by hand is deliberately NOT routed here; see `resolvePlaceholder`.
   *
   * ## Why it signals rather than calling `flush` itself
   *
   * `flush` takes the post to write, and the obvious shape - `const next = { ...post, ...changes }`
   * then `flush(next)`, which is what `applyStatus` does - is wrong for these four callers in a
   * way it is not wrong for a button click. Every one of them awaits something slow first (a
   * Cloudinary upload, a model drawing a picture), and the author keeps typing throughout. By
   * the time the URL arrives, `post` in the closure is the snapshot from before the upload
   * started, so writing it would silently wipe every keystroke typed during the wait. Two
   * uploads finishing together would do worse: the second would write a post that never had the
   * first one's image.
   *
   * So this goes through `patch`, whose update is functional and therefore merges, and then
   * bumps a counter that an effect below turns into one `flush` of whatever the committed state
   * actually is. Two concurrent uploads produce two saves of a post containing both, instead of
   * one save that loses one of them.
   */
  function commitImage(changes: PostPatch) {
    patch(changes)
    setCommitRequests(count => count + 1)
  }

  /** `resolvePlaceholder`, committed - the generate and upload paths, not the paste one. */
  function commitPlaceholder(key: string, url: string) {
    commitImage(current => ({
      bodyMarkdown: replacePlaceholder(current.bodyMarkdown, key, url),
    }))
  }

  /**
   * Saves whatever is on screen when `commitRequests` moves.
   *
   * An effect rather than a call inside `commitImage` because that is what makes it race-free:
   * the effect runs after React has committed the `patch`, so `post` here is the merged result,
   * not the pre-patch value the caller was holding. `useEffectEvent` keeps `post` and `flush`
   * out of the dependency array, so the save fires on the signal and never on a keystroke.
   *
   * A failure leaves `dirty` set with the reason in the banner, and the URL is still on screen -
   * so the Save button is the retry. Nothing is rolled back, unlike `applyStatus`, which rolls
   * back because the server can legitimately REFUSE a transition. There is no refusable image
   * URL: a failed save here means the request did not land, not that the picture was rejected.
   */
  const commitLatest = useEffectEvent(() => {
    if (post) void flush(post)
  })

  // Deferred to a macrotask, same as the bootstrap and the initial preview above and for the
  // same reason: `flush` opens with `setSaving(true)`, and a setState in an effect body
  // cascades a second render before paint.
  useEffect(() => {
    if (commitRequests === 0) return
    const timer = window.setTimeout(() => commitLatest(), 0)
    return () => window.clearTimeout(timer)
  }, [commitRequests])

  const renderInitialPreview = useEffectEvent((current: EditorPost) => {
    void refreshPreview(current.bodyMarkdown, current.slug)
  })

  // Render the preview once on load, so opening an existing post does not show a blank pane
  // until the first keystroke. Same macrotask defer as the bootstrap above.
  useEffect(() => {
    if (!post || preview) return
    const timer = window.setTimeout(() => renderInitialPreview(post), 0)
    return () => window.clearTimeout(timer)
  }, [post, preview])

  /**
   * Ask the server to write a new prompt, for the cover or for one placeholder.
   *
   * Flushes first, on purpose. The route reads the post from the database - the body, and the
   * paragraph around the placeholder - and save is manual now, so whatever is typed since the
   * last click of Save otherwise never reaches it. For a placeholder typed by hand a moment
   * ago, an unsaved key is not in the SAVED body yet and the route refuses it with a 409 that
   * would read as a bug.
   *
   * The response is merged with `setPost` rather than `patch`, because the route already saved
   * the prompt to the document `flush` just wrote. Routing it through `patch` instead would
   * only mark the editor dirty again over a field the server already has.
   */
  async function regenerateImagePrompt(key: string | null) {
    if (!post) return

    const slot = key ?? 'cover'
    setPromptBusy(slot)
    setError(null)
    try {
      // Bail if the pre-save did not land. The route reads the STORED body, so continuing here
      // asks for a prompt against text the server never received - and for a placeholder the
      // author has just typed that is a 409 ("no longer in the post body") which overwrites the
      // real "Save failed" message in the banner. The author would be told a placeholder had
      // vanished and never learn their save had failed.
      if (!(await flush(post))) return

      const res = await fetch(`/api/admin/blog/${id}/image-prompt`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          key ? { target: 'body', key } : { target: 'cover' }
        ),
      })
      const data = (await res.json()) as { prompt?: string; error?: string }
      if (!res.ok || !data.prompt)
        throw new Error(data.error ?? 'Could not write a prompt')

      const prompt = data.prompt
      setPost(current => {
        if (!current) return current
        if (!key) return { ...current, coverImagePrompt: prompt }

        const existing = current.imagePrompts.some(entry => entry.key === key)
        return {
          ...current,
          imagePrompts: existing
            ? current.imagePrompts.map(entry =>
                entry.key === key ? { key, prompt } : entry
              )
            : [...current.imagePrompts, { key, prompt }],
        }
      })
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not write a prompt'
      )
    } finally {
      setPromptBusy(null)
    }
  }

  /** Edit a stored prompt by hand. Goes through `patch`, so it saves on the next Save click like anything else. */
  function setImagePrompt(key: string, prompt: string) {
    if (!post) return
    const existing = post.imagePrompts.some(entry => entry.key === key)
    patch({
      imagePrompts: existing
        ? post.imagePrompts.map(entry =>
            entry.key === key ? { key, prompt } : entry
          )
        : [...post.imagePrompts, { key, prompt }],
    })
  }

  /**
   * Put a hand-pasted URL where a placeholder was. Local until Save, like any other edit.
   *
   * This is the paste field in `MissingImagesPanel`, and it is the one image path that does
   * NOT go through `commitImage`. Pasting creates nothing: the asset was already somewhere
   * before it was pasted, so a lost paste costs a paste, not a Cloudinary orphan and not
   * another model call. And the field it comes from is a text input, where the next keystroke
   * is as likely to be a correction as a commit - saving on every accepted paste would write
   * a wrong URL to the server as eagerly as a right one.
   *
   * The prompt is deliberately LEFT in `imagePrompts` afterwards rather than pruned. The card
   * disappears either way - it is derived from the body - but the body is a textarea, so the
   * most likely next action after a wrong URL is ctrl-Z. Keeping the prompt means the undo
   * brings the card back complete; pruning would bring back an empty one and cost another
   * model call to refill. Orphans are capped at twelve by the schema and swept at generation.
   */
  function resolvePlaceholder(key: string, url: string) {
    patch(current => ({
      bodyMarkdown: replacePlaceholder(current.bodyMarkdown, key, url),
    }))
  }

  async function uploadPlaceholderImage(key: string, file: File) {
    setImageUploading(key)
    setError(null)
    try {
      const url = await uploadAssetToCloudinary(file, 'post')
      commitPlaceholder(key, url)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Upload failed')
    } finally {
      setImageUploading(null)
    }
  }

  async function uploadCover(file: File) {
    setUploading(true)
    setError(null)
    try {
      // `post` kind: the only upload kind with a MIME allowlist, because what it produces
      // lands in markdown and the pipeline trusts that host unconditionally.
      const url = await uploadAssetToCloudinary(file, 'post')
      commitImage({ coverImage: url })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  /**
   * Draw the cover from the prompt above it, then treat the result exactly like an upload:
   * straight through `commitImage`, which writes it to the server without waiting for Save.
   *
   * The prompt travels in the request body rather than being re-read from the database - see
   * the route's own header for why that differs from `regenerateImagePrompt`, which flushes
   * first because it reads the post's saved BODY to write a new prompt. This one only reads a
   * prompt that already exists on screen, so there is nothing to flush.
   */
  async function generateCoverImage() {
    if (!post || !imageModel) return

    setGeneratingImage(true)
    setImageGenError(null)
    setImageGenErrorSource(null)
    try {
      const res = await fetch(`/api/admin/blog/${id}/generate-image`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: imageModel,
          prompt: post.coverImagePrompt,
        }),
      })
      const data = (await res.json()) as { url?: string; error?: string }
      if (!res.ok || !data.url)
        throw new Error(data.error ?? 'Could not generate an image')

      commitImage({ coverImage: data.url })
    } catch (cause) {
      setImageGenError(
        cause instanceof Error ? cause.message : 'Could not generate an image'
      )
      setImageGenErrorSource('cover')
    } finally {
      setGeneratingImage(false)
    }
  }

  /**
   * Draw a body placeholder's image, then resolve it exactly like an upload: `commitPlaceholder`
   * rewrites `![image](imageN)` to the real URL and saves, and the card disappears with it - see
   * `resolvePlaceholder`'s own header for why the prompt is left in `imagePrompts` regardless.
   *
   * Reads the prompt from `post.imagePrompts` rather than accepting one as an argument, same
   * reasoning as `generateCoverImage`: it is what is on screen right now, unsaved edits
   * included, and the caller (`MissingImagesPanel`) already identifies the card by key alone.
   */
  async function generatePlaceholderImage(key: string) {
    if (!post || !imageModel) return

    const prompt =
      post.imagePrompts.find(entry => entry.key === key)?.prompt ?? ''

    setGeneratingImageKey(key)
    setImageGenError(null)
    setImageGenErrorSource(null)
    try {
      const res = await fetch(`/api/admin/blog/${id}/generate-image`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: imageModel, prompt }),
      })
      const data = (await res.json()) as { url?: string; error?: string }
      if (!res.ok || !data.url)
        throw new Error(data.error ?? 'Could not generate an image')

      commitPlaceholder(key, data.url)
    } catch (cause) {
      setImageGenError(
        cause instanceof Error ? cause.message : 'Could not generate an image'
      )
      setImageGenErrorSource(key)
    } finally {
      setGeneratingImageKey(null)
    }
  }

  if (!post)
    return (
      <OwnerAuthGate onAuthed={() => void load()}>
        <SettingLoading
          title="Loading post..."
          subtitle="Opening the editor."
        />
      </OwnerAuthGate>
    )

  const isPublished = post.publishedAt !== null

  /**
   * The placeholders still in the body, derived every render rather than held in state.
   *
   * It is a regex over a string the author is typing into, so the cost is real but small, and
   * the alternative is worse in a way that shows: a `useState` list would need an effect to
   * follow `bodyMarkdown`, which means one render where the cards on screen disagree with the
   * text above them. Deleting a placeholder should remove its card in the same frame.
   */
  const missingImages = findImagePlaceholders(post.bodyMarkdown)

  /**
   * The fetched options, plus this post's own series if it is not among them.
   *
   * Two cases produce that, and both would otherwise render as `none`: the fetch has not
   * landed yet, and the series was deleted from under a post that still references it. A
   * select showing `none` for a post that HAS a series is a lie the author would fix by
   * re-picking - and on the second case there is nothing to re-pick, so the honest thing is
   * to keep showing the orphaned value and say what it is.
   */
  const seriesChoices: SelectOption[] = seriesOptions.some(
    o => o.value === (post.series ?? '')
  )
    ? seriesOptions
    : [
        ...seriesOptions,
        { value: post.series ?? '', label: `${post.series} (deleted)` },
      ]

  /** Same splice as `seriesChoices`, and it matters more: a kind cannot be cleared to none. */
  const kindChoices: SelectOption[] = kindOptions.some(
    o => o.value === post.kind
  )
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
          onPublish={() => void applyStatus('published')}
          onArchive={() => void applyStatus('archived')}
        />

        <SettingErrorBanner message={error} />

        <SectionOpenProvider>
          {/* The rail track is a variable so `RailResizeHandle` can drive it without this
              layout being rebuilt on every pointer move, and so the single-column stack
              below `xl` stays a plain Tailwind class rather than an inline override. */}
          <div
            ref={layoutRef}
            className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,var(--rail-width))] lg:gap-8"
            style={{ '--rail-width': `${railWidth}px` } as React.CSSProperties}
          >
            <div className="space-y-5">
              <Section
                id="blog-post"
                eyebrow="Blog editor"
                title="Post"
                defaultOpen
              >
                <div className="space-y-4">
                  <div>
                    <label
                      className={labelCls}
                      htmlFor="title"
                    >
                      Title
                    </label>
                    <input
                      id="title"
                      className={inputCls}
                      value={post.title}
                      onChange={event => patch({ title: event.target.value })}
                    />
                  </div>

                  {isPublished ? (
                    <p className={helpTextCls}>
                      Slug is <code>{post.slug}</code> and is now frozen. This
                      URL has been public, so renaming it would 404 every
                      inbound link and feed entry pointing at it.
                    </p>
                  ) : (
                    <div>
                      <label
                        className={labelCls}
                        htmlFor="slug"
                      >
                        Slug
                      </label>
                      <input
                        id="slug"
                        className={inputCls}
                        value={post.slug}
                        onChange={event => patch({ slug: event.target.value })}
                      />
                    </div>
                  )}

                  <div>
                    <label
                      className={labelCls}
                      htmlFor="excerpt"
                    >
                      Excerpt
                    </label>
                    <input
                      id="excerpt"
                      className={inputCls}
                      value={post.excerpt}
                      onChange={event => patch({ excerpt: event.target.value })}
                      placeholder="Optional for a note. Used as the meta description, cut at 155."
                    />
                  </div>
                </div>
              </Section>

              <Section
                id="blog-classification"
                eyebrow="Blog editor"
                title="Classification"
              >
                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <div className="mb-1.5 flex items-baseline justify-between gap-2">
                        <label
                          className={`${labelCls} mb-0`}
                          htmlFor="kind"
                        >
                          Kind
                        </label>
                        <button
                          type="button"
                          className="text-[11px] font-semibold uppercase tracking-[0.14em] text-pp-blue transition hover:underline"
                          onClick={() => setTaxonomyDialog('kinds')}
                        >
                          Manage
                        </button>
                      </div>
                      <SelectField
                        id="kind"
                        value={post.kind}
                        options={kindChoices}
                        onChange={next => patch({ kind: next })}
                      />
                    </div>
                    <div>
                      <div className="mb-1.5 flex items-baseline justify-between gap-2">
                        <label
                          className={`${labelCls} mb-0`}
                          htmlFor="series"
                        >
                          Series
                        </label>
                        <button
                          type="button"
                          className="text-[11px] font-semibold uppercase tracking-[0.14em] text-pp-blue transition hover:underline"
                          onClick={() => setTaxonomyDialog('series')}
                        >
                          Manage
                        </button>
                      </div>
                      {/* `''` is the wire value for "no series"; the model stores `null`. The
                          empty string exists only so the option has a value at all. */}
                      <SelectField
                        id="series"
                        value={post.series ?? ''}
                        options={seriesChoices}
                        onChange={next => patch({ series: next || null })}
                      />
                    </div>
                  </div>

                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={post.isPillar}
                      onChange={event =>
                        patch({ isPillar: event.target.checked })
                      }
                    />
                    Pillar post for this series
                    <span className="text-xs text-pp-muted">
                      (at most one per series)
                    </span>
                  </label>

                  <div>
                    <label
                      className={labelCls}
                      htmlFor="tags"
                    >
                      Tags
                    </label>
                    <input
                      id="tags"
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
                      placeholder="nextjs, caching"
                    />
                  </div>

                  <div>
                    <label
                      className={labelCls}
                      htmlFor="related"
                    >
                      Related slugs
                    </label>
                    <input
                      id="related"
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
                      placeholder="Resolved on read - unpublished ones simply render no link."
                    />
                  </div>
                </div>
              </Section>

              <Section
                id="blog-cover"
                eyebrow="Blog editor"
                title="Cover image"
              >
                <label
                  className={labelCls}
                  htmlFor="cover"
                >
                  Upload
                </label>
                <input
                  id="cover"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
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

                  `onChange`, not `onBlur`: `patch` is a local state update with no network
                  call of its own, so per-keystroke costs nothing and the share-card preview
                  below tracks a pasted URL as it is typed, well before Save is ever clicked.
                */}
                <div className="mt-3">
                  <label
                    className={labelCls}
                    htmlFor="cover-url"
                  >
                    Image URL
                  </label>
                  <input
                    id="cover-url"
                    className={inputCls}
                    value={post.coverImage ?? ''}
                    placeholder="https://... or upload a file above"
                    onChange={event =>
                      patch({ coverImage: event.target.value.trim() || null })
                    }
                  />
                </div>

                {/*
                  Below the URL, and only once there is a post to describe.

                  Hidden on an empty body rather than shown disabled, for the same reason the
                  slug field disappears after publishing: a prompt is written FROM the post, so
                  on a blank one the rewrite button has nothing to read and the field would be
                  an input whose only honest state is "not yet". The condition is the body
                  rather than the title, because a title alone produces a prompt about a
                  sentence.

                  It stays visible after a cover has been set. The prompt is what produced the
                  picture, and the most common reason to want it again is that the first
                  attempt was not good enough.
                */}
                {post.bodyMarkdown.trim() ? (
                  <div className="mt-3">
                    <ImagePromptField
                      id="cover-image-prompt"
                      label="Image prompt"
                      prompt={post.coverImagePrompt}
                      busy={promptBusy === 'cover'}
                      help="Copy this into an image tool, then paste the result into the URL field above. Nothing here is ever published."
                      onChange={value => patch({ coverImagePrompt: value })}
                      onRegenerate={() => void regenerateImagePrompt(null)}
                    />

                    {/*
                      Left-aligned, directly under the prompt's own copy/rewrite row - unlike
                      those two, which sit right-aligned above. The model has no default on
                      purpose (`IMAGE_MODEL_SELECT_OPTIONS` opens on the empty "Choose a
                      model..." row), so Generate stays disabled until one is actually picked.
                    */}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <SelectField
                        id="cover-image-model"
                        ariaLabel="Image generation model"
                        value={imageModel}
                        options={IMAGE_MODEL_SELECT_OPTIONS}
                        onChange={setImageModel}
                        className="min-w-[14rem] flex-1"
                      />
                      <GenerateBlogButton
                        label={
                          generatingImage ? 'Generating...' : 'Generate image'
                        }
                        onClick={() => void generateCoverImage()}
                        disabled={!imageModel || generatingImage}
                      />
                    </div>
                    {imageGenError && imageGenErrorSource === 'cover' ? (
                      /*
                        `span`, not `p`: `.portfolio-public-root p { color: var(--pp-muted) }`
                        in globals.css is a (0,1,1) selector, which beats the (0,1,0) utility
                        class below on source order - a `<p>` here renders muted grey no matter
                        what text colour utility it carries. See `.blog-prose p`'s own comment
                        in globals.css for the same landmine hit and fixed once already.
                      */
                      <span className="mt-2 block text-xs font-medium text-pp-ink-rose">
                        {imageGenError}
                      </span>
                    ) : null}
                  </div>
                ) : null}

                {/*
                  Under the preview rather than beside the URL, because that is where it
                  lands on the card: the field's position in the form mirrors the position of
                  what it produces.

                  Only shown when there is a cover. A caption field on a post with no image is
                  a field for text that has nothing to caption.
                */}
                {post.coverImage ? (
                  <div className="mt-3">
                    <label
                      className={labelCls}
                      htmlFor="cover-caption"
                    >
                      Caption
                    </label>
                    <input
                      id="cover-caption"
                      className={inputCls}
                      value={post.coverCaption}
                      maxLength={140}
                      placeholder="Credit or context, e.g. Photo: Anh Khoa Nguyen"
                      onChange={event =>
                        patch({ coverCaption: event.target.value })
                      }
                    />
                    <p className={`${helpTextCls} mt-1`}>
                      Printed under the thumbnail in the post list. Leave empty
                      and the image is treated as decoration.
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
                  The share card on LinkedIn, DEV and Twitter, and the thumbnail
                  in the post list. The post page itself does not render it.
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
                  <div className="mt-3 space-y-2">
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
                      alt="Share card preview"
                      className="aspect-[1200/630] w-full rounded-[1.1rem] border border-pp-line bg-white/60 object-cover shadow-[0_14px_28px_rgba(46,35,28,0.08)]"
                    />
                    <p className="truncate text-xs text-pp-muted">
                      {post.coverImage}
                    </p>
                    <button
                      type="button"
                      className={ghostBtnCls}
                      onClick={() =>
                        patch({ coverImage: null, coverCaption: '' })
                      }
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

              <Section
                id="blog-markdown"
                eyebrow="Blog editor"
                title="Markdown"
                defaultOpen
              >
                {/*
                  Above the textarea, because the consequence of missing it lands on readers.

                  `rehypeRestrictImageHosts` refuses every `src` that is not a real Cloudinary
                  URL by deleting the ATTRIBUTE and keeping the node, so `![image](image1)`
                  publishes as `<img alt="image">` - measured, not assumed: the preview endpoint
                  returns exactly `<p><img alt="a chart"></p>` for it. Every browser paints that
                  as a broken-image icon.

                  So the failure is visible damage on the live post rather than a quiet
                  omission, and it is also the kind that is easy to scroll past in the preview
                  rail: a sourceless img fetches nothing, so there is no console error and no
                  network entry either. A banner on the surface being typed into is the only
                  place it cannot be missed.
                */}
                {/*
                  At the top of the Markdown card rather than up in the toolbar beside Publish.

                  It replaces the post's whole body, so it belongs adjacent to the body - the
                  author decides this is the wrong post while reading the wrong post, and a
                  destructive control sitting next to the thing it destroys is one a misclick
                  cannot confuse with a different class of action. In the toolbar it would be
                  one button along from Publish, where the two worst possible mistakes on this
                  page would be neighbours.
                */}
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <p className={`${helpTextCls} max-w-[46ch]`}>
                    Not what you meant? Regenerate opens the same dialog the
                    board uses, with this post&apos;s own properties already
                    filled in.
                  </p>
                  <GenerateBlogButton
                    label="Regenerate post"
                    onClick={() => setRegenerating(true)}
                    disabled={saving}
                  />
                </div>

                {missingImages.length > 0 ? (
                  <div className="mb-3 flex gap-2.5 rounded-[1.15rem] border border-[rgba(163,120,47,0.22)] bg-[rgba(224,176,92,0.13)] px-3.5 py-2.5 text-sm text-[#6b4d1c]">
                    <ImageOff
                      aria-hidden
                      size={16}
                      className="mt-0.5 shrink-0"
                    />
                    <span>
                      <strong className="font-semibold">
                        {missingImages.length} image
                        {missingImages.length === 1 ? '' : 's'} still missing.
                      </strong>{' '}
                      {missingImages.map(item => item.key).join(', ')}{' '}
                      {missingImages.length === 1
                        ? 'is a placeholder'
                        : 'are placeholders'}
                      . Published as{' '}
                      {missingImages.length === 1 ? 'it is' : 'they are'},{' '}
                      {missingImages.length === 1 ? 'it shows' : 'they show'} a
                      reader a broken image with the alt text beside it. The
                      prompts below the editor are for making them.
                    </span>
                  </div>
                ) : null}

                <label
                  className="sr-only"
                  htmlFor="body"
                >
                  Markdown
                </label>
                <textarea
                  id="body"
                  className={`${inputCls} min-h-[32rem] font-mono text-[13px] leading-relaxed`}
                  value={post.bodyMarkdown}
                  onChange={event =>
                    patch({ bodyMarkdown: event.target.value })
                  }
                />

                <MissingImagesPanel
                  placeholders={missingImages}
                  promptFor={key =>
                    post.imagePrompts.find(entry => entry.key === key)
                      ?.prompt ?? ''
                  }
                  busyKey={promptBusy === 'cover' ? null : promptBusy}
                  uploadingKey={imageUploading}
                  generatingKey={generatingImageKey}
                  imageModel={imageModel}
                  imageGenError={imageGenError}
                  imageGenErrorSource={imageGenErrorSource}
                  onPromptChange={setImagePrompt}
                  onRegenerate={key => void regenerateImagePrompt(key)}
                  onResolve={resolvePlaceholder}
                  onUpload={(key, file) =>
                    void uploadPlaceholderImage(key, file)
                  }
                  onImageModelChange={setImageModel}
                  onGenerateImage={key => void generatePlaceholderImage(key)}
                />
              </Section>
            </div>

            <div className="relative lg:pl-2">
              <RailResizeHandle
                width={railWidth}
                onResize={resizeRail}
                onReset={() => setRailWidth(DEFAULT_RAIL_WIDTH)}
                containerRef={layoutRef}
              />
              <div className="lg:sticky lg:top-6 lg:max-h-[calc(100vh-4rem)] lg:overflow-y-auto">
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
                    className="blog-prose rounded-[1.75rem] border border-pp-line bg-white/85 p-5 shadow-panel backdrop-blur-md"
                    dangerouslySetInnerHTML={{ __html: preview }}
                  />
                ) : (
                  <div className="rounded-[1.75rem] border border-dashed border-pp-line bg-white/50 p-5">
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
          resource="series"
          open={taxonomyDialog === 'series'}
          onClose={() => setTaxonomyDialog(null)}
          onChanged={() => void loadSeries()}
        />
        <TaxonomyDialog
          resource="kinds"
          open={taxonomyDialog === 'kinds'}
          onClose={() => setTaxonomyDialog(null)}
          onChanged={() => void loadKinds()}
        />

        {/*
          Mounted only while open, so the preset is read fresh each time. It is `useState`
          initialiser state inside the dialog, so a dialog kept mounted behind an `open` prop
          would reopen describing the post as it was before the last rewrite.

          `onGenerated` reloads from the server rather than merging the response into local
          state: the rewrite touched eleven fields, and re-reading the document is both shorter
          than listing them and immune to the next field being forgotten here.
        */}
        {regenerating ? (
          <GenerateBlogDialog
            onClose={() => setRegenerating(false)}
            onGenerated={() => void load()}
            preset={presetSpecFromPost({
              title: post.title,
              slug: post.slug,
              excerpt: post.excerpt,
              kind: post.kind,
              series: post.series,
              isPillar: post.isPillar,
              language: post.language,
              tags: post.tags,
              relatedSlugs: post.relatedSlugs,
              /*
                `countBodyImages`, NOT `missingImages.length`. The two answer different
                questions and using the wrong one here meant a post whose images had already
                been uploaded had zero OUTSTANDING placeholders, preset itself to "no images",
                and regenerated with none.
              */
              imageCount: countBodyImages(post.bodyMarkdown),
            })}
            replaceTarget={{
              id,
              title: post.title,
              status: post.status,
              // Whitespace-split on the markdown, so it counts fences and syntax too. It is
              // there to convey scale before an irreversible press, not to be quoted.
              wordCount: post.bodyMarkdown.trim()
                ? post.bodyMarkdown.trim().split(/\s+/).length
                : 0,
            }}
          />
        ) : null}

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
