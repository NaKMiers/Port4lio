import 'server-only'

import crypto from 'node:crypto'

import mongoose from 'mongoose'

import { publishBlockers } from '@/lib/blog/auto-illustrate'
import { MAX_IMAGE_PROMPTS, POST_STATUSES } from '@/lib/blog/constants'
import { slugify } from '@/lib/blog/generate'
import { findImagePlaceholders } from '@/lib/blog/image-placeholders'
import { normaliseImagePrompt } from '@/lib/blog/image-prompt'
import { defaultKindSlug, kindExists } from '@/lib/blog/kind-data'
import { BLOG_PIPELINE_VERSION, renderMarkdown } from '@/lib/blog/markdown'
import { aggregatePostMetrics, type PostMetrics } from '@/lib/blog/post-events'
import { isAllowedImageUrl } from '@/lib/blog/rehype-restrict-image-hosts'
import { revalidatePublishedPost } from '@/lib/blog/revalidate'
import { seriesExists } from '@/lib/blog/series-data'
import { connectDatabase } from '@/lib/mongodb'
import { ContactMessageModel } from '@/models/ContactMessage'
import { PostEventModel } from '@/models/PostEvent'
import {
  isReservedSlug,
  PostModel,
  SLUG_PATTERN,
  type PostDocument,
  type PostIllustration,
  type PostStatus,
} from '@/models/Post'

/**
 * Every blog post write, and the reads that carry rules - one implementation for two front
 * doors (docs/designs/mcp/mcp.md premise 2).
 *
 * ```
 *   /api/admin/blog/**  ──┐                       ┌── /api/mcp tools (create_draft, update_post,
 *   (the editor, board)   ├──▶ post-service ◀─────┤    publish_post, list_posts, get_post, ...)
 *                         │      │                └── runTool has already checked the scope
 *                         │      ├─ transition rules  archived→draft once published ──▶ 409
 *                         │      │                    slug edit once published       ──▶ 409
 *                         │      ├─ live-post rule    agent edit of a published post needs publish;
 *                         │      │                    the result may hold no placeholder (R7)
 *                         │      ├─ render at save    renderMarkdown once, never per request (D9)
 *                         │      └─ revalidate        revalidatePublishedPost(slug), INSIDE (C8)
 *                         ▼
 *   the route keeps: requireOwner, the IP rate limit, readJsonBody, and turning a result into JSON
 * ```
 *
 * ## Why revalidation lives in here and not in the routes (C8)
 *
 * `generate-run.ts` is the template for "no auth, no body parsing inside" - but invalidation
 * is exactly the step a second front door would forget, and forgetting it fails silently: the
 * live page keeps the old text for the whole ISR window. So every mutating function below
 * calls `revalidatePublishedPost` itself, after its write succeeds, whatever the new status.
 * `published → archived` needs the cached 200 cleared, and invalidating a path that was never
 * cached is free (see the PATCH notes below, moved here verbatim from the route).
 *
 * ## Why the admin behaviour is byte for byte
 *
 * `patchPost`, `createBarePost` and the two deletes are the route bodies moved, with every
 * message and status unchanged, and `tests/api/blog-patch.test.ts`,
 * `blog-permanent-delete.test.ts` and friends pass against them unmodified. What is new is
 * additive: an optional `baseUpdatedAt` on PATCH (R9), and the agent-only operations at the
 * bottom, which reuse the same field rules through `applyEditorFields`.
 *
 * ## Why agent body edits are find/replace (R6)
 *
 * `get_post` pages a long body. An agent that read page 1 and saved "the whole body" would
 * silently drop the rest, and a version token cannot tell that apart from a real full edit.
 * An `edits: [{ find, replace }]` change can only touch text that is really there, so text the
 * agent never saw cannot vanish. A whole-body replace is allowed only when the post fits in
 * one page, with that body's `version`.
 */

// MARK: Results

export type ServiceFailure = {
  ok: false
  status: number
  error: string
  /** Extra JSON fields the route sends beside `error` (a count, a code). */
  extra?: Record<string, unknown>
}

export type ServiceResult<T> = { ok: true; value: T } | ServiceFailure

const failure = (
  status: number,
  error: string,
  extra?: Record<string, unknown>
): ServiceFailure => ({ ok: false, status, error, extra })

const success = <T>(value: T): ServiceResult<T> => ({ ok: true, value })

function isObjectId(id: string) {
  return mongoose.Types.ObjectId.isValid(id)
}

async function loadPost(id: string) {
  if (!isObjectId(id)) return null

  return PostModel.findById(id).select('+bodyMarkdown +bodyHtml')
}

/** The `Post.bodyMarkdown` schema cap. */
export const POST_BODY_MAX = 200_000

/** A body page for `get_post`: about 24k characters, so one page fits the response budget. */
export const POST_PAGE_CHARS = 24_000

/** The whole-body `version` an agent must send to replace a one-page body (R6). */
export function bodyVersion(bodyMarkdown: string): string {
  return crypto
    .createHash('sha256')
    .update(bodyMarkdown)
    .digest('hex')
    .slice(0, 16)
}

// MARK: The board and the editor (admin routes)

export type BoardPost = Record<string, unknown> & {
  unresolvedImages: number
  metrics: { views: number; shares: number; attributions: number }
}

/** `GET /api/admin/blog`: every status, newest edit first. */
export async function listBoardPosts(): Promise<BoardPost[]> {
  await connectDatabase()

  /*
    Both bodies are `select: false`, so the board cannot accidentally ship 30 posts' markdown
    to a browser that only renders their titles.

    `+bodyMarkdown` is pulled back in anyway, and ONLY to count unresolved placeholders before
    it is thrown away below. The board's Publish is a single click with no confirm, and it had
    no way to know a post still contained `![image](image1)` - which is the state EVERY
    generated post starts in. Publishing one puts a broken-image icon on a live page. The
    editor's banner was the only warning in the product and it lives on a page the author
    never has to open.

    The alternative was an aggregation with `$regexFindAll`, which keeps the markdown in the
    database but makes the count a second query that can fail independently of the list. Since
    the bodies are already on the same documents, reading and discarding them is simpler and
    cannot leave the board without a count.
  */
  const posts = await PostModel.find({})
    .select(
      'slug title kind series isPillar status language coverImage publishedAt contentUpdatedAt updatedAt +bodyMarkdown'
    )
    .sort({ updatedAt: -1 })
    .lean()

  /**
   * Metrics are joined here rather than left to the client, and failing to read them does
   * NOT fail the board.
   *
   * The board's job is to let the owner publish. Numbers are what it shows while doing
   * that, so a `postEvents` outage should cost the counts and nothing else - a board that
   * 500s because an aggregation failed is a board that cannot publish a post over a metric.
   */
  let metrics = new Map<
    string,
    { views: number; shares: number; attributions: number }
  >()
  try {
    metrics = await aggregatePostMetrics()
  } catch (error) {
    console.error(
      '[api/admin/blog] metrics unavailable - listing posts without them',
      error
    )
  }

  return posts.map(post => {
    // Destructured off so the markdown itself never reaches the browser - the count is the
    // only thing the board needs, and shipping the bodies would undo `select: false`.
    const { bodyMarkdown, ...rest } = post
    return {
      ...rest,
      unresolvedImages: findImagePlaceholders(bodyMarkdown ?? '').length,
      metrics: metrics.get(post.slug) ?? {
        views: 0,
        shares: 0,
        attributions: 0,
      },
    }
  })
}

