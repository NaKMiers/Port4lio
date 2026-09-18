import mongoose from 'mongoose'
import { NextResponse, type NextRequest } from 'next/server'

import { jsonError } from '@/lib/api-response'
import { renderMarkdown, BLOG_PIPELINE_VERSION } from '@/lib/blog/markdown'
import { revalidatePublishedPost } from '@/lib/blog/revalidate'
import { kindExists } from '@/lib/blog/kind-data'
import { seriesExists } from '@/lib/blog/series-data'
import { connectDatabase } from '@/lib/mongodb'
import { BLOG_SAVE_LIMIT, checkRateLimit, clientIpFrom } from '@/lib/rate-limit'
import { readJsonBody } from '@/lib/read-json-body'
import { requireOwner } from '@/lib/require-owner'
import {
  isReservedSlug,
  PostModel,
  SLUG_PATTERN,
  type PostDocument,
} from '@/models/Post'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** A post body can be long. 512KiB is well above any real post and well under the platform. */
const PATCH_MAX_BODY_BYTES = 512 * 1024

/**
 * [GET|PATCH|DELETE] /api/admin/blog/<id>
 *
 * ```
 *   PATCH
 *     requireOwner ──▶ 401
 *          ▼
 *     checkRateLimit(BLOG_SAVE_LIMIT)  ──▶ 429     autosave, not abuse - see rate-limit.ts
 *          ▼
 *     readJsonBody  ──▶ 413 / 400
 *          ▼
 *     transition rules   archived→draft     ──▶ 409
 *                        slug edit when published ──▶ 409
 *          ▼
 *     renderMarkdown ──▶ bodyHtml                  D9: at SAVE time, never in a request
 *          ▼
 *     save + stamp publishedAt ONCE
 *          ▼
 *     revalidatePublishedPost(slug)                NOT in a try/catch. See revalidate.ts
 * ```
 *
 * ## Why revalidation runs on every mutating verb
 *
 * PATCH and DELETE both, not just the publish transition. Wiring it to status changes alone
 * was the first plan and a control run disproved it twice: after a delete, `/blog/second`
 * still served its full HTML and the sitemap still listed it; after a content edit, the live
 * page kept the old text for the whole `revalidate` window with nothing indicating why.
 *
 * It also runs for a post that is currently a draft. That looks wasteful and is not: the
 * transition that matters is `published → archived`, where the post is no longer public but
 * `/blog/<slug>` is still cached as a 200. Deciding whether to invalidate based on the NEW
 * status would skip exactly that case. Invalidating a path that was never cached is free.
 */

type RouteContext = { params: Promise<{ id: string }> }

async function loadPost(id: string) {
  if (!mongoose.Types.ObjectId.isValid(id)) return null

  return PostModel.findById(id).select('+bodyMarkdown +bodyHtml')
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  const denied = requireOwner(request)
  if (denied) return denied

  try {
    await connectDatabase()
    const { id } = await params
    const post = await loadPost(id)

    if (!post) return jsonError('Post not found.', 404)

    // The editor needs the source, which no public read ever returns.
    return NextResponse.json({ post: post.toObject() })
  } catch (error) {
    console.error('[api/admin/blog/[id]] read failed', error)
    return jsonError('Unable to load the post right now.', 500)
  }
}

/** Fields the editor may set. Anything not listed here cannot be written through this route. */
type PatchBody = Partial<
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
    | 'tags'
    | 'relatedSlugs'
    | 'language'
    | 'status'
  >
