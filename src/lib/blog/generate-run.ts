import 'server-only'

import mongoose from 'mongoose'

import {
  buildGenerationPrompt,
  generationTemperature,
  GenerationError,
  parseGeneratedDraft,
  validateManualSpec,
  type GeneratedDraft,
  type GenerationContext,
} from '@/lib/blog/generate'
import {
  DEFAULT_MODEL,
  manualList,
  manualString,
  type GenerationSpec,
} from '@/lib/blog/generation-fields'
import { carryForwardImages } from '@/lib/blog/image-placeholders'
import { listKinds } from '@/lib/blog/kind-data'
import { chatCompletion, extractJsonObject, LlmError } from '@/lib/blog/llm'
import { BLOG_PIPELINE_VERSION, renderMarkdown } from '@/lib/blog/markdown'
import { revalidatePublishedPost } from '@/lib/blog/revalidate'
import { listSeries } from '@/lib/blog/series-data'
import { PostModel, type PostDocument } from '@/models/Post'

/**
 * Writing a post with a model and saving it - everything between a spec and a document.
 *
 * ```
 *   spec ──▶ kinds + series + published slugs        the closed sets the model must choose from
 *              ▼
 *            validateManualSpec        every pinned field checked BEFORE a call is paid for
 *              ▼
 *            chatCompletion ──▶ LlmError          router, or Gemini when it cannot be reached
 *              ▼
 *            parseGeneratedDraft                  nothing the model said is trusted
 *              ▼
 *            unique slug · pillar guard · carry-forward images · renderMarkdown
 *              ▼
 *            create (archived) | replace in place  ──▶ { post, warnings, model, usage }
 * ```
 *
 * ## Why this is a library function and not the route handler it used to be
 *
 * There are two callers now: `POST /api/admin/blog/generate`, where a person is waiting and
 * every failure has to become a status code they can act on, and `POST /api/cron/blog`, where
 * nobody is waiting and a failure is a log line. Those differ only in how the result is
 * reported - the work itself, all three hundred lines of it, is identical, and a second copy
 * of it would drift on the first change to the pillar guard or the slug allocator.
 *
 * ## Why it throws `GenerationRunError` instead of returning a `NextResponse`
 *
 * The status codes are load-bearing and were chosen carefully - 422 for "the request was fine
 * and the answer was not" versus 502 for "the provider failed" is the distinction that tells
 * the author whether to retry the same brief or change it. So the code travels WITH the error
 * rather than being re-derived by each caller from a message string. The cron ignores it; the
 * route passes it straight to `jsonError`.
 *
 * ## What it deliberately does NOT do
 *
 * No auth, no rate limiting, no body parsing, no `revalidatePath` on the create path. The
 * first three are per-caller and belong at the edge - the cron authenticates with a shared
 * secret and the route with an owner cookie, and nothing here should have an opinion about
 * which. The last one is explained on the create call below.
 */

/** Thrown for anything a caller has to report, carrying the status the route would have used. */
export class GenerationRunError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'GenerationRunError'
    this.status = status
  }
}

/**
 * A live mongoose document, named once.
 *
 * `HydratedDocument<PostDocument>` rather than anything derived from `findById`'s return: that
 * is a `Query`, so `Awaited<ReturnType<...>>` resolves to `{}` and every property access below
 * fails to typecheck for a reason that looks like the schema is wrong.
 */
export type PostRecord = mongoose.HydratedDocument<PostDocument>

export type GenerationRun = {
  post: PostRecord
  /** Everything worth telling the author, from the dropped spec keys through the prose audit. */
  warnings: string[]
  /** True when an existing post was rewritten in place rather than a new one created. */
  replaced: boolean
  /** The model that ACTUALLY answered, which is not always the one that was asked for. */
  model: string
  usage: Awaited<ReturnType<typeof chatCompletion>>['usage']
}

/**
 * How many published posts the model may pick `relatedSlugs` from.
 *
 * Every candidate is a line of prompt, and the whole list is sent on every generation. Forty
 * is well past where a related-posts choice stops improving and comfortably inside the
 * context of the smallest model on the dropdown.
 */
const RELATED_CANDIDATE_LIMIT = 40

/** How many `-2`, `-3` suffixes to try before giving up on an auto-generated slug. */
const SLUG_SUFFIX_ATTEMPTS = 20