/** `POST /api/admin/blog`: a bare draft from a slug and a title. */
export async function createBarePost(input: {
  slug?: unknown
  title?: unknown
}): Promise<ServiceResult<{ id: string; slug: string }>> {
  const slug = typeof input.slug === 'string' ? input.slug.trim() : ''
  const title = typeof input.title === 'string' ? input.title.trim() : ''

  if (!SLUG_PATTERN.test(slug))
    return failure(400, 'Slug must match ^[a-z0-9-]{1,80}$.')

  /**
   * The denylist is checked here as well as in the schema, and that duplication is wanted.
   *
   * The schema validator is the backstop that catches any write path - a script, a future
   * handler, a migration. This check is the one that produces a message an author can act
   * on, naming the slug and the rule, instead of a mongoose ValidationError surfaced as a
   * generic 400. Belt and braces, where the braces are also legible.
   */
  if (isReservedSlug(slug))
    return failure(
      400,
      `"${slug}" is reserved by a route and cannot be a post slug.`
    )

  if (!title) return failure(400, 'A title is required.')

  await connectDatabase()

  const existing = await PostModel.findOne({ slug })
    .select('slug status')
    .lean()
  if (existing) {
    // Named rather than generic, because the non-obvious case is a soft-deleted post still
    // holding the slug. An author who deleted something an hour ago and gets "already
    // taken" with no explanation will assume the delete failed.
    const because =
      existing.status === 'deleted'
        ? ' (a deleted post still holds this slug, so a new post cannot inherit its contact attributions)'
        : ''
    return failure(409, `The slug "${slug}" is already taken${because}.`)
  }

  /*
    `kind` is set here rather than left to a schema default. It used to be
    `default: 'note'`, which stopped being safe when the kind list became editable - see
    the field's comment in `models/Post.ts`. `defaultKindSlug` returns the first kind by
    order, and `DELETE /api/admin/blog/kinds/[id]` refuses to remove the last one, so the
    null branch is unreachable rather than merely unlikely.
  */
  const kind = await defaultKindSlug()
  if (!kind)
    return failure(
      409,
      'No post kinds exist. Create one before writing a post.'
    )

  const created = await PostModel.create({
    slug,
    title,
    kind,
    status: 'draft',
  })

  // No revalidation here on purpose: a draft has no public surface to invalidate.
  return success({ id: String(created._id), slug: created.slug })
}

/** `GET /api/admin/blog/<id>`: the source, which no public read ever returns. */
export async function loadEditorPost(id: string) {
  await connectDatabase()
  return loadPost(id)
}

/** Fields the editor may set. Anything not listed here cannot be written through PATCH. */
export type PatchBody = Partial<
  Pick<
    PostDocument,
    | 'slug'
    | 'title'
    | 'excerpt'
    | 'kind'
    | 'series'
    | 'isPillar'
    | 'bodyMarkdown'
    | 'coverImage'
    | 'coverCaption'
    | 'coverImagePrompt'
    | 'imagePrompts'
    | 'tags'
    | 'relatedSlugs'
    | 'language'
    | 'status'
  >
> & {
  /**
   * R9: the `updatedAt` the editor loaded. When present and stale, the save is a 409 and the
   * editor offers Reload / Overwrite anyway. Absent, the PATCH behaves exactly as before.
   */
  baseUpdatedAt?: unknown
}

type PostDoc = NonNullable<Awaited<ReturnType<typeof loadPost>>>

/**
 * Every non-status, non-slug field the editor can write, applied to a loaded document with
 * the route's own rules and messages. Shared by the admin PATCH and the agent's
 * `update_post`, so the two cannot drift. Returns a failure, or null once applied.
 */
