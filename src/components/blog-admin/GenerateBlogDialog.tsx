'use client'

import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  PenLine,
  Sparkles,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useEffectEvent, useState } from 'react'

import AutoManualSwitch from '@/components/blog-admin/AutoManualSwitch'
import ToggleSwitch from '@/components/blog-admin/ToggleSwitch'
import SelectField from '@/components/settings/SelectField'
import {
  helpTextCls,
  inputCls,
  primaryBtnCls,
  secondaryBtnCls,
  textareaCls,
} from '@/components/settings/settings-utils'
import {
  applyIllustration,
  describeBlockers,
  planIllustration,
  publishBlockers,
} from '@/lib/blog/auto-illustrate'
import {
  defaultSpec,
  emptyValueFor,
  FIELD_BY_KEY,
  GENERATION_FIELDS,
  GROUP_INTROS,
  GROUP_LABELS,
  IMAGE_MODEL_OPTIONS,
  NO_SERIES,
  type FieldOption,
  type FieldSetting,
  type GenerationField,
  type GenerationFieldKey,
  type FieldGroup,
} from '@/lib/blog/generation-fields'

/**
 * "Generate blog" - every property in the registry, each auto or manual, and one button.
 *
 * ```
 *   ┌──────────────────────────────────────────────────────────┐
 *   │ Generate a post                        [ ✨ Generate ] ✕ │  ← top-right, always reachable
 *   ├──────────────────────────────────────────────────────────┤
 *   │ IDENTITY                                                 │
 *   │   Blog name            [ AUTO │ manual ]                 │
 *   │   the model titles it, under the title rule below        │
 *   │   Slug                 [ auto │ MANUAL ]                 │
 *   │   [ five-things-next-16-did____________________ ]        │
 *   ├──────────────────────────────────────────────────────────┤
 *   │ TAXONOMY · CRAFT · ENGINE                                │
 *   └──────────────────────────────────────────────────────────┘
 * ```
 *
 * ## The form is rendered from `GENERATION_FIELDS`, not written out
 *
 * A hand-written row per field is one chance per field for the input, the validator and the
 * prompt to disagree, and the disagreement is silent - a field the form offers that the route
 * does not know is dropped on the floor, and the author watches the post ignore the
 * instruction they just typed with no error anywhere. See the header on the registry.
 *
 * ## Why the taxonomy lists are fetched here and not passed in
 *
 * `kinds`, `series` and the related-post candidates all come from collections that the owner
 * edits from the same admin area, so a list captured when the board mounted is stale by the
 * time this dialog opens. They are fetched on open, every open, which is three requests
 * behind an owner gate against lists of single digits.
 *
 * ## Why the dialog stays open on success
 *
 * The result carries warnings - a tag that was dropped, a slug that got a suffix, a series
 * the model invented - and each one is a small task in the editor. Closing on success would
 * put them behind a board row, which is where information goes to be missed. So the panel
 * swaps to a result card with the warnings and two ways out: open the post, or generate
 * another with the same brief.
 */

type ResultState = {
  id: string
  slug: string
  title: string
  status: string
  warnings: string[]
  model: string | null
  replaced: boolean
  /** How many images the automatic run drew. `null` when the switch was off. */
  imagesMade: number | null
  /**
   * Why the automatic run stopped short of publishing, already phrased as a sentence
   * fragment. Empty when it published, or when it was never going to.
   */
  notPublished: string
}

/**
 * What the automatic run is doing right now, so the seconds counter is not the only sign of
 * life during a minute of image calls.
 *
 * `done` is how many tasks have FINISHED, so the label renders as `done + 1` of `total`.
 */
type Progress = { label: string; done: number; total: number }

/**
 * The default for the image model when the switch is turned on.
 *
 * `IMAGE_MODEL_OPTIONS`, not `IMAGE_MODEL_SELECT_OPTIONS` - there is no "Choose a model..."
 * entry here, and that is a deliberate departure from the rule the editor's own pickers
 * follow. The reason that rule exists is that a picker sitting next to a Generate button
 * would otherwise spend the owner's money on a model they never chose. Here the spending
 * decision is the switch, which is off by default and carries the per-post estimate on its
 * own label; making them then pick a model from a list that opens on nothing would be a
 * second gate on a decision already made, and a Generate press that fails for a reason three
 * rows above the button.
 *
 * The cheaper of the two, for the same reason: the expensive one should be a thing you reach
 * for, not a thing you forget to change.
 */
const DEFAULT_IMAGE_MODEL: string = IMAGE_MODEL_OPTIONS[0].value

type DynamicOptions = {
  kinds: FieldOption[]
  series: FieldOption[]
  slugs: FieldOption[]
}

const EMPTY_OPTIONS: DynamicOptions = { kinds: [], series: [], slugs: [] }

const GROUP_ORDER: FieldGroup[] = ['identity', 'taxonomy', 'craft', 'engine']