export async function runGeneration({
  spec,
  warnings,
  postId,
}: {
  /** Already normalised. This function trusts its shape and nothing else about it. */
  spec: GenerationSpec
  /**
   * Seeded by the caller, then appended to. `normaliseSpec` produces the first entries (the
   * keys it dropped), and they belong in the same list as everything found later - to the
   * author there is no difference between "your tag was dropped" and "the model's tag was
   * dropped".
   */
  warnings: string[]
  /** Present turns this from "write a post" into "rewrite this post". */
  postId?: string
}): Promise<GenerationRun> {
  let context: GenerationContext
  try {
    const [kinds, series, published] = await Promise.all([
      listKinds(),
      listSeries(),
      // `$ne: postId` on the rewrite path, because a post is not related to itself. Without it
      // the post being rewritten sits in its own candidate list, the model can validly pick it,
      // `resolveRelated` accepts it (it IS a published slug), and the live page renders a
      // "related" link back to the page you are already on.
      PostModel.find(
        postId
          ? { status: 'published', _id: { $ne: postId } }
          : { status: 'published' }
      )
        .select('slug title')
        .sort({ publishedAt: -1 })
        .limit(RELATED_CANDIDATE_LIMIT)
        .lean(),
    ])

    /*
      The author's own `relatedSlugs` are looked up directly, not taken from the window above.

      `relatedCandidates` is capped at RELATED_CANDIDATE_LIMIT because it is a PROMPT budget -
      every entry is a line sent to the model. `resolveRelated` then uses that same set to
      validate the result, which is right for slugs the model invented and wrong for slugs the
      author chose: with more published posts than the limit, a curated link to an older post
      fell outside the window, was dropped, and the author was told it "does not exist" - a
      false statement about a live post, and one that misdirects the fix.

      Regeneration is where this bit hardest, because `presetSpecFromPost` pins the post's
      existing related list as manual. Every regeneration silently stripped its oldest
      editorial links.
    */
    const pinned = manualList(spec, 'relatedSlugs') ?? []
    const verified = pinned.length
      ? await PostModel.find({
          slug: { $in: pinned.map(slug => slug.trim()).filter(Boolean) },
          status: 'published',
          ...(postId ? { _id: { $ne: postId } } : {}),
        })
          .select('slug title')
          .lean()
      : []

    const bySlug = new Map<string, { slug: string; title: string }>()
    for (const post of [...published, ...verified])
      bySlug.set(post.slug, { slug: post.slug, title: post.title })

    context = {
      kinds: kinds.map(kind => ({ slug: kind.slug, label: kind.label })),
      series: series.map(entry => ({
        slug: entry.slug,
        title: entry.title,
        blurb: entry.blurb,
      })),
      relatedCandidates: Array.from(bySlug.values()),
    }
  } catch (error) {
    console.error('[blog/generate-run] could not read the taxonomies', error)
    throw new GenerationRunError(
      'Unable to read the kinds and series right now.',
      500
    )
  }

  if (context.kinds.length === 0)
    throw new GenerationRunError(
      'No post kinds exist. Create one before generating a post.',
      409
    )

  /*
    Everything the author pinned by hand is checked HERE, before a model call is paid for.

    These same checks live inside `parseGeneratedDraft`, which runs on the reply - twenty to
    ninety seconds and one billable completion later. A manual slug with a space in it, or a
    kind somebody deleted in another tab, produced a 422 after the wait with nothing saved. None
    of them needs the model's answer, and the spec and taxonomies are both already in hand.
  */
  try {
    validateManualSpec(spec, context)
  } catch (error) {
    if (error instanceof GenerationError)
      throw new GenerationRunError(error.message, 400)
    throw error
  }

  const { system, user } = buildGenerationPrompt(spec, context)

  const requestedModel = manualString(spec, 'model') ?? DEFAULT_MODEL

  let completion
  try {
    completion = await chatCompletion({
      model: requestedModel,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: generationTemperature(spec),
    })
  } catch (error) {
    if (error instanceof LlmError)
      // 502 rather than 500: the failure is upstream of us and the owner can act on it -
      // retry, pick another model, or fix the key. A 500 would say "this site is broken".
      throw new GenerationRunError(
        error.message,
        error.status === 429 ? 429 : 502
      )

    console.error('[blog/generate-run] unexpected model failure', error)
    throw new GenerationRunError('The model call failed.', 502)
  }

  /*
    The provider changed under us, and the author is the last person who should find that out
    from a billing page.

    `chatCompletion` falls back to Gemini when the router cannot be reached at all, and it is
    deliberately transparent about it - the call returns normally and `model` carries whatever
    actually ran. That is the right behaviour and it is also how a silent substitution happens:
    the post is in a different model's voice, at a different cost, and nothing in the editor
    would say so. `completion.model` is the router's own resolved name on the happy path, which
    is often not the alias that was asked for, so the comparison is on the Gemini prefix rather
    than on inequality with the requested model.
  */
  if (/^gemini-/i.test(completion.model) && !requestedModel.includes('gemini'))
    warnings.push(
      `The model router could not be reached, so this post was written by ${completion.model} instead of ${requestedModel}. Read it with that in mind - it is a different model in a different voice, and the house style rules land differently.`
    )

  let draft
  try {
    const payload = extractJsonObject(completion.text)
    const result = parseGeneratedDraft(payload, spec, context)
    draft = result.draft
    warnings.push(...result.warnings)
  } catch (error) {
    if (error instanceof GenerationError || error instanceof LlmError)
      // 422: the request was fine and the answer was not. Distinguishing it from the 502
      // above is what tells the owner whether to retry the same brief or change it.
      throw new GenerationRunError(error.message, 422)

    console.error('[blog/generate-run] could not parse the reply', error)
    throw new GenerationRunError(
      "Could not read the model's reply as a post.",
      422
    )
  }

  try {
    /*
      Uniqueness, and the two cases are deliberately not the same.

      An AUTHOR who typed a slug that is taken gets a 409 naming it: they chose that URL, and
      silently handing them `five-things-2` would be a different post at a different address
      than the one they asked for. A MODEL-chosen slug gets a suffix, because it was never a
      decision, and failing a minute of generation over a name nobody picked is absurd.
    */
    /*
      The target document, loaded now rather than before the model call - see `postId` above.

      `deleted` is refused. A soft-deleted post exists only to hold its slug against reuse, so
      rewriting one would resurrect a URL the author retired without ever putting it back on
      the board, and the contact attributions that slug carries would then belong to text
      nobody chose to publish.
    */
    const target = postId
      ? await PostModel.findById(postId).select('+bodyMarkdown')
      : null
    if (postId && !target) throw new GenerationRunError('Post not found.', 404)
    if (target?.status === 'deleted')
      throw new GenerationRunError(
        'That post is deleted. Its slug is held against reuse and it cannot be rewritten.',
        409
      )

    /*
      A published post's slug is frozen, the same rule and the same predicate as PATCH:
      `publishedAt !== null`, never `status !== 'draft'`. The preset fills this field with the
      post's own slug, so reaching this needs the author to have edited it deliberately.
    */
    if (target && draft.slug !== target.slug && target.publishedAt !== null)
      throw new GenerationRunError(
        'This post has been published, so its slug is frozen. Changing it would 404 every link and feed entry pointing at the old URL.',
        409
      )

    const slugWasChosen = manualString(spec, 'slug') !== undefined
    /*
      A rewrite that keeps its own slug must skip the uniqueness check, because the document
      holding that slug is the one being written. Without this branch, every regeneration
      collides with itself and 409s on the post's own URL.
    */
    const unique =
      target && draft.slug === target.slug
        ? target.slug
        : await findFreeSlug(draft.slug, slugWasChosen)
    if (!unique)
      throw new GenerationRunError(
        slugWasChosen
          ? `The slug "${draft.slug}" is already taken. A deleted post can still be holding it.`
          : `Could not find a free slug near "${draft.slug}".`,
        409
      )

    if (unique !== draft.slug)
      warnings.push(
        `"${draft.slug}" was taken, so this post is at "${unique}".`
      )

    draft.slug = unique

    /*
      The pillar invariant, checked here rather than left to the index.

      `{ series: 1 }` is unique over `{ isPillar: true, series: { $type: 'string' } }`, so a
      second hub for a series is an E11000 at `create` - after the model call has been paid
      for. Checking first turns a lost generation into a warning and a saved post. The index
      is still the thing that actually holds the invariant under a concurrent write; this only
      keeps the common case from throwing away work.
    */
    if (draft.isPillar && draft.series) {
      // `_id: { $ne: target }` so a post that is ALREADY its series' pillar does not read as
      // its own blocker and quietly demote itself on every rewrite.
      const existingPillar = await PostModel.exists({
        series: draft.series,
        isPillar: true,
        ...(target ? { _id: { $ne: target._id } } : {}),
      })
      if (existingPillar) {
        draft.isPillar = false
        warnings.push(
          `"${draft.series}" already has a pillar post, so this one was saved as an ordinary post in the series.`
        )
      }
    }

    /*
      A rewrite keeps the pictures the post already had.

      Without this, regenerating a PUBLISHED post replaced its body with bare placeholders,
      kept `status: 'published'`, and revalidated - so within the ISR flush every reader of a
      live article saw broken-image icons where two uploaded pictures used to be, and the
      uploads themselves were orphaned. The dialog's "what is kept" list never mentioned body
      images, so there was no warning either.

      Matched by position, which is the only correspondence that exists between two different
      bodies. See `carryForwardImages` for why that is the honest choice rather than a clever
      one. `imagePrompts` is deliberately left alone: a key whose placeholder is now a real URL
      simply stops rendering a card, which is the same thing that happens after an upload.
    */
    if (target) {
      const carry = carryForwardImages(draft.bodyMarkdown, target.bodyMarkdown)
      draft.bodyMarkdown = carry.markdown
      if (carry.carried > 0)
        warnings.push(
          `Kept ${carry.carried} image${carry.carried === 1 ? '' : 's'} from the old body, matched by position. Check they still fit the new text.`
        )

      if (carry.dropped.length > 0)
        /*
          Quoted in FULL, not through `summariseList`.

          That helper truncates each entry to 40 characters, which is right for model-controlled
          junk like a 500-tag reply and exactly wrong here: these are the author's own uploaded
          Cloudinary URLs, and a truncated URL cannot be pasted back. The warning exists so a
          paid-for image is not silently lost, so half a URL defeats it. They are our own strings
          and `MAX_IMAGE_PROMPTS` bounds how many there can be, so there is nothing to bound.
        */
        warnings.push(
          `The new body has fewer images than the old one, so ${carry.dropped.length} picture${carry.dropped.length === 1 ? ' is' : 's are'} no longer used: ${carry.dropped.join(', ')}.`
        )
    }

    // Rendered here, at save time, for the same reason PATCH does it (D9): Shiki costs a
    // ~5.5s bootstrap per process and this is the one place where somebody is already
    // waiting. A post created without `bodyHtml` would otherwise render blank until its
    // first edit.
    const bodyHtml = await renderMarkdown(draft.bodyMarkdown, draft.slug)

    /*
      `draft` already carries `coverImagePrompt` and `imagePrompts`, reconciled against the
      placeholders actually in the body - see `resolveImagePrompts`. They are saved with the
      post rather than returned to the client to store, because the editor is a separate page
      load: anything not on the document is gone by the time it opens.
    */
    const saved = target
      ? await replacePost(target, draft, bodyHtml)
      : await PostModel.create({
          ...draft,
          bodyHtml,
          renderedWith: BLOG_PIPELINE_VERSION,
          // The requirement, and the invariant a NEW generated post is built around.
          // `publishedAt` stays null, so the slug is still editable and nothing has ever
          // been public. A rewrite keeps whatever status it already had - see `replacePost`.
          status: 'archived',
        })

    /*
      A rewrite of a LIVE post has to invalidate it; a fresh archived one has nothing cached.

      `revalidatePublishedPost` runs whatever the status is, for the reason `PATCH` gives: the
      case that matters is a path that IS cached as a 200, and deciding from the new status
      would skip it. Invalidating a path that was never cached is free. Not in a try/catch,
      also deliberately - see `revalidate.ts`.
    */
    /*
      Isolated from the write it follows. The post is already saved at this point, so a
      `revalidatePath` throw reaching the catch below would answer "the post was written but
      could not be saved" for a rewrite that HAS been saved - and on the rewrite path that text
      has already replaced a live article. The author would regenerate again over their own
      successful result.
    */
    if (target)
      try {
        revalidatePublishedPost(saved.slug)
      } catch (error) {
        console.error(
          '[blog/generate-run] saved but could not revalidate',
          error
        )
        warnings.push(
          'The post was saved, but the live page may serve the old text until its cache expires.'
        )
      }
    return {
      post: saved,
      warnings,
      replaced: target !== null,
      model: completion.model,
      usage: completion.usage,
    }
  } catch (error) {
    if (error instanceof GenerationRunError) throw error

    if (error instanceof mongoose.Error.ValidationError)
      throw new GenerationRunError(error.message, 422)

    if ((error as { code?: number }).code === 11000)
      throw new GenerationRunError(
        'That slug or pillar slot was taken while the post was being written.',
        409
      )

    console.error('[blog/generate-run] save failed', error)
    throw new GenerationRunError(
      'The post was written but could not be saved.',
      500
    )
  }
}