async function applyEditorFields(
  post: PostDoc,
  body: PatchBody
): Promise<ServiceFailure | null> {
  if (typeof body.title === 'string') post.title = body.title.trim()
  if (typeof body.excerpt === 'string') post.excerpt = body.excerpt.trim()
  if (typeof body.bodyMarkdown === 'string')
    post.bodyMarkdown = body.bodyMarkdown
  /*
    The cover is the one image URL that reaches a reader WITHOUT passing the markdown
    pipeline, so the allowlist has to be applied here by hand.

    `rehypeRestrictImageHosts` guards every image in the body; the cover is rendered straight
    into an `<img src>` by the post page and the share card, so it went out unfiltered. That
    contradicts the promise the pipeline exists to keep - the plugin's own header says an
    off-host image "leaks every reader's IP and User-Agent to a third party ... on a page that
    promises no third-party anything". Owner-set, so this is a stale tab or a paste from the
    wrong tool rather than an attack, but the leak is identical either way.

    `null` still clears it. `isAllowedImageUrl` is the same predicate the renderer uses, so
    there is one definition of "an image we will serve".
  */
  if (body.coverImage === null) post.coverImage = null
  else if (typeof body.coverImage === 'string') {
    if (body.coverImage !== '' && !isAllowedImageUrl(body.coverImage))
      return failure(
        400,
        'The cover image must be uploaded through this editor. An off-site URL is refused by the renderer and would leak every reader to a third party.'
      )

    post.coverImage = body.coverImage
  }
  if (typeof body.coverCaption === 'string')
    post.coverCaption = body.coverCaption
  /*
    Image prompts, and note what is NOT below: neither of these is in `beforeContent`, so
    neither moves `contentUpdatedAt`.

    That is the same rule `coverCaption` is on the other side of, and the line between them
    is "does a reader see it". A caption is printed under the thumbnail, so editing one is a
    real content change the sitemap should report. A prompt is a note to the author about a
    picture that does not exist yet - it is never rendered anywhere - so bumping the
    document's freshness date for it would be telling crawlers the post changed when nothing
    a crawler can read did.
  */
  if (typeof body.coverImagePrompt === 'string')
    post.coverImagePrompt = normaliseImagePrompt(body.coverImagePrompt)

  if (Array.isArray(body.imagePrompts)) {
    /*
      Refused rather than truncated, and the key pattern is enforced.

      This used to `.slice(0, MAX_IMAGE_PROMPTS)` and return 200. The editor renders one card
      per placeholder found in the body and `findImagePlaceholders` has no cap, so a body with
      thirteen placeholders gave the author thirteen editable prompt cards - and the
      thirteenth was silently dropped on save, under a success banner. Silent data loss on the
      write path is the worst shape this can take: the author has no reason to look.

      `key` is checked against the placeholder pattern too. It was accepted on
      `typeof === 'string'` alone, so `''` passed the filter and then failed `required` at
      save, surfacing raw mongoose text like "Path `key` is required" to the client - and
      nothing bounded its length, so twelve 40KB keys were storable.
    */
    if (body.imagePrompts.length > MAX_IMAGE_PROMPTS)
      return failure(
        409,
        `A post can carry at most ${MAX_IMAGE_PROMPTS} image prompts, and this save has ${body.imagePrompts.length}. Remove some placeholders from the body first.`
      )

    const malformed = body.imagePrompts.find(
      entry =>
        !entry ||
        typeof entry !== 'object' ||
        !/^image\d+$/.test(String((entry as { key?: unknown }).key ?? ''))
    )
    if (malformed !== undefined)
      return failure(
        400,
        'Every image prompt must be keyed to an "imageN" placeholder.'
      )

    post.imagePrompts = (
      body.imagePrompts as { key: string; prompt: string }[]
    ).map(entry => ({
      key: entry.key,
      prompt: normaliseImagePrompt(entry.prompt),
    }))
  }
  /*
    Refuses an unknown kind rather than ignoring it - the same change, and the same
    reasoning, as `series` below. `Post.kind` has no schema enum any more, so this is the
    only thing between a post and a kind that was deleted out from under the editor tab
    that is saving. Silently dropping the value would report success and change nothing.
  */
  if (typeof body.kind === 'string') {
    if (!(await kindExists(body.kind)))
      return failure(
        400,
        `"${body.kind}" is not a kind. It may have been deleted.`
      )

    post.kind = body.kind
  }
  if (body.series === null) post.series = null
  /*
    The series list moved to a collection, so this is now the ONLY thing standing between a
    post and a dangling series reference - `Post.series` has no schema enum any more,
    because a mongoose enum is fixed at module load and the list is not. See the comment on
    the field in `models/Post.ts`.

    Refuses an unknown slug rather than ignoring it. The old code silently dropped a value
    that failed the `includes` check, which was survivable when the only writer was a
    `<select>` of three hardcoded options and is not now: a stale editor tab holding a
    series that has since been deleted would save "successfully" with the field quietly
    unchanged, and the author would have no way to tell.
  */
  if (typeof body.series === 'string') {
    if (!(await seriesExists(body.series)))
      return failure(
        400,
        `"${body.series}" is not a series. It may have been deleted.`
      )

    post.series = body.series
  }
  if (typeof body.isPillar === 'boolean') post.isPillar = body.isPillar
  if (body.language === 'vi' || body.language === 'en')
    post.language = body.language
  if (Array.isArray(body.tags)) post.tags = body.tags
  if (Array.isArray(body.relatedSlugs)) post.relatedSlugs = body.relatedSlugs

  return null
}

type ContentSnapshot = Pick<
  PostDocument,
  'title' | 'excerpt' | 'bodyMarkdown' | 'coverImage' | 'coverCaption'
>

const snapshotContent = (post: PostDoc): ContentSnapshot => ({
  title: post.title,
  excerpt: post.excerpt,
  bodyMarkdown: post.bodyMarkdown,
  coverImage: post.coverImage,
  coverCaption: post.coverCaption,
})

/**
 * Render if the source changed, and move `contentUpdatedAt` only on real content change.
 * Both notes below are the route's, moved with the code.
 */
async function renderAndStamp(post: PostDoc, before: ContentSnapshot) {
  const contentChanged =
    post.title !== before.title ||
    post.excerpt !== before.excerpt ||
    post.bodyMarkdown !== before.bodyMarkdown ||
    post.coverImage !== before.coverImage ||
    // The caption is public text on /blog, so editing it is a real content change - the
    // sitemap should say so. It does NOT re-render the markdown: that has its own check on
    // `bodyMarkdown` below, and a credit line is not worth a Shiki pass.
    post.coverCaption !== before.coverCaption

  /**
   * Render at SAVE time (D9), and only when the source actually changed.
   *
   * Shiki costs a ~5.5 second bootstrap per process. In a request path that lands on the
   * first reader of every uncached post; here it lands on an author who is already waiting
   * for a save, and only when there is something new to render. `renderedWith` records
   * which pipeline version produced this HTML, so a future change to the renderer has a
   * way to find every post whose stored output is stale.
   */
  if (
    post.bodyMarkdown !== before.bodyMarkdown ||
    post.renderedWith !== BLOG_PIPELINE_VERSION
  ) {
    post.bodyHtml = await renderMarkdown(post.bodyMarkdown, post.slug)
    post.renderedWith = BLOG_PIPELINE_VERSION
  }

  /**
   * `contentUpdatedAt` moves only on real content change - NOT on every save.
   *
   * A save is a manual click, but not every click changes the body: toggling a checkbox or
   * editing a tag lands here too, and `updatedAt` ticks regardless. If the sitemap read that
   * field, it would claim a post changed every time its author touched anything at all,
   * which is the cry-wolf failure `sitemap.ts` was rewritten to fix for the MBTI pages. A
   * crawler that learns the field lies stops using it, and then a post that genuinely
   * changed gets ignored too.
   */
  if (contentChanged) post.contentUpdatedAt = new Date()
}

/** A schema rejection or the pillar index, as the messages the route has always sent. */
function saveFailure(error: unknown): ServiceFailure | null {
  if (error instanceof mongoose.Error.ValidationError)
    return failure(400, error.message)

  if ((error as { code?: number }).code === 11000)
    // The pillar index, almost always. Named, because "E11000 duplicate key" tells an
    // author nothing about which rule they hit.
    return failure(
      409,
      'That series already has a pillar post. A series can have at most one hub.'
    )

  return null
}

/**
 * `PATCH /api/admin/blog/<id>`: the editor's save, and the one place status transitions
 * happen (`publishPost` and the agent's archive go through here too).
 */
export async function patchPost(
  id: string,
  body: PatchBody
): Promise<
  ServiceResult<{ slug: string; status: PostStatus; updatedAt: Date }>