/**
 * The post being rewritten, when this dialog is opened from the editor rather than the board.
 *
 * `wordCount` and `status` are here to be SAID, not used: a whole-body replacement is the one
 * irreversible thing this dialog does, and the two facts that change how it feels are how much
 * writing is about to be overwritten and whether readers can see it right now.
 */
export type ReplaceTarget = {
  id: string
  title: string
  status: 'draft' | 'published' | 'archived' | 'deleted'
  wordCount: number
}

export default function GenerateBlogDialog({
  onClose,
  onGenerated,
  preset,
  replaceTarget,
}: {
  onClose: () => void
  /** Fired after a successful generation so the caller can reload behind the panel. */
  onGenerated: () => void
  /**
   * What the switches open on. Absent from the board, where every field starts auto; supplied
   * by the editor, where it is this post described back to itself - see `presetSpecFromPost`.
   */
  preset?: Record<GenerationFieldKey, FieldSetting>
  /** Present only in rewrite mode. Its absence is what makes this "generate a new post". */
  replaceTarget?: ReplaceTarget
}) {
  /*
    There is no `open` prop any more: callers mount and unmount this instead.

    The reason is the preset. `useState` reads its initialiser once, so a mounted-but-hidden
    dialog that took `open` would keep the spec from the FIRST time it was opened - which on
    the board is a stale result card and in the editor is worse, a preset describing the post
    as it was before the last rewrite. Unmounting makes "fresh every open" the default rather
    than something an effect has to reproduce.
  */
  const [spec, setSpec] = useState<Record<GenerationFieldKey, FieldSetting>>(
    () => preset ?? defaultSpec()
  )
  const [options, setOptions] = useState<DynamicOptions>(EMPTY_OPTIONS)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ResultState | null>(null)
  const [elapsed, setElapsed] = useState(0)
  /**
   * The switch. Off by default, and deliberately not part of `spec`.
   *
   * Everything in `GENERATION_FIELDS` is a property of the POST, sent to the route and
   * folded into the prompt. This is a property of the RUN: it changes what this dialog does
   * after the route has answered, and the model must never see it. Putting it in the spec
   * would mean the registry carrying a key the prompt has to remember to ignore - which is
   * the kind of thing that gets forgotten exactly once and then reads as an instruction.
   */
  const [autoIllustrate, setAutoIllustrate] = useState(false)
  const [imageModel, setImageModel] = useState(DEFAULT_IMAGE_MODEL)
  const [progress, setProgress] = useState<Progress | null>(null)

  const loadOptions = useCallback(async () => {
    try {
      const [kindsRes, seriesRes, postsRes] = await Promise.all([
        fetch('/api/admin/blog/kinds', { cache: 'no-store' }),
        fetch('/api/admin/blog/series', { cache: 'no-store' }),
        fetch('/api/admin/blog', { cache: 'no-store' }),
      ])

      const kinds = (await kindsRes.json()) as {
        kinds?: { slug: string; label: string }[]
      }
      const series = (await seriesRes.json()) as {
        series?: { slug: string; title: string }[]
      }
      const posts = (await postsRes.json()) as {
        posts?: { slug: string; title: string; status: string }[]
      }

      setOptions({
        kinds: (kinds.kinds ?? []).map(kind => ({
          value: kind.slug,
          label: kind.label,
        })),
        // The sentinel first, so a manual series defaults to "no series" rather than to
        // whichever cluster happens to sort first. Filing a post in the wrong cluster by
        // accident is the failure that costs something; leaving it unfiled is not.
        series: [
          { value: NO_SERIES, label: 'No series' },
          ...(series.series ?? []).map(entry => ({
            value: entry.slug,
            label: entry.title,
          })),
        ],
        // Published only. `relatedSlugs` renders as links on a live post, so pointing one at
        // a draft is a link to a 404 - the route enforces the same rule server-side.
        slugs: (posts.posts ?? [])
          .filter(post => post.status === 'published')
          .map(post => ({ value: post.slug, label: post.title || post.slug })),
      })
    } catch {
      // Not surfaced as an error. Every one of these fields works on auto, which is where
      // they all start, so a failed taxonomy fetch costs the ability to override three of
      // every property in the registry - not the ability to generate.
      setOptions(EMPTY_OPTIONS)
    }
  }, [])

  const bootstrap = useEffectEvent(() => {
    void loadOptions()
  })

  useEffect(() => {
    const timer = window.setTimeout(() => bootstrap(), 0)
    return () => window.clearTimeout(timer)
  }, [])

  /**
   * A seconds counter while the model works.
   *
   * Not decoration. Generation takes 20 to 90 seconds with nothing to show for it, and a
   * spinner that has been spinning silently for a minute is indistinguishable from one that
   * has hung - which is exactly when somebody closes the tab or presses the button again.
   * A number that keeps moving is the cheapest possible proof that it has not.
   */
  useEffect(() => {
    if (!busy) return
    // `setElapsed(0)` belongs in `generate()`, not here. A setState in an effect body
    // cascades a second render before paint, and the lint rule that says so is right: the
    // reset has a real trigger - the press - so it can happen there instead of being
    // inferred from `busy` flipping.
    const started = Date.now()
    const timer = window.setInterval(() => {
      setElapsed(Math.round((Date.now() - started) / 1000))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [busy])

  // Escape closes, but never mid-generation: the request keeps running whatever this panel
  // does, so closing would abandon a post that is about to be saved with nothing on screen
  // pointing at it. No focus trap, for the reason `TaxonomyDialog` gives.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [busy, onClose])

  const setMode = (key: GenerationFieldKey, mode: 'auto' | 'manual') => {
    setSpec(current => {
      const field = FIELD_BY_KEY.get(key)
      const value =
        mode === 'manual' && field
          ? seedValue(field, current[key].value, options)
          : current[key].value
      return { ...current, [key]: { mode, value } }
    })
  }

  const setValue = (key: GenerationFieldKey, value: FieldSetting['value']) => {
    setSpec(current => ({ ...current, [key]: { mode: 'manual', value } }))
  }

  async function generate() {
    setBusy(true)
    setError(null)
    setResult(null)
    setElapsed(0)
    try {
      const res = await fetch('/api/admin/blog/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // Only the manual entries are sent. An auto field carries a value the author never
        // chose - a select's first option, an empty string - and sending it would be
        // indistinguishable from a choice on the other end.
        body: JSON.stringify({
          spec: Object.fromEntries(
            Object.entries(spec).filter(([, entry]) => entry.mode === 'manual')
          ),
          // Absent on the board. Its presence is what tells the route to rewrite in place
          // rather than create, so it is never sent "just in case".
          ...(replaceTarget ? { postId: replaceTarget.id } : {}),
        }),
      })
      const data = (await res.json()) as {
        id?: string
        slug?: string
        title?: string
        status?: string
        warnings?: string[]
        model?: string
        replaced?: boolean
        error?: string
      }
      if (!res.ok || !data.id)
        throw new Error(data.error ?? 'Could not generate the post')

      const warnings = data.warnings ?? []
      let status = data.status ?? 'archived'
      let imagesMade: number | null = null
      let notPublished = ''

      /*
        The post exists and is saved before this point, and it stays saved whatever happens
        next.

        That ordering is the whole safety story for the switch. Every failure below - a
        rate-limited image, a save that 503s, a closed tab - leaves an archived post on the
        board with whatever pictures did arrive, which is exactly the state a generation
        without the switch produces. The automatic run can come up short; it cannot lose
        anything.
      */
      if (autoIllustrate) {
        const run = await illustrateAndPublish(data.id, data.title ?? '')
        warnings.push(...run.warnings)
        imagesMade = run.imagesMade
        notPublished = run.notPublished
        if (run.status) status = run.status
      }

      setResult({
        id: data.id,
        slug: data.slug ?? '',
        title: data.title ?? '',
        status,
        warnings,
        model: data.model ?? null,
        replaced: data.replaced === true,
        imagesMade,
        notPublished,
      })
      onGenerated()
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not generate the post'
      )
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  /**
   * Draw every image the post is missing, save them in one PATCH, and publish if the result
   * is fit to publish.
   *
   * ```
   *   GET  /api/admin/blog/<id>              the body, the prompts, the cover
   *          ▼
   *   planIllustration ──▶ [ cover, image1, image2, ... ]
   *          ▼
   *   POST /api/admin/blog/<id>/generate-image   one per task, SEQUENTIALLY
   *          ▼
   *   PATCH /api/admin/blog/<id>             { coverImage, bodyMarkdown, status? }
   * ```
   *
   * ## Sequential, not `Promise.all`
   *
   * Four reasons, in order of how much they cost when ignored. `BLOG_GENERATE_IMAGE_LIMIT` is
   * per-window, so a parallel burst spends the whole allowance in one second and 429s the
   * back half of its own run. A rate limit hit serially can be DETECTED and the rest of the
   * run abandoned, which is what the loop does; hit in parallel every remaining call is
   * already in flight. Progress is meaningful only if there is an order. And each call is an
   * image model on the other end, which is not a resource that gets faster when crowded.
   *
   * ## One PATCH at the end, not one per image
   *
   * Every PATCH re-renders the body through Shiki (`renderMarkdown`), so a save per image is
   * five highlighting passes to write five URLs into one document. The accumulating value
   * lives in `state` and is written once - and because the body is only ever read at the
   * start, this cannot clobber a concurrent edit that did not exist: the post was created
   * seconds ago by the request above and no editor is open on it.
   *
   * ## Why it returns warnings rather than throwing
   *
   * A failed image is not a failed generation. The post is written, saved and on the board;
   * one missing picture makes it a post with a task attached, which is precisely what the
   * result card's warning list is for. Throwing would replace a finished post and a list of
   * three things to fix with a red banner saying the whole thing failed.
   */
  async function illustrateAndPublish(
    postId: string,
    title: string
  ): Promise<{
    warnings: string[]
    imagesMade: number
    status: string
    notPublished: string
  }> {
    const warnings: string[] = []
    setProgress({ label: 'reading the post back', done: 0, total: 1 })

    let source: {
      coverImage: string | null
      coverImagePrompt: string
      bodyMarkdown: string
      imagePrompts: { key: string; prompt: string }[]
    }
    try {
      const res = await fetch(`/api/admin/blog/${postId}`, {
        cache: 'no-store',
      })
      const data = (await res.json()) as {
        post?: Partial<typeof source>
        error?: string
      }
      if (!res.ok || !data.post)
        throw new Error(data.error ?? 'Could not read the post back')

      source = {
        coverImage: data.post.coverImage ?? null,
        coverImagePrompt: data.post.coverImagePrompt ?? '',
        bodyMarkdown: data.post.bodyMarkdown ?? '',
        imagePrompts: data.post.imagePrompts ?? [],
      }
    } catch (cause) {
      return {
        warnings: [
          `No images were made: ${cause instanceof Error ? cause.message : 'the post could not be read back'}. The post is saved - open it and generate them there.`,
        ],
        imagesMade: 0,
        status: '',
        notPublished: '',
      }
    }

    const { tasks, skipped } = planIllustration(source)
    warnings.push(...skipped)

    let state = {
      coverImage: source.coverImage,
      bodyMarkdown: source.bodyMarkdown,
    }
    let imagesMade = 0

    for (let index = 0; index < tasks.length; index += 1) {
      const task = tasks[index]
      setProgress({ label: task.label, done: index, total: tasks.length })

      const drawn = await drawImage(postId, task.prompt)
      if (drawn.url) {
        state = applyIllustration(state, task.key, drawn.url)
        imagesMade += 1
        continue
      }

      warnings.push(`Could not draw ${task.label}: ${drawn.error}`)

      /*
        A 429 ends the run instead of costing four more certain failures.

        The limiter is per-window, so the next call in this loop is refused for the same
        reason this one was - the only thing continuing buys is four more lines in the
        warning list saying the same sentence. Stopping and SAYING how many were skipped is
        the version the owner can act on.
      */
      if (drawn.rateLimited) {
        const remaining = tasks.length - index - 1
        if (remaining > 0)
          warnings.push(
            `The image rate limit was hit, so ${remaining} more image${remaining === 1 ? '' : 's'} ${remaining === 1 ? 'was' : 'were'} not attempted. Wait a few minutes and finish them in the editor.`
          )
        break
      }
    }

    const blockers = publishBlockers({
      title,
      bodyMarkdown: state.bodyMarkdown,
      coverImage: state.coverImage,
    })

    const body: Record<string, unknown> = {}
    if (state.bodyMarkdown !== source.bodyMarkdown)
      body.bodyMarkdown = state.bodyMarkdown
    if (state.coverImage !== source.coverImage)
      body.coverImage = state.coverImage
    // Publish rides along in the SAME PATCH as the content it is publishing, rather than
    // following it. Two requests means a window - short, but real - in which the post is
    // published with the old body, and `revalidatePublishedPost` fires inside the first one.
    if (blockers.length === 0) body.status = 'published'

    /*
      Nothing to write, and the blockers still have to travel.

      This branch is only reachable when `blockers.length > 0` - a non-empty blocker list is
      exactly what stops `body.status` being set above, so an empty body implies an unpublished
      post. It is the run where every image failed, and it was the one path that returned
      `notPublished: ''`: the result card then said the post was not published and gave no
      reason, in the only case where there was one to give.
    */
    if (Object.keys(body).length === 0)
      return {
        warnings,
        imagesMade,
        status: '',
        notPublished: describeBlockers(blockers),
      }

    setProgress({
      label: blockers.length === 0 ? 'publishing' : 'saving',
      done: tasks.length,
      total: tasks.length,
    })

    try {
      const res = await fetch(`/api/admin/blog/${postId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = (await res.json()) as { status?: string; error?: string }
      if (!res.ok) throw new Error(data.error ?? 'The save failed')

      return {
        warnings,
        imagesMade,
        status: data.status ?? '',
        notPublished: describeBlockers(blockers),
      }
    } catch (cause) {
      /*
        The images were drawn and paid for, and the save is what failed - so this warning has
        to say that, not "no images". Every URL is lost at this point (they are only held in
        `state`, which dies with this call), so the honest instruction is to try again rather
        than to go looking for them in the editor.
      */
      warnings.push(
        `${imagesMade} image${imagesMade === 1 ? '' : 's'} ${imagesMade === 1 ? 'was' : 'were'} drawn but could not be saved: ${cause instanceof Error ? cause.message : 'the save failed'}. They are gone - regenerate them from the editor.`
      )
      return { warnings, imagesMade: 0, status: '', notPublished: '' }
    }
  }

  /**
   * One image, with the three outcomes the loop above actually branches on.
   *
   * `rateLimited` is separate from `error` rather than sniffed out of the message, because
   * the message is written for a person and the branch is taken by code - matching the two
   * by string would break the moment somebody improves the wording on the route.
   */
  async function drawImage(
    postId: string,
    prompt: string
  ): Promise<{ url: string | null; error: string; rateLimited: boolean }> {
    try {
      const res = await fetch(`/api/admin/blog/${postId}/generate-image`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: imageModel, prompt }),
      })
      const data = (await res.json()) as { url?: string; error?: string }
      if (!res.ok || !data.url)
        return {
          url: null,
          error: data.error ?? 'the image model said no',
          rateLimited: res.status === 429,
        }

      return { url: data.url, error: '', rateLimited: false }
    } catch (cause) {
      return {
        url: null,
        error:
          cause instanceof Error ? cause.message : 'the request never finished',
        rateLimited: false,
      }
    }
  }

  const manualCount = Object.values(spec).filter(
    entry => entry.mode === 'manual'
  ).length

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-[rgba(31,28,26,0.42)] p-4 backdrop-blur-sm sm:p-8"
      onClick={event => {
        if (event.target === event.currentTarget && !busy) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="generate-dialog-title"
        className="w-full max-w-3xl rounded-[1.75rem] border border-pp-line bg-[rgba(255,253,250,0.99)] shadow-[0_32px_64px_rgba(46,35,28,0.28)] backdrop-blur-xl"
      >
        {/*
          `sticky` on the header, so the Generate button stays at the top-right of the dialog
          rather than at the top of a form that is four screens tall. The requirement says
          top-right; on a scrolling panel those are two different places, and the one that is
          always reachable is the one that was meant.
        */}
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 rounded-t-[1.75rem] border-b border-pp-line bg-[rgba(255,253,250,0.97)] px-6 py-5 backdrop-blur-xl sm:px-7">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-pp-muted">
              Blog board
            </p>
            <h2
              id="generate-dialog-title"
              className="mt-1 font-display text-2xl font-semibold tracking-tight text-pp-text"
            >
              {replaceTarget ? 'Regenerate this post' : 'Generate a post'}
            </h2>
            <p className={`${helpTextCls} mt-1.5`}>
              {replaceTarget
                ? /*
                    Different sentence in rewrite mode, because the default is inverted. On the
                    board "everything is auto" is the point; here the switches arrive holding
                    this post's own values, and what the author needs to know is that the ones
                    they leave alone are what keeps the post recognisable as itself.
                  */
                  `Opened with this post's own properties. Anything left on auto is decided again from scratch - ${manualCount} of ${GENERATION_FIELDS.length} are held.`
                : manualCount === 0
                  ? 'Everything is on auto. Press Generate and the model decides all of it.'
                  : `${manualCount} propert${manualCount === 1 ? 'y' : 'ies'} set by hand, the rest decided by the model.`}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => void generate()}
              disabled={busy}
              className={`${primaryBtnCls} gap-2 bg-[linear-gradient(120deg,#2a2320,#4a3a62_55%,#2a2320)] px-5`}
            >
              {busy ? (
                <>
                  <Loader2
                    aria-hidden
                    size={15}
                    className="animate-spin"
                  />
                  {elapsed}s
                </>
              ) : (
                <>
                  <Sparkles
                    aria-hidden
                    size={15}
                  />
                  {replaceTarget ? 'Replace' : 'Generate'}
                </>
              )}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              aria-label="Close"
              className="bg-white/82 rounded-full border border-pp-line p-2 text-pp-muted transition hover:bg-white hover:text-pp-text disabled:cursor-not-allowed disabled:opacity-50"
            >
              <X
                aria-hidden
                size={15}
              />
            </button>
          </div>
        </div>

        <div className="px-6 py-6 sm:px-7">
          {/*
            Stated, not engineered around, and it is the only warning in this feature that is
            about losing work rather than about a field being wrong.

            Two facts, because they are the two that change the decision: how much writing is
            about to be overwritten, and whether readers can see it right now. A published post
            keeps its status through a rewrite - the alternative, silently archiving it, takes
            a live URL down in exchange for a button press that said nothing about publishing -
            so on a live post this button swaps what the public reads, immediately.

            No second confirm dialog on top of this one. Reaching this button already takes
            opening a modal and reading twenty-six switches; a confirm stacked over a modal is
            the kind of prompt people learn to dismiss, which makes the next one weaker too.
          */}
          {replaceTarget ? (
            <div className="mb-5 flex gap-2.5 rounded-[1.15rem] border border-[rgba(163,120,47,0.22)] bg-[rgba(224,176,92,0.13)] px-3.5 py-3 text-sm leading-relaxed text-[#6b4d1c]">
              <AlertTriangle
                aria-hidden
                size={16}
                className="mt-0.5 shrink-0"
              />
              <span>
                <strong className="font-semibold">
                  This replaces the whole post
                  {replaceTarget.wordCount > 0
                    ? ` - all ${replaceTarget.wordCount} words of it`
                    : ''}
                  .
                </strong>{' '}
                Title, body, taxonomy and image prompts are all overwritten and
                the old text is not kept. The cover image, the URL and the
                publish state stay as they are
                {replaceTarget.status === 'published'
                  ? ' - and this post is live, so the new text is what readers get as soon as it saves.'
                  : '.'}
              </span>
            </div>
          ) : null}

          {error ? (
            <div className="mb-5 flex gap-2.5 rounded-[1.15rem] border border-[rgba(163,49,47,0.16)] bg-[rgba(211,108,105,0.1)] px-3.5 py-2.5 text-sm text-[#7f2f2f]">
              <AlertTriangle
                aria-hidden
                size={16}
                className="mt-0.5 shrink-0"
              />
              <span>{error}</span>
            </div>
          ) : null}

          {result ? (
            <ResultCard
              result={result}
              onAnother={() => setResult(null)}
              onDone={onClose}
            />
          ) : busy ? (
            <p className={`${helpTextCls} mb-5`}>
              {progress ? (
                <>
                  {/*
                    The stage, not just a spinner. The image phase is minutes long and
                    consists of several identical-looking waits, so "drawing image 2 of 4"
                    is the difference between a run that is progressing and a run that has
                    stuck on one call - which is otherwise indistinguishable.
                  */}
                  Post written. Now {progress.label}
                  {progress.total > 1
                    ? ` (${Math.min(progress.done + 1, progress.total)} of ${progress.total})`
                    : ''}
                  . Each image takes 10 to 40 seconds.{' '}
                  <strong className="font-semibold text-pp-text">
                    Keep this tab open
                  </strong>{' '}
                  - the images are made from here, so closing it stops the run.
                  The post is already saved either way.
                </>
              ) : (
                <>
                  Writing the post. This takes 20 to 90 seconds depending on the
                  length and the model - the request keeps running if you look
                  away, and the post lands on the board either way.
                </>
              )}
            </p>
          ) : null}

          <div
            className={result ? 'pointer-events-none mt-6 opacity-45' : ''}
            aria-hidden={result !== null}
          >
            {/*
              Above the four groups rather than inside Engine, which is where a field about
              models would otherwise belong.

              Everything in those groups describes the POST and is decided before the model
              runs. This describes what happens AFTER it answers, and it is the only control
              in the dialog that spends money on a second provider and can make a page public
              without another press. Filing it as the twenty-seventh row of a scrolling form
              would be the one switch on this panel most worth reading, placed where the
              least-read ones are.
            */}
            <section className="mb-7">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-pp-muted">
                After the model finishes
              </h3>
              <p className={`${helpTextCls} mt-1 max-w-[62ch]`}>
                Off by default. Everything here costs a second model call per
                image and can put the post in front of readers without another
                press.
              </p>

              <div className="bg-white/62 hover:bg-white/82 mt-3.5 rounded-[1.2rem] border border-pp-line px-4 py-3 transition">
                <div className="flex items-center justify-between gap-3">
                  <label
                    id="gen-auto-illustrate-label"
                    htmlFor="gen-auto-illustrate"
                    className="text-sm font-semibold text-pp-text"
                  >
                    Make every image, then publish
                  </label>
                  <ToggleSwitch
                    id="gen-auto-illustrate"
                    checked={autoIllustrate}
                    disabled={busy}
                    onChange={setAutoIllustrate}
                  />
                </div>

                {autoIllustrate ? (
                  <>
                    <p className={`${helpTextCls} mt-1`}>
                      The cover and every <code>![image](imageN)</code> in the
                      body are drawn from their prompts, saved, and the post is
                      published - but only if nothing is left missing. A post
                      that ends up short an image, a cover or a title stays
                      archived and the result below says which. Budget one to
                      five images a post.
                    </p>
                    <div className="mt-2.5">
                      <SelectField
                        id="gen-image-model"
                        ariaLabel="Image generation model"
                        value={imageModel}
                        options={IMAGE_MODEL_OPTIONS}
                        disabled={busy}
                        onChange={setImageModel}
                      />
                    </div>
                  </>
                ) : (
                  <p className={`${helpTextCls} mt-1`}>
                    The post is saved as archived with its image prompts written
                    and no pictures. You make them in the editor and press
                    Publish yourself.
                  </p>
                )}
              </div>
            </section>

            {GROUP_ORDER.map(group => (
              <section
                key={group}
                className="mb-7 last:mb-0"
              >
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-pp-muted">
                  {GROUP_LABELS[group]}
                </h3>
                <p className={`${helpTextCls} mt-1 max-w-[62ch]`}>
                  {GROUP_INTROS[group]}
                </p>

                <div className="mt-3.5 space-y-2.5">
                  {GENERATION_FIELDS.filter(field => field.group === group).map(
                    field => (
                      <FieldRow
                        key={field.key}
                        field={field}
                        setting={spec[field.key]}
                        options={options}
                        disabled={busy}
                        onMode={mode => setMode(field.key, mode)}
                        onValue={value => setValue(field.key, value)}
                      />
                    )
                  )}
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * The value a field opens on the first time it is switched to manual.
 *
 * A select whose choices arrived over HTTP cannot have a sensible value baked into
 * `defaultSpec`, so it would otherwise flip to manual holding `''` - which the route drops
 * back to auto, silently undoing the switch the author just flicked.
 */
function seedValue(
  field: GenerationField,
  current: FieldSetting['value'],
  options: DynamicOptions
): FieldSetting['value'] {
  if (current !== '' && !(Array.isArray(current) && current.length === 0))
    return current
  if (field.optionsFrom && field.control === 'select')
    return options[field.optionsFrom][0]?.value ?? emptyValueFor(field)

  return emptyValueFor(field)
}

function FieldRow({
  field,
  setting,
  options,
  disabled,
  onMode,
  onValue,
}: {
  field: GenerationField
  setting: FieldSetting
  options: DynamicOptions
  disabled: boolean
  onMode: (mode: 'auto' | 'manual') => void
  onValue: (value: FieldSetting['value']) => void
}) {
  const inputId = `gen-${field.key}`
  const choices: readonly FieldOption[] = field.optionsFrom
    ? options[field.optionsFrom]
    : (field.options ?? [])

  return (
    <div className="bg-white/62 hover:bg-white/82 rounded-[1.2rem] border border-pp-line px-4 py-3 transition">
      <div className="flex items-center justify-between gap-3">
        <label
          id={`${inputId}-label`}
          htmlFor={inputId}
          className="text-sm font-semibold text-pp-text"
        >
          {field.label}
        </label>
        <AutoManualSwitch
          id={inputId}
          mode={setting.mode}
          disabled={disabled}
          onChange={onMode}
        />
      </div>

      {setting.mode === 'auto' ? (
        <p className={`${helpTextCls} mt-1`}>{field.autoNote}</p>
      ) : (
        <div className="mt-2">
          <FieldControl
            field={field}
            inputId={inputId}
            value={setting.value}
            choices={choices}
            disabled={disabled}
            onValue={onValue}
          />
        </div>
      )}
    </div>
  )
}

function FieldControl({
  field,
  inputId,
  value,
  choices,
  disabled,
  onValue,
}: {
  field: GenerationField
  inputId: string
  value: FieldSetting['value']
  choices: readonly FieldOption[]
  disabled: boolean
  onValue: (value: FieldSetting['value']) => void
}) {
  if (field.control === 'boolean')
    return (
      <label className="flex cursor-pointer items-center gap-2.5 text-sm text-pp-text">
        <input
          id={inputId}
          type="checkbox"
          checked={value === true}
          disabled={disabled}
          onChange={event => onValue(event.target.checked)}
          className="h-4 w-4 rounded border-pp-line accent-pp-text"
        />
        {value === true ? 'Yes' : 'No'}
      </label>
    )

  if (field.control === 'select') {
    if (choices.length === 0)
      // A dynamic select whose list has not arrived, or is genuinely empty. Saying so beats
      // an empty dropdown, which reads as a broken control rather than as an empty list.
      return (
        <p className={helpTextCls}>
          Nothing to choose from yet - leave this on auto.
        </p>
      )

    return (
      <SelectField
        id={inputId}
        value={typeof value === 'string' ? value : ''}
        options={choices}
        disabled={disabled}
        onChange={onValue}
      />
    )
  }

  if (field.control === 'multiselect') {
    const selected = Array.isArray(value) ? value : []
    if (choices.length === 0)
      return (
        <p className={helpTextCls}>
          Nothing to choose from yet - leave this on auto.
        </p>
      )

    return (
      <div className="flex flex-wrap gap-1.5">
        {choices.map(option => {
          const on = selected.includes(option.value)
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={on}
              disabled={
                disabled || (!on && selected.length >= (field.maxItems ?? 8))
              }
              onClick={() =>
                onValue(
                  on
                    ? selected.filter(item => item !== option.value)
                    : [...selected, option.value]
                )
              }
              className={[
                'rounded-full border px-3 py-1.5 text-xs font-medium transition',
                on
                  ? 'border-pp-text bg-pp-text text-white'
                  : 'bg-white/78 border-pp-line text-pp-muted hover:border-pp-blue/40 hover:text-pp-text',
                'disabled:cursor-not-allowed disabled:opacity-40',
              ].join(' ')}
            >
              {option.label}
            </button>
          )
        })}
      </div>
    )
  }

  if (field.control === 'textarea')
    return (
      <textarea
        id={inputId}
        className={textareaCls}
        value={typeof value === 'string' ? value : ''}
        placeholder={field.placeholder}
        maxLength={field.maxLength}
        disabled={disabled}
        onChange={event => onValue(event.target.value)}
      />
    )

  return (
    <input
      id={inputId}
      className={inputCls}
      value={typeof value === 'string' ? value : ''}
      placeholder={field.placeholder}
      maxLength={field.maxLength}
      disabled={disabled}
      onChange={event => onValue(event.target.value)}
    />
  )
}

/**
 * What a finished generation looks like, warnings and all.
 *
 * The status line is not a formality. A post that appears on the board as `archived` when the
 * author expected a draft looks like something went wrong, so the card says the state and the
 * reason for it before the board has a chance to raise the question.
 */
function ResultCard({
  result,
  onAnother,
  onDone,
}: {
  result: ResultState
  onAnother: () => void
  onDone: () => void
}) {
  return (
    <div className="rounded-[1.4rem] border border-pp-line bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(247,243,255,0.86))] p-5 shadow-[0_18px_36px_rgba(46,35,28,0.08)]">
      <div className="flex items-start gap-2.5">
        <CheckCircle2
          aria-hidden
          size={18}
          className="mt-0.5 shrink-0 text-pp-text"
        />
        <div className="min-w-0">
          <h3 className="font-display text-lg font-semibold tracking-tight text-pp-text">
            {result.title}
          </h3>
          <p className={`${helpTextCls} mt-1`}>
            /blog/{result.slug} ·{' '}
            {/*
              The published branch is first and is not conditional on `replaced`, because the
              switch can publish a brand-new post - which the other two sentences both deny.
              "Nothing is public until you press Publish" printed over a live URL is the one
              wrong thing this card could say.
            */}
            {result.status === 'published' ? (
              <>
                <strong className="text-pp-text">published</strong> and live
                now.
              </>
            ) : result.replaced ? (
              <>
                rewritten, still{' '}
                <strong className="text-pp-text">{result.status}</strong>.
              </>
            ) : (
              <>
                saved as{' '}
                <strong className="text-pp-text">{result.status}</strong>, so
                nothing is public until you press Publish.
              </>
            )}
            {result.model ? ` Written by ${result.model}.` : ''}
          </p>

          {/*
            The automatic run's own line, and it exists even when the count is zero. A run
            that drew nothing and said nothing is indistinguishable from a switch that was
            never read, which is the failure that would have the owner press Generate again
            rather than look at why.
          */}
          {result.imagesMade !== null ? (
            <p className={`${helpTextCls} mt-1.5`}>
              {result.imagesMade === 0
                ? 'No images were made.'
                : `${result.imagesMade} image${result.imagesMade === 1 ? '' : 's'} drawn and saved.`}
              {result.notPublished
                ? ` Not published because ${result.notPublished}.`
                : ''}
            </p>
          ) : null}
        </div>
      </div>

      {result.warnings.length > 0 ? (
        <div className="mt-4 rounded-[1.1rem] border border-[rgba(163,120,47,0.2)] bg-[rgba(224,176,92,0.12)] px-3.5 py-3">
          <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#7a5720]">
            <AlertTriangle
              aria-hidden
              size={13}
            />
            {result.warnings.length} thing
            {result.warnings.length === 1 ? '' : 's'} to look at
          </p>
          <ul className="mt-2 space-y-1 text-sm text-[#6b4d1c]">
            {result.warnings.map(warning => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-2">
        {/*
          In rewrite mode the editor IS the page behind this panel, so a link to it would be a
          link to here. `onDone` closes instead, and the editor has already reloaded.
        */}
        {result.replaced ? (
          <button
            type="button"
            className={`${primaryBtnCls} gap-2`}
            onClick={onDone}
          >
            <PenLine
              aria-hidden
              size={15}
            />
            Read it
          </button>
        ) : (
          <a
            className={`${primaryBtnCls} gap-2`}
            href={`/admin/blog/${result.id}`}
          >
            <PenLine
              aria-hidden
              size={15}
            />
            Read it in the editor
          </a>
        )}
        <button
          type="button"
          className={secondaryBtnCls}
          onClick={onAnother}
        >
          {result.replaced ? 'Try again' : 'Generate another'}
        </button>
      </div>
    </div>
  )
}
