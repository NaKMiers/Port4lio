import mongoose from 'mongoose'
import { NextResponse, type NextRequest } from 'next/server'

import { jsonError } from '@/lib/api-response'
import { renderMarkdown, BLOG_PIPELINE_VERSION } from '@/lib/blog/markdown'
import { normaliseImagePrompt } from '@/lib/blog/image-prompt'
import { MAX_IMAGE_PROMPTS } from '@/lib/blog/constants'
import { isAllowedImageUrl } from '@/lib/blog/rehype-restrict-image-hosts'
import { revalidatePublishedPost } from '@/lib/blog/revalidate'
import { kindExists } from '@/lib/blog/kind-data'
import { seriesExists } from '@/lib/blog/series-data'
import { connectDatabase } from '@/lib/mongodb'
import { BLOG_SAVE_LIMIT, checkRateLimit, clientIpFrom } from '@/lib/rate-limit'
import { readJsonBody } from '@/lib/read-json-body'
import { requireOwner } from '@/lib/require-owner'
import { ContactMessageModel } from '@/models/ContactMessage'
import { PostEventModel } from '@/models/PostEvent'
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
 *     checkRateLimit(BLOG_SAVE_LIMIT)  ──▶ 429     backstop, not abuse - see rate-limit.ts
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
    | 'coverImagePrompt'
    | 'imagePrompts'
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
  if (!limit.ok)
    return NextResponse.json(
      { error: 'Saving too fast - the editor is retrying. Give it a moment.' },
      {
        status: 429,
        headers: { 'Retry-After': String(limit.retryAfterSeconds) },
      }
    )

  const parsed = await readJsonBody<PatchBody>(request, {
    maxBytes: PATCH_MAX_BODY_BYTES,
  })
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
      if (post.publishedAt !== null)
        return jsonError(
          'This post has been published, so its slug is frozen. Changing it would 404 every link and feed entry pointing at the old URL.',
          409
        )

      if (!SLUG_PATTERN.test(body.slug))
        return jsonError('Slug must match ^[a-z0-9-]{1,80}$.', 400)

      if (isReservedSlug(body.slug))
        return jsonError(
          `"${body.slug}" is reserved by a route and cannot be a post slug.`,
          400
        )

      const clash = await PostModel.findOne({ slug: body.slug })
        .select('_id')
        .lean()
      if (clash)
        return jsonError(`The slug "${body.slug}" is already taken.`, 409)

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
        return jsonError(
          'An archived post cannot go back to draft. Publish it again to make it live, or leave it archived - draft is the state where slugs are editable, and this URL has been public.',
          409
        )

      if (body.status === 'deleted')
        return jsonError('Use DELETE to remove a post.', 400)

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
        return jsonError(
          'The cover image must be uploaded through this editor. An off-site URL is refused by the renderer and would leak every reader to a third party.',
          400
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
        return jsonError(
          `A post can carry at most ${MAX_IMAGE_PROMPTS} image prompts, and this save has ${body.imagePrompts.length}. Remove some placeholders from the body first.`,
          409
        )

      const malformed = body.imagePrompts.find(
        entry =>
          !entry ||
          typeof entry !== 'object' ||
          !/^image\d+$/.test(String((entry as { key?: unknown }).key ?? ''))
      )
      if (malformed !== undefined)
        return jsonError(
          'Every image prompt must be keyed to an "imageN" placeholder.',
          400
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
        return jsonError(
          `"${body.kind}" is not a kind. It may have been deleted.`,
          400
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
        return jsonError(
          `"${body.series}" is not a series. It may have been deleted.`,
          400
        )

      post.series = body.series
    }
    if (typeof body.isPillar === 'boolean') post.isPillar = body.isPillar
    if (body.language === 'vi' || body.language === 'en')
      post.language = body.language
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
    if (
      post.bodyMarkdown !== beforeContent.bodyMarkdown ||
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

    await post.save()

    // Not in a try/catch, deliberately - see `revalidate.ts`. Runs whatever the new status
    // is, because published → archived also needs the cached 200 cleared.
    revalidatePublishedPost(post.slug)

    return NextResponse.json({ ok: true, slug: post.slug, status: post.status })
  } catch (error) {
    if (error instanceof mongoose.Error.ValidationError)
      return jsonError(error.message, 400)

    if ((error as { code?: number }).code === 11000)
      // The pillar index, almost always. Named, because "E11000 duplicate key" tells an
      // author nothing about which rule they hit.
      return jsonError(
        'That series already has a pillar post. A series can have at most one hub.',
        409
      )

    console.error('[api/admin/blog/[id]] save failed', error)
    return jsonError('Unable to save the post right now.', 500)
  }
}

/**
 * Delete. Soft by default; `?permanent=true` removes the document and frees the slug.
 *
 * ```
 *   DELETE /api/admin/blog/<id>
 *        └─▶ status = 'deleted'          reversible, slug retained forever
 *
 *   DELETE /api/admin/blog/<id>?permanent=true
 *        ├─ status !== 'deleted'   ──▶ 409     must be soft-deleted FIRST
 *        ├─ ContactMessage rows    ──▶ 409 + count, unless &acknowledge=true
 *        ▼
 *     deleteOne() + PostEvent purge  ── irreversible, slug released
 * ```
 *
 * ## Why the soft delete retains the slug, and what a permanent delete therefore costs
 *
 * `{ slug: 1 }` is unique, so removing the document frees the slug. A later post can then take
 * it and silently inherit the deleted post's contact attributions: `ContactMessage.sourceSlug`
 * stores the slug as a string, and the blog's kill criterion is "at least one message carrying
 * a slug". A reused slug corrupts that single number in the direction of a false positive,
 * which is the worst direction for a metric whose job is to tell you whether to stop.
 *
 * That reasoning is why the soft delete exists and it is not weakened by adding this - it is
 * the thing this handler has to be honest about. Permanent delete is a real requirement (a
 * board that accumulates every mistake forever is a board nobody reads), so the hazard is
 * *surfaced* rather than prevented:
 *
 * 1. **The post must already be soft-deleted.** This is the actual lock. It makes a permanent
 *    delete impossible to reach by accident from a live post, whatever query string arrives,
 *    and it means the author has already passed one confirm before this is even offered.
 * 2. **A slug with contact messages against it refuses once**, returning the count. The refusal
 *    IS the warning - the same shape `DELETE /api/admin/blog/series/[id]` uses when a series is
 *    still in use. `&acknowledge=true` is the informed second press.
 *
 * ## What is removed and what is deliberately left
 *
 * `PostEvent` rows for the slug go with the post. They are view/share/attribute counters keyed
 * by slug with no reference to the document, so leaving them means a future post taking this
 * slug inherits its predecessor's read counts - the same misattribution, one instrument down.
 * They carry a TTL anyway, so this only brings forward an expiry that was already coming.
 *
 * `ContactMessage` rows are NOT touched, and that is not an oversight. They are messages real
 * people wrote to the owner; deleting somebody's mail because a blog post was tidied up is a
 * far worse outcome than a skewed metric. They keep their `sourceSlug` and the count above is
 * what tells the owner they exist.
 */
export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const denied = requireOwner(request)
  if (denied) return denied

  const permanent = request.nextUrl.searchParams.get('permanent') === 'true'
  const acknowledged =
    request.nextUrl.searchParams.get('acknowledge') === 'true'

  try {
    await connectDatabase()
    const { id } = await params
    const post = await loadPost(id)
    if (!post) return jsonError('Post not found.', 404)

    if (!permanent) {
      post.status = 'deleted'
      await post.save()

      // S-17. A control run proved the gap: without this the deleted post still served and the
      // sitemap still listed it.
      revalidatePublishedPost(post.slug)

      return NextResponse.json({ ok: true, slug: post.slug })
    }

    /*
      The lock, and it is a precondition rather than a confirmation dialog on the server.

      Requiring the post to be soft-deleted already means the destructive path cannot be
      reached in one call from any state a live post is in - not by a mistyped query string,
      not by a script, not by a stale tab holding a published post's id.
    */
    if (post.status !== 'deleted')
      return jsonError(
        'Delete the post first. Permanent removal is only available for a post that is already deleted.',
        409
      )

    const contactMessages = await ContactMessageModel.countDocuments({
      sourceSlug: post.slug,
    })
    if (contactMessages > 0 && !acknowledged)
      // Not an error the owner cannot pass - a number they have to see first. The client
      // re-sends with `acknowledge=true` after showing it.
      return NextResponse.json(
        {
          error: `${contactMessages} contact message${contactMessages === 1 ? '' : 's'} came from "${post.slug}". Releasing the slug means a future post taking it would inherit ${contactMessages === 1 ? 'that attribution' : 'those attributions'}.`,
          contactMessages,
        },
        { status: 409 }
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

    return NextResponse.json({
      ok: true,
      slug: post.slug,
      permanent: true,
      contactMessages,
      eventsRemoved: events.deletedCount ?? 0,
      unlinkedFrom: unlinked.modifiedCount ?? 0,
      revalidated,
    })
  } catch (error) {
    console.error('[api/admin/blog/[id]] delete failed', error)
    return jsonError('Unable to delete the post right now.', 500)
  }
}