> {
  await connectDatabase()
  const post = await loadPost(id)
  if (!post) return failure(404, 'Post not found.')

  /*
    R9: a stale editor tab. Checked before anything else so a refused save changes nothing.
    Only when the field is sent - a PATCH without it behaves exactly as it always has.
  */
  let base: Date | null = null
  if (body.baseUpdatedAt !== undefined) {
    base =
      typeof body.baseUpdatedAt === 'string'
        ? new Date(body.baseUpdatedAt)
        : null
    if (!base || Number.isNaN(base.getTime()))
      return failure(
        400,
        'baseUpdatedAt must be the updatedAt timestamp the editor loaded.'
      )
    if (base.getTime() !== new Date(post.updatedAt).getTime())
      return failure(
        409,
        'This post changed since you opened it - probably an agent edit. Reload to see it, or overwrite it with what you have.',
        { code: 'stale', updatedAt: new Date(post.updatedAt).toISOString() }
      )
  }

  /**
   * The slug guard, and the predicate is `publishedAt !== null`.
   *
   * NOT `status !== 'draft'`. That version unlocks the slug on `archived → draft`, for a
   * URL that was public, is indexed, and is in somebody's feed reader. `publishedAt` is
   * write-once, so it is the only field that records "this URL was public once", which is
   * the question actually being asked.
   */
  if (typeof body.slug === 'string' && body.slug !== post.slug) {
    if (post.publishedAt !== null)
      return failure(
        409,
        'This post has been published, so its slug is frozen. Changing it would 404 every link and feed entry pointing at the old URL.'
      )

    if (!SLUG_PATTERN.test(body.slug))
      return failure(400, 'Slug must match ^[a-z0-9-]{1,80}$.')

    if (isReservedSlug(body.slug))
      return failure(
        400,
        `"${body.slug}" is reserved by a route and cannot be a post slug.`
      )

    const clash = await PostModel.findOne({ slug: body.slug })
      .select('_id')
      .lean()
    if (clash) return failure(409, `The slug "${body.slug}" is already taken.`)

    post.slug = body.slug
  }

  /**
   * `archived → draft` is refused, but only for a post that was actually published once.
   *
   * The rule protects a slug, not a status. Draft is the state where a slug is editable, so
   * letting a formerly-public post walk back to draft is letting a published URL be renamed
   * in two steps instead of one. That reasoning needs `publishedAt`, and it used to key off
   * `status` alone - which was fine when the only way to reach `archived` was to publish
   * first, and wrong the moment generated posts started being CREATED archived.
   *
   * A generated post has `publishedAt: null`: its URL has never been public and its slug is
   * still freely editable (the rename guard above keys on `publishedAt`, not on status). So
   * the old message told the author their URL "has been public" about a slug nobody has ever
   * seen, and trapped every generated post out of the drafts list for a reason that did not
   * apply to it. Generated posts are now the largest population of archived posts, so the
   * narrow case became the common one.
   */
  if (body.status && body.status !== post.status) {
    if (
      post.status === 'archived' &&
      body.status === 'draft' &&
      post.publishedAt !== null
    )
      return failure(
        409,
        'An archived post cannot go back to draft. Publish it again to make it live, or leave it archived - draft is the state where slugs are editable, and this URL has been public.'
      )

    if (body.status === 'deleted')
      return failure(400, 'Use DELETE to remove a post.')

    post.status = body.status
  }

  // Content fields. Tracked so `contentUpdatedAt` moves only on a real change.
  const before = snapshotContent(post)

  const refused = await applyEditorFields(post, body)
  if (refused) return refused

  await renderAndStamp(post, before)

  /**
   * `publishedAt` is stamped once and never reset.
   *
   * The re-publish path is why: archived → published must NOT move this date. Doing so
   * would rewrite the post's `datePublished` in JSON-LD and its `pubDate` in RSS, telling
   * every feed reader that a months-old post is new - and it would also unfreeze nothing,
   * since the slug guard reads this exact field.
   */
  if (post.status === 'published' && post.publishedAt === null)
    post.publishedAt = new Date()

  try {
    if (base) {
      /*
        R9, the write half. The check above ran on the post as loaded; the render in between
        can take seconds, and an agent edit or an image patch landing then would be silently
        overwritten by a plain save. So a PATCH that sent a base writes only if updatedAt is
        STILL that base, and sets updatedAt itself, so the value the editor adopts as its next
        base is this write's own - never someone else's. No field: the plain save, as always.
      */
      await post.validate()
      const changes = post.getChanges() as Record<string, unknown> & {
        $set?: Record<string, unknown>
      }
      const now = new Date()
      const written = await PostModel.updateOne(
        { _id: post._id, updatedAt: base },
        { ...changes, $set: { ...(changes.$set ?? {}), updatedAt: now } },
        { runValidators: true, timestamps: false }
      )
      if (written.matchedCount === 0) {
        const current = await PostModel.findById(post._id)
          .select('updatedAt')
          .lean()
        return failure(
          409,
          'This post changed since you opened it - probably an agent edit. Reload to see it, or overwrite it with what you have.',
          {
            code: 'stale',
            updatedAt: current
              ? new Date(current.updatedAt).toISOString()
              : null,
          }
        )
      }
      post.updatedAt = now
    } else await post.save()
  } catch (error) {
    const known = saveFailure(error)
    if (known) return known
    throw error
  }

  // Not in a try/catch, deliberately - see `revalidate.ts`. Runs whatever the new status
  // is, because published → archived also needs the cached 200 cleared.
  revalidatePublishedPost(post.slug)

  return success({
    slug: post.slug,
    status: post.status,
    updatedAt: post.updatedAt,
  })
}

/** `DELETE /api/admin/blog/<id>`: soft. The slug is retained forever. */
export async function softDeletePost(
  id: string
): Promise<ServiceResult<{ slug: string }>> {
  await connectDatabase()
  const post = await loadPost(id)
  if (!post) return failure(404, 'Post not found.')

  post.status = 'deleted'
  await post.save()

  // S-17. A control run proved the gap: without this the deleted post still served and the
  // sitemap still listed it.
  revalidatePublishedPost(post.slug)

  return success({ slug: post.slug })
}

/**
 * `DELETE /api/admin/blog/<id>?permanent=true`: remove the document and free the slug. The
 * owner's editor only; never exposed to an agent (mcp.md premise 3: permanent purge is never
 * exposed). The reasoning below is the route's, moved with the code.
 */
export async function permanentDeletePost(
  id: string,
  { acknowledged }: { acknowledged: boolean }
): Promise<
  ServiceResult<{
    slug: string
    contactMessages: number
    eventsRemoved: number
    unlinkedFrom: number
    revalidated: boolean
  }>