>

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const denied = requireOwner(request)
  if (denied) return denied

  // connectDatabase first: `checkRateLimit` writes its counter to Mongo and fails OPEN on
  // error, so a limiter above the connect would wave everything through on a cold
  // invocation while looking like it was throttling. Same ordering as every other route.
  try {
    await connectDatabase()
  } catch (error) {
    console.error('[api/admin/blog/[id]] database unreachable', error)
    return jsonError('Unable to reach the database right now.', 503)
  }

  const limit = await checkRateLimit(clientIpFrom(request), BLOG_SAVE_LIMIT)
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'Saving too fast - the editor is retrying. Give it a moment.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
    )
  }

  const parsed = await readJsonBody<PatchBody>(request, { maxBytes: PATCH_MAX_BODY_BYTES })
  if (!parsed.ok) return jsonError(parsed.error, parsed.status)

  const body = parsed.body ?? {}

  try {
    const { id } = await params
    const post = await loadPost(id)
    if (!post) return jsonError('Post not found.', 404)

    /**
     * The slug guard, and the predicate is `publishedAt !== null`.
     *
     * NOT `status !== 'draft'`. That version unlocks the slug on `archived → draft`, for a
     * URL that was public, is indexed, and is in somebody's feed reader. `publishedAt` is
     * write-once, so it is the only field that records "this URL was public once", which is
     * the question actually being asked.
     */
    if (typeof body.slug === 'string' && body.slug !== post.slug) {
      if (post.publishedAt !== null) {
        return jsonError(
          'This post has been published, so its slug is frozen. Changing it would 404 every link and feed entry pointing at the old URL.',
          409
        )
      }
      if (!SLUG_PATTERN.test(body.slug)) {
        return jsonError('Slug must match ^[a-z0-9-]{1,80}$.', 400)
      }
      if (isReservedSlug(body.slug)) {
        return jsonError(`"${body.slug}" is reserved by a route and cannot be a post slug.`, 400)
      }

      const clash = await PostModel.findOne({ slug: body.slug }).select('_id').lean()
      if (clash) return jsonError(`The slug "${body.slug}" is already taken.`, 409)

      post.slug = body.slug
    }

    /**
     * `archived → draft` is refused.
     *
     * Every other transition in the state machine is reversible because none of them changes
     * what a slug means. This one would: draft is the state where a slug is editable, so
     * allowing it is allowing a published URL to be renamed by taking two steps instead of
     * one. The guard above would still catch the rename itself - `publishedAt` survives
     * archiving - so this is the second lock on the same door, and it fails with a reason
     * rather than letting the author reach a dead end.
     */
    if (body.status && body.status !== post.status) {
      if (post.status === 'archived' && body.status === 'draft') {
        return jsonError(
          'An archived post cannot go back to draft. Publish it again to make it live, or leave it archived - draft is the state where slugs are editable, and this URL has been public.',
          409
        )
      }
      if (body.status === 'deleted') {
        return jsonError('Use DELETE to remove a post.', 400)
      }

      post.status = body.status
    }

    // Content fields. Tracked so `contentUpdatedAt` moves only on a real change - see below.
    const beforeContent = {
      title: post.title,
      excerpt: post.excerpt,
      bodyMarkdown: post.bodyMarkdown,
      coverImage: post.coverImage,
      coverCaption: post.coverCaption,
    }

    if (typeof body.title === 'string') post.title = body.title.trim()
    if (typeof body.excerpt === 'string') post.excerpt = body.excerpt.trim()
    if (typeof body.bodyMarkdown === 'string') post.bodyMarkdown = body.bodyMarkdown
    if (body.coverImage === null || typeof body.coverImage === 'string') {
      post.coverImage = body.coverImage
    }
    if (typeof body.coverCaption === 'string') post.coverCaption = body.coverCaption
    /*
      Refuses an unknown kind rather than ignoring it - the same change, and the same
      reasoning, as `series` below. `Post.kind` has no schema enum any more, so this is the
      only thing between a post and a kind that was deleted out from under the editor tab
      that is saving. Silently dropping the value would report success and change nothing.
    */
    if (typeof body.kind === 'string') {
      if (!(await kindExists(body.kind))) {
        return jsonError(`"${body.kind}" is not a kind. It may have been deleted.`, 400)
      }
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
      if (!(await seriesExists(body.series))) {
        return jsonError(`"${body.series}" is not a series. It may have been deleted.`, 400)
      }
      post.series = body.series
    }
    if (typeof body.isPillar === 'boolean') post.isPillar = body.isPillar
    if (body.language === 'vi' || body.language === 'en') post.language = body.language
    if (Array.isArray(body.tags)) post.tags = body.tags
    if (Array.isArray(body.relatedSlugs)) post.relatedSlugs = body.relatedSlugs

    const contentChanged =
      post.title !== beforeContent.title ||
      post.excerpt !== beforeContent.excerpt ||
      post.bodyMarkdown !== beforeContent.bodyMarkdown ||
      post.coverImage !== beforeContent.coverImage ||
      // The caption is public text on /blog, so editing it is a real content change - the
      // sitemap should say so. It does NOT re-render the markdown: that has its own check on
      // `bodyMarkdown` below, and a credit line is not worth a Shiki pass.
      post.coverCaption !== beforeContent.coverCaption

    /**
     * Render at SAVE time (D9), and only when the source actually changed.
     *
     * Shiki costs a ~5.5 second bootstrap per process. In a request path that lands on the
     * first reader of every uncached post; here it lands on an author who is already waiting
     * for a save, and only when there is something new to render. `renderedWith` records
     * which pipeline version produced this HTML, so a future change to the renderer has a
     * way to find every post whose stored output is stale.
     */
    if (post.bodyMarkdown !== beforeContent.bodyMarkdown || post.renderedWith !== BLOG_PIPELINE_VERSION) {
      post.bodyHtml = await renderMarkdown(post.bodyMarkdown, post.slug)
      post.renderedWith = BLOG_PIPELINE_VERSION
    }

    /**
     * `contentUpdatedAt` moves only on real content change - NOT on every save.
     *
     * Autosave fires on a debounce, so `updatedAt` ticks while somebody is typing. If the
     * sitemap read that, it would claim all N posts changed several times a minute, which is
     * the cry-wolf failure `sitemap.ts` was rewritten to fix for the MBTI pages. A crawler
     * that learns the field lies stops using it, and then a post that genuinely changed gets
     * ignored too.
     */
    if (contentChanged) {
      post.contentUpdatedAt = new Date()
    }

    /**
     * `publishedAt` is stamped once and never reset.
     *
     * The re-publish path is why: archived → published must NOT move this date. Doing so
     * would rewrite the post's `datePublished` in JSON-LD and its `pubDate` in RSS, telling
     * every feed reader that a months-old post is new - and it would also unfreeze nothing,
     * since the slug guard reads this exact field.
     */
    if (post.status === 'published' && post.publishedAt === null) {
      post.publishedAt = new Date()
    }

    await post.save()

    // Not in a try/catch, deliberately - see `revalidate.ts`. Runs whatever the new status
    // is, because published → archived also needs the cached 200 cleared.
    revalidatePublishedPost(post.slug)

    return NextResponse.json({ ok: true, slug: post.slug, status: post.status })
  } catch (error) {
    if (error instanceof mongoose.Error.ValidationError) {
      return jsonError(error.message, 400)
    }
    if ((error as { code?: number }).code === 11000) {
      // The pillar index, almost always. Named, because "E11000 duplicate key" tells an
      // author nothing about which rule they hit.
      return jsonError(
        'That series already has a pillar post. A series can have at most one hub.',
        409
      )
    }
    console.error('[api/admin/blog/[id]] save failed', error)
    return jsonError('Unable to save the post right now.', 500)
  }
}

/**
 * Soft delete. The slug is retained forever.
 *
 * A hard delete frees the slug, because `{ slug: 1 }` is unique. A later post could then take
 * it and silently inherit the deleted post's contact attributions - `ContactMessage.sourceSlug`
 * is a string, and the blog's kill criterion is "at least one message carrying a slug". A
 * reused slug corrupts that single number in the direction of a false positive, which is the
 * worst direction for a metric whose job is to tell you whether to stop.
 */
export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const denied = requireOwner(request)
  if (denied) return denied

  try {
    await connectDatabase()
    const { id } = await params
    const post = await loadPost(id)
    if (!post) return jsonError('Post not found.', 404)

    post.status = 'deleted'
    await post.save()

    // S-17. A control run proved the gap: without this the deleted post still served and the
    // sitemap still listed it.
    revalidatePublishedPost(post.slug)

    return NextResponse.json({ ok: true, slug: post.slug })
  } catch (error) {
    console.error('[api/admin/blog/[id]] delete failed', error)
    return jsonError('Unable to delete the post right now.', 500)
  }
}