/**
 * The first free slug at or after `base`, or `null`.
 *
 * Queries the collection rather than filtering a list, and queries EVERY status - a
 * soft-deleted post still holds its slug against reuse, which is the whole point of the soft
 * delete. `exact` stops after the first check for an author-chosen slug.
 */
async function findFreeSlug(
  base: string,
  exact: boolean
): Promise<string | null> {
  const taken = await PostModel.findOne({ slug: base }).select('_id').lean()
  if (!taken) return base
  if (exact) return null

  for (let n = 2; n <= SLUG_SUFFIX_ATTEMPTS; n += 1) {
    // Truncated so `base-12` still fits `^[a-z0-9-]{1,80}$` when `base` is already at 80.
    const suffix = `-${n}`
    const candidate = `${base.slice(0, 80 - suffix.length)}${suffix}`
    const clash = await PostModel.findOne({ slug: candidate })
      .select('_id')
      .lean()
    if (!clash) return candidate
  }

  return null
}

/**
 * Overwrite an existing post with a freshly generated one.
 *
 * ```
 *   REPLACED            title · slug · excerpt · kind · series · isPillar · language
 *                       tags · relatedSlugs · bodyMarkdown · bodyHtml
 *                       coverImagePrompt · imagePrompts
 *
 *   KEPT                status · publishedAt · coverImage · coverCaption · createdAt
 * ```
 *
 * ## Why `status` and `publishedAt` survive
 *
 * A rewrite is an edit, not a new post, and neither field describes the text. Resetting
 * `status` to `archived` would silently unpublish a live article the moment somebody asked for
 * a better draft of it - taking the URL down in exchange for a button press that said nothing
 * about publishing. Touching `publishedAt` would rewrite `datePublished` in JSON-LD and
 * `pubDate` in RSS, telling every feed reader a months-old post is new, and it would unfreeze
 * the slug guard that reads it.
 *
 * The consequence is stated plainly in the dialog rather than engineered around: rewriting a
 * published post publishes the new text. That IS the operation the author asked for, and the
 * alternative - silently archiving - is the surprise.
 *
 * ## Why the cover image is kept and its prompt is not
 *
 * The picture may have been made, paid for, uploaded and framed; the body being rewritten is
 * no reason to throw it away, and the author can clear it in one click if it no longer fits.
 * The PROMPT is the opposite: it is a description derived from the text, so after a rewrite
 * the old one describes a post that no longer exists.
 *
 * ## Why `contentUpdatedAt` moves unconditionally
 *
 * Every other write path checks whether the content actually changed, because autosave fires
 * on a debounce and a sitemap that cries wolf gets ignored. This path does not need the check:
 * a whole body arrived from a model, so it changed. The one case it would catch - a model
 * returning text identical to what was there - is not worth a comparison of two documents.
 */
async function replacePost(
  target: PostRecord,
  draft: GeneratedDraft,
  bodyHtml: string
): Promise<PostRecord> {
  target.slug = draft.slug
  target.title = draft.title
  target.excerpt = draft.excerpt
  target.kind = draft.kind
  target.series = draft.series
  target.isPillar = draft.isPillar
  target.language = draft.language
  target.tags = draft.tags
  target.relatedSlugs = draft.relatedSlugs
  target.bodyMarkdown = draft.bodyMarkdown
  target.bodyHtml = bodyHtml
  target.renderedWith = BLOG_PIPELINE_VERSION
  target.coverImagePrompt = draft.coverImagePrompt
  target.imagePrompts = draft.imagePrompts
  target.contentUpdatedAt = new Date()

  // The array is rebuilt rather than mutated in place, so mongoose sees the assignment - but
  // marked anyway, for the same reason the image-prompt route marks it: a subdocument array is
  // the one path shape where "it saved the first time" is not proof that it always will.
  target.markModified('imagePrompts')

  await target.save()
  return target
}