> {
  await connectDatabase()
  const post = await loadPost(id)
  if (!post) return failure(404, 'Post not found.')

  /*
    The lock, and it is a precondition rather than a confirmation dialog on the server.

    Requiring the post to be soft-deleted already means the destructive path cannot be
    reached in one call from any state a live post is in - not by a mistyped query string,
    not by a script, not by a stale tab holding a published post's id.
  */
  if (post.status !== 'deleted')
    return failure(
      409,
      'Delete the post first. Permanent removal is only available for a post that is already deleted.'
    )

  const contactMessages = await ContactMessageModel.countDocuments({
    sourceSlug: post.slug,
  })
  if (contactMessages > 0 && !acknowledged)
    // Not an error the owner cannot pass - a number they have to see first. The client
    // re-sends with `acknowledge=true` after showing it.
    return failure(
      409,
      `${contactMessages} contact message${contactMessages === 1 ? '' : 's'} came from "${post.slug}". Releasing the slug means a future post taking it would inherit ${contactMessages === 1 ? 'that attribution' : 'those attributions'}.`,
      { contactMessages }
    )

  /*
    Order matters, and it is post-first.

    The reverse - events, then the post - loses the metrics of a post that survives if
    `deleteOne` then fails, and the catch below reports that as "unable to delete the post
    right now", which reads as "nothing happened". Deleting the post first means the only
    failure that can strand anything leaves behind orphan `PostEvent` rows for a slug with no
    document, which the sweep below would otherwise have removed and which no read path joins
    on. There is no transaction because the deployment target is a single replica set without
    one configured; this ordering is what makes that acceptable.
  */
  await post.deleteOne()

  const events = await PostEventModel.deleteMany({ slug: post.slug })

  /*
    The last reference to this slug anywhere in the database.

    `PostEvent.slug` and `ContactMessage.sourceSlug` were both accounted for from the start;
    `relatedSlugs` on OTHER posts was not, and it is the same hazard. Those links resolve to
    nothing while the slug is unused - but a permanent delete RELEASES the slug, so a future
    post taking it silently inherits editorial "related" links that were pointing at the post
    that used to be there. That is precisely the reuse problem the ContactMessage warning
    above exists to explain, one relation over.

    `$pull` rather than a read-modify-write: it is one statement, it is atomic per document,
    and it cannot lose a concurrent edit to the same array.
  */
  const unlinked = await PostModel.updateMany(
    { relatedSlugs: post.slug },
    { $pull: { relatedSlugs: post.slug } }
  )

  /*
    Revalidation is the LAST thing and it cannot fail the response.

    A permanently deleted post was very likely published once, and the cached 200 at its path
    outlives the document unless this clears it - so it has to run. But by this point the
    document is already gone, and letting a `revalidatePath` throw fall into the catch below
    would answer "unable to delete the post right now" for a delete that has committed. The
    author would retry, get a 404, and have no idea which of the two was true.

    Logged rather than swallowed, and reported in the payload, so a stale page is visible as a
    stale page instead of as nothing.
  */
  let revalidated = true
  try {
    revalidatePublishedPost(post.slug)
  } catch (error) {
    revalidated = false
    console.error(
      '[api/admin/blog/[id]] purged but could not revalidate',
      error
    )
  }

  return success({
    slug: post.slug,
    contactMessages,
    eventsRemoved: events.deletedCount ?? 0,
    unlinkedFrom: unlinked.modifiedCount ?? 0,
    revalidated,
  })
}

// MARK: Agent operations (the MCP front door)

/** Letters or digits survive `slugify`'s folding, so the slug is not its `post` fallback. */
function hasSluggableText(title: string) {
  return /[a-z0-9]/.test(
    title.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd')
  )
}

export interface DraftInput {
  title: string
  bodyMarkdown: string
  excerpt?: string
  kind?: string
  series?: string | null
  language?: 'vi' | 'en'
  slug?: string
  coverImagePrompt?: string
  imagePrompts?: { key: string; prompt: string }[]
  tags?: string[]
}

/**
 * `create_draft`: validate every field and render the markdown BEFORE a single insert, so a
 * failure leaves no post behind holding a slug (C9). The slug is the one given, or derived
 * with the same `slugify` + `SLUG_PATTERN` + `isReservedSlug` that `validateManualSpec` uses.
 * Never publishes.
 */
export async function createDraft(
  input: DraftInput
): Promise<ServiceResult<{ id: string; slug: string }>> {
  const title = input.title.trim()
  if (!title) return failure(400, 'A title is required.')
  if (title.length > 140)
    return failure(400, 'The title is longer than 140 characters.')

  let slug = input.slug?.trim() ?? ''
  if (slug) {
    if (!SLUG_PATTERN.test(slug))
      return failure(400, 'Slug must match ^[a-z0-9-]{1,80}$.')
  } else {
    if (!hasSluggableText(title))
      return failure(
        400,
        'The title has no letters or digits to build a slug from. Pass a slug.'
      )
    slug = slugify(title)
  }
  if (isReservedSlug(slug))
    return failure(
      400,
      `"${slug}" is reserved by a route and cannot be a post slug. Pass a different slug.`
    )

  if ((input.excerpt ?? '').trim().length > 300)
    return failure(400, 'The excerpt is longer than 300 characters.')

  const prompts = input.imagePrompts ?? []
  if (prompts.length > MAX_IMAGE_PROMPTS)
    return failure(
      409,
      `A post can carry at most ${MAX_IMAGE_PROMPTS} image prompts, and this draft has ${prompts.length}.`
    )
  if (prompts.some(entry => !/^image\d+$/.test(entry.key)))
    return failure(
      400,
      'Every image prompt must be keyed to an "imageN" placeholder.'
    )

  await connectDatabase()

  const clash = await PostModel.findOne({ slug }).select('status').lean()
  if (clash)
    return failure(
      409,
      `The slug "${slug}" is already taken${clash.status === 'deleted' ? ' by a deleted post, which holds it forever' : ''}. Try "${slug.slice(0, 78)}-2", or pass another slug.`
    )

  let kind = input.kind
  if (kind) {
    if (!(await kindExists(kind)))
      return failure(400, `"${kind}" is not a kind. Call list_taxonomy.`)
  } else {
    kind = (await defaultKindSlug()) ?? undefined
    if (!kind) return failure(409, 'No post kinds exist.')
  }

  // `||`, not `??`: an empty string is "no series", as `update_post` and the editor PATCH
  // treat it - `seriesExists('')` is false there, and a stored '' matches no series.
  const series = input.series || null
  if (series && !(await seriesExists(series)))
    return failure(400, `"${series}" is not a series. Call list_taxonomy.`)

  const bodyHtml = await renderMarkdown(input.bodyMarkdown, slug)

  try {
    const created = await PostModel.create({
      slug,
      title,
      excerpt: (input.excerpt ?? '').trim(),
      kind,
      series,
      ...(input.language ? { language: input.language } : {}),
      bodyMarkdown: input.bodyMarkdown,
      bodyHtml,
      renderedWith: BLOG_PIPELINE_VERSION,
      coverImagePrompt: normaliseImagePrompt(input.coverImagePrompt ?? ''),
      imagePrompts: prompts.map(entry => ({
        key: entry.key,
        prompt: normaliseImagePrompt(entry.prompt),
      })),
      tags: input.tags ?? [],
      status: 'draft',
    })
    // No revalidation: a draft has no public surface to invalidate.
    return success({ id: String(created._id), slug: created.slug })
  } catch (error) {
    if ((error as { code?: number }).code === 11000)
      return failure(
        409,
        `The slug "${slug}" was taken a moment ago. Try "${slug.slice(0, 78)}-2".`
      )
    const known = saveFailure(error)
    if (known) return known
    throw error
  }
}

export interface ListPostsQuery {
  status?: PostStatus[]
  kind?: string
  series?: string
  publishedFrom?: Date
  publishedTo?: Date
  query?: string
  sort?: 'publishedAt' | 'updatedAt' | 'views'
  order?: 'asc' | 'desc'
  cursor?: string
  limit?: number
}

export interface ListedPost {
  id: string
  slug: string
  title: string
  status: PostStatus
  kind: string
  series: string | null
  language: 'vi' | 'en'
  publishedAt: string | null
  updatedAt: string
  views: number
  shares: number
  attributions: number
}

const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function readCursor(cursor: string | undefined): number {
  if (!cursor) return 0
  try {
    const offset = Number(
      JSON.parse(Buffer.from(cursor, 'base64url').toString()).o
    )
    return Number.isInteger(offset) && offset >= 0 ? offset : 0
  } catch {
    return 0
  }
}

/**
 * `list_posts`: filters, a text query, sort by date or by views, and a cursor.
 *
 * Views are documents in `PostEvent`, which keeps 180 days, so the counts are "in the last
 * 180 days" and say so. Sorting by views needs every matching row's count, so the filtered
 * set is read whole and paged in memory - fine at this blog's size (hundreds of posts), and
 * the `{ status: 1, publishedAt: -1 }` index serves the filter.
 */
export async function listPosts(query: ListPostsQuery): Promise<{
  items: ListedPost[]
  total: number
  nextCursor: string | null
}> {
  await connectDatabase()

  const filter: Record<string, unknown> = {
    status: {
      $in: query.status?.length
        ? query.status
        : POST_STATUSES.filter(status => status !== 'deleted'),
    },
  }
  if (query.kind) filter.kind = query.kind
  if (query.series) filter.series = query.series
  if (query.publishedFrom || query.publishedTo)
    filter.publishedAt = {
      ...(query.publishedFrom ? { $gte: query.publishedFrom } : {}),
      ...(query.publishedTo ? { $lte: query.publishedTo } : {}),
    }
  if (query.query?.trim()) {
    const pattern = new RegExp(escapeRegex(query.query.trim()), 'i')
    filter.$or = [{ title: pattern }, { excerpt: pattern }, { slug: pattern }]
  }

  const [posts, metrics] = await Promise.all([
    PostModel.find(filter)
      .select('slug title status kind series language publishedAt updatedAt')
      .lean(),
    aggregatePostMetrics().catch((error: unknown) => {
      console.error('[post-service] metrics unavailable', error)
      return new Map<string, PostMetrics>()
    }),
  ])

  const sort = query.sort ?? 'updatedAt'
  const direction = query.order === 'asc' ? 1 : -1
  const keyOf = (post: (typeof posts)[number]) =>
    sort === 'views'
      ? (metrics.get(post.slug)?.views ?? 0)
      : sort === 'publishedAt'
        ? (post.publishedAt?.getTime() ?? 0)
        : post.updatedAt.getTime()
  // `_id` breaks ties (views 0, never published), so an offset cursor never skips or repeats.
  posts.sort(
    (a, b) =>
      (keyOf(a) - keyOf(b)) * direction ||
      String(a._id).localeCompare(String(b._id))
  )

  const limit = Math.min(25, Math.max(1, query.limit ?? 20))
  const offset = readCursor(query.cursor)
  const page = posts.slice(offset, offset + limit)
  const next = offset + page.length

  return {
    total: posts.length,
    nextCursor:
      next < posts.length
        ? Buffer.from(JSON.stringify({ o: next })).toString('base64url')
        : null,
    items: page.map(post => {
      const counts = metrics.get(post.slug)
      return {
        id: String(post._id),
        slug: post.slug,
        title: post.title,
        status: post.status,
        kind: post.kind,
        series: post.series ?? null,
        language: post.language,
        publishedAt: post.publishedAt ? post.publishedAt.toISOString() : null,
        updatedAt: post.updatedAt.toISOString(),
        views: counts?.views ?? 0,
        shares: counts?.shares ?? 0,
        attributions: counts?.attributions ?? 0,
      }
    }),
  }
}

/** A run that will publish the post when it is whole (the cron) holds a live lease. */
export function publishingRunHolds(
  illustration: PostIllustration | undefined,
  now = new Date()
): boolean {
  return Boolean(
    illustration?.state === 'running' &&
    illustration.publishing &&
    illustration.leaseUntil &&
    illustration.leaseUntil.getTime() >= now.getTime()
  )
}

/** The refusal an agent gets while `publishingRunHolds`. */
export const PUBLISHING_RUN_REFUSAL =
  "The daily job is drawing this post's images and will publish it when they are in, so it cannot be changed by an agent until that run finishes (a few minutes; get_post shows illustration idle). Nothing was changed."

export interface IllustrationStatus {
  state: 'idle' | 'running' | 'failed'
  remaining: number
  lastError: string | null
}

/** A run whose lease ran out never reported back: the platform killed it (R2, R3). */
export function illustrationStatus(
  illustration: PostIllustration | undefined,
  now = new Date()
): IllustrationStatus {
  if (!illustration) return { state: 'idle', remaining: 0, lastError: null }
  if (
    illustration.state === 'running' &&
    illustration.leaseUntil &&
    illustration.leaseUntil.getTime() < now.getTime()
  )
    return {
      state: 'failed',
      remaining: illustration.remaining,
      lastError:
        'The image run was cut off before it finished (the function timed out). Call illustrate_post again to draw the rest.',
    }
  return {
    state: illustration.state,
    remaining: illustration.remaining,
    lastError: illustration.lastError ?? null,
  }
}

export interface PostPage {
  id: string
  slug: string
  title: string
  excerpt: string
  status: PostStatus
  kind: string
  series: string | null
  language: 'vi' | 'en'
  coverImage: string | null
  coverImagePrompt: string
  imagePrompts: { key: string; prompt: string }[]
  tags: string[]
  publishedAt: string | null
  updatedAt: string
  placeholders: { key: string; alt: string; hasPrompt: boolean }[]
  metrics: { views: number; shares: number; attributions: number }
  illustration: IllustrationStatus
  body: {
    markdown: string
    offset: number
    nextOffset: number | null
    complete: boolean
    totalChars: number
  }
  version: string
}

/** `get_post`: by id or slug, the body in pages of about 24k characters (R6, C10). */
export async function readPostPage(
  ref: { id?: string; slug?: string },
  offset = 0
): Promise<PostPage | null> {
  await connectDatabase()
  const post = ref.id
    ? isObjectId(ref.id)
      ? await PostModel.findById(ref.id).select('+bodyMarkdown').lean()
      : null
    : ref.slug
      ? await PostModel.findOne({ slug: ref.slug })
          .select('+bodyMarkdown')
          .lean()
      : null
  if (!post || post.status === 'deleted') return null

  const bodyMarkdown = post.bodyMarkdown ?? ''
  const start = Math.min(Math.max(0, offset), bodyMarkdown.length)
  let end = Math.min(bodyMarkdown.length, start + POST_PAGE_CHARS)
  // End a page on a line break when there is one in the second half, so an agent never reads
  // a sentence split across two pages.
  if (end < bodyMarkdown.length) {
    const lineBreak = bodyMarkdown.lastIndexOf('\n', end)
    if (lineBreak > start + POST_PAGE_CHARS / 2) end = lineBreak + 1
  }

  let metrics = { views: 0, shares: 0, attributions: 0 }
  try {
    const counts = (await aggregatePostMetrics()).get(post.slug)
    if (counts)
      metrics = {
        views: counts.views,
        shares: counts.shares,
        attributions: counts.attributions,
      }
  } catch (error) {
    console.error('[post-service] metrics unavailable', error)
  }

  const prompts = new Set(post.imagePrompts.map(entry => entry.key))
  return {
    id: String(post._id),
    slug: post.slug,
    title: post.title,
    excerpt: post.excerpt,
    status: post.status,
    kind: post.kind,
    series: post.series ?? null,
    language: post.language,
    coverImage: post.coverImage,
    coverImagePrompt: post.coverImagePrompt,
    imagePrompts: post.imagePrompts.map(({ key, prompt }) => ({ key, prompt })),
    tags: post.tags,
    publishedAt: post.publishedAt ? post.publishedAt.toISOString() : null,
    updatedAt: post.updatedAt.toISOString(),
    placeholders: findImagePlaceholders(bodyMarkdown).map(placeholder => ({
      ...placeholder,
      hasPrompt: prompts.has(placeholder.key),
    })),
    metrics,
    illustration: illustrationStatus(post.illustration),
    body: {
      markdown: bodyMarkdown.slice(start, end),
      offset: start,
      nextOffset: end < bodyMarkdown.length ? end : null,
      complete: end >= bodyMarkdown.length,
      totalChars: bodyMarkdown.length,
    },
    version: bodyVersion(bodyMarkdown),
  }
}

export interface AgentPostUpdate {
  title?: string
  excerpt?: string
  kind?: string
  series?: string | null
  language?: 'vi' | 'en'
  tags?: string[]
  coverCaption?: string
  coverImagePrompt?: string
  imagePrompts?: { key: string; prompt: string }[]
  edits?: { find: string; replace: string }[]
  bodyMarkdown?: string
  version?: string
}

/** Apply find/replace edits: each `find` must match the current body exactly once (R6). */
export function applyEdits(
  body: string,
  edits: readonly { find: string; replace: string }[]
): { ok: true; body: string } | { ok: false; error: string } {
  let next = body
  for (const [index, { find, replace }] of edits.entries()) {
    if (!find)
      return { ok: false, error: `Edit ${index + 1} has an empty find.` }
    const first = next.indexOf(find)
    if (first === -1)
      return {
        ok: false,
        error: `Edit ${index + 1}: the find text is not in the current body, so nothing was changed. Re-read the post with get_post and copy the text exactly. find: ${JSON.stringify(find.slice(0, 120))}`,
      }
    if (next.indexOf(find, first + 1) !== -1)
      return {
        ok: false,
        error: `Edit ${index + 1}: the find text appears more than once, so it is ambiguous and nothing was changed. Include more surrounding text. find: ${JSON.stringify(find.slice(0, 120))}`,
      }
    next = next.slice(0, first) + replace + next.slice(first + find.length)
  }
  return { ok: true, body: next }
}

/**
 * `update_post`: text fields, kind/series and body edits. Never `status` - only publish,
 * archive and delete change a post's status (mcp.md "The live-post rule").
 *
 * ```
 *   load ──▶ deleted? 404 ──▶ live && !canEditLive ──▶ refused (publish scope)
 *        ──▶ a publishing run (the cron) holds the lease ──▶ refused (see illustrate-run.ts)
 *        ──▶ body: edits (each find exactly once) | whole body (one page + version + 50% guard)
 *        ──▶ live && unresolved placeholder in the result ──▶ refused (R7)
 *        ──▶ the editor's own field rules ──▶ render ──▶ save IF updatedAt unchanged
 *        ──▶ revalidatePublishedPost(slug)
 * ```
 *
 * The save is conditional on the `updatedAt` read at the start. A render can take seconds
 * (Shiki), and an illustration image patched in meanwhile would otherwise be overwritten
 * by this whole-document write. A lost race is a refusal that tells the agent to re-read.
 */
export async function updatePostAsAgent(
  id: string,
  input: AgentPostUpdate,
  { canEditLive }: { canEditLive: boolean }
): Promise<
  ServiceResult<{
    id: string
    slug: string
    status: PostStatus
    bodyChanged: boolean
    version: string
  }>
> {
  await connectDatabase()
  const post = await loadPost(id)
  if (!post || post.status === 'deleted') return failure(404, 'Post not found.')

  const live = post.status === 'published'
  if (live && !canEditLive)
    return failure(
      403,
      'This post is published, so changing it changes the live site, which needs the publish scope. This token does not have it. Nothing was changed.',
      { reason: 'live-post' }
    )

  // A run claimed after this read is caught by the conditional save's filter below.
  if (publishingRunHolds(post.illustration))
    return failure(409, PUBLISHING_RUN_REFUSAL, { reason: 'conflict' })

  if (input.edits?.length && input.bodyMarkdown !== undefined)
    return failure(400, 'Send edits or bodyMarkdown, not both.')

  const current = post.bodyMarkdown
  let nextBody = current
  if (input.edits?.length) {
    const edited = applyEdits(current, input.edits)
    if (!edited.ok) return failure(400, edited.error)
    nextBody = edited.body
  } else if (input.bodyMarkdown !== undefined) {
    if (current.length > POST_PAGE_CHARS)
      return failure(
        400,
        `This post is ${current.length} characters, more than one page (${POST_PAGE_CHARS}), so its body can only be changed with edits: [{ find, replace }]. Nothing was changed.`
      )
    if (input.version !== bodyVersion(current))
      return failure(
        409,
        'The version does not match the current body - it changed since you read it, or no version was sent. Re-read with get_post and retry. Nothing was changed.',
        { reason: 'conflict' }
      )
    if (input.bodyMarkdown.length < current.length * 0.5)
      return failure(
        400,
        'The new body is less than half the length of the current one. If that is really intended, make the cuts with edits: [{ find, replace }] so each removal is explicit. Nothing was changed.'
      )
    nextBody = input.bodyMarkdown
  }

  // Before the render: 50 edits can grow a body far past the schema's cap, and Shiki would
  // chew through all of it only for `validate` to refuse it afterwards.
  if (nextBody.length > POST_BODY_MAX)
    return failure(
      400,
      `The result would be ${nextBody.length} characters, over the ${POST_BODY_MAX}-character limit for a post body. Nothing was changed.`
    )

  if (live) {
    const unresolved = findImagePlaceholders(nextBody)
    if (unresolved.length > 0)
      return failure(
        400,
        `This post is live, and the result would hold an unfilled image placeholder (${unresolved.map(entry => entry.key).join(', ')}), which readers would see as a broken image. Generate the image first (generate_image returns a URL), then insert it with an edit as ![alt](url). Nothing was changed.`,
        { reason: 'live-post' }
      )
  }

  const loadedUpdatedAt = post.updatedAt
  const before = snapshotContent(post)
  const refused = await applyEditorFields(post, {
    title: input.title,
    excerpt: input.excerpt,
    kind: input.kind,
    series: input.series,
    language: input.language,
    tags: input.tags,
    coverCaption: input.coverCaption,
    coverImagePrompt: input.coverImagePrompt,
    imagePrompts: input.imagePrompts,
    bodyMarkdown: nextBody,
  })
  if (refused) return refused

  await renderAndStamp(post, before)

  try {
    await post.validate()
    const changes = post.getChanges()
    if (Object.keys(changes).length > 0) {
      const saved = await PostModel.updateOne(
        {
          _id: post._id,
          updatedAt: loadedUpdatedAt,
          // D8, again at the write: a publishing run claimed after the read above does not
          // move updatedAt (its bookkeeping writes skip timestamps), so it is filtered here.
          $or: [
            { 'illustration.state': { $ne: 'running' as const } },
            { 'illustration.publishing': { $ne: true } },
            { 'illustration.leaseUntil': { $lt: new Date() } },
          ],
        },
        changes,
        { runValidators: true }
      )
      if (saved.matchedCount === 0)
        return failure(
          409,
          'The post changed while this edit was being applied (an image run or the owner saved it). Re-read it with get_post and retry. Nothing was changed.',
          { reason: 'conflict' }
        )
    }
  } catch (error) {
    const known = saveFailure(error)
    if (known) return known
    throw error
  }

  revalidatePublishedPost(post.slug)

  return success({
    id: String(post._id),
    slug: post.slug,
    status: post.status,
    bodyChanged: nextBody !== current,
    version: bodyVersion(nextBody),
  })
}

/**
 * `publish_post`: draft or archived to published, only once `publishBlockers` is empty - the
 * same bar the illustration run uses, so nothing goes public with a placeholder in it.
 */
export async function publishPost(
  id: string
): Promise<ServiceResult<{ slug: string; alreadyPublished: boolean }>> {
  await connectDatabase()
  // The blockers are checked on one read and the status written conditionally on that
  // read's updatedAt (patchPost's R9 path), so a placeholder added in between cannot go live
  // unchecked: the write misses, and the post is read and checked again.
  for (let attempt = 0; attempt < PUBLISH_ATTEMPTS; attempt += 1) {
    const post = await loadPost(id)
    if (!post || post.status === 'deleted')
      return failure(404, 'Post not found.')
    if (post.status === 'published')
      return success({ slug: post.slug, alreadyPublished: true })

    const blockers = publishBlockers({
      title: post.title,
      bodyMarkdown: post.bodyMarkdown,
      coverImage: post.coverImage,
    })
    if (blockers.length > 0)
      return failure(
        409,
        `Not published: ${blockers.join('; ')}. Fix that first (illustrate_post or generate_image for images), then call publish_post again.`,
        { reason: 'blocked' }
      )

    const result = await patchPost(id, {
      status: 'published',
      baseUpdatedAt: new Date(post.updatedAt).toISOString(),
    })
    if (result.ok)
      return success({ slug: result.value.slug, alreadyPublished: false })
    if (result.extra?.code !== 'stale') return result
  }
  return failure(
    409,
    'The post kept changing while it was being published. Re-read it with get_post and call publish_post again.',
    { reason: 'conflict' }
  )
}

const PUBLISH_ATTEMPTS = 3

/**
 * `archive_post`: take a live post off the site, or bring an archived one back (C11).
 *
 * Unarchive goes through `patchPost`'s own transition rules, so nothing new is decided here:
 * a post that was never public (`publishedAt: null`, like every generated post) goes back to
 * draft; one that was public is refused with the route's own message, and `publish_post` -
 * which allows archived to published without moving `publishedAt` - is the way back.
 */
export async function archivePost(
  id: string,
  action: 'archive' | 'unarchive'
): Promise<ServiceResult<{ slug: string; status: PostStatus }>> {
  await connectDatabase()
  const post = await loadPost(id)
  if (!post || post.status === 'deleted') return failure(404, 'Post not found.')

  if (action === 'archive') {
    if (post.status === 'archived')
      return success({ slug: post.slug, status: post.status })
    const result = await patchPost(id, { status: 'archived' })
    if (!result.ok) return result
    return success({ slug: result.value.slug, status: result.value.status })
  }

  if (post.status !== 'archived')
    return failure(409, `This post is ${post.status}, not archived.`)
  const result = await patchPost(id, { status: 'draft' })
  if (!result.ok)
    return failure(
      result.status,
      `${result.error} Use publish_post to make it live again.`,
      {
        reason: 'conflict',
      }
    )
  return success({ slug: result.value.slug, status: result.value.status })
}
