import 'server-only'

import { after } from 'next/server'
import { z } from 'zod'

import { COVER_KEY } from '@/lib/blog/auto-illustrate'
import { POST_STATUSES } from '@/lib/blog/constants'
import { IMAGE_MODEL_OPTIONS } from '@/lib/blog/generation-fields'
import { ImageGenError } from '@/lib/blog/image-gen'
import {
  generateImageUrl,
  patchImageIntoPost,
  writeImagePrompt,
} from '@/lib/blog/image-service'
import {
  claimIllustration,
  plannedImages,
  runIllustration,
} from '@/lib/blog/illustrate-run'
import { listKindsWithCounts } from '@/lib/blog/kind-data'
import { lintDraft } from '@/lib/blog/lint-draft'
import { LlmError } from '@/lib/blog/llm'
import {
  archivePost,
  createDraft,
  listPosts,
  publishPost,
  readPostPage,
  updatePostAsAgent,
  type ServiceFailure,
} from '@/lib/blog/post-service'
import { listSeriesWithCounts } from '@/lib/blog/series-data'
import { buildWritingBrief, STRUCTURE_NAMES } from '@/lib/blog/writing-brief'
import { defineTool, ok, refuse, type ToolResult } from '@/lib/mcp/run-tool'
import type { AgentContext } from '@/lib/mcp/token'
import { connectDatabase } from '@/lib/mongodb'
import {
  BLOG_GENERATE_IMAGE_LIMIT,
  BLOG_IMAGE_PROMPT_LIMIT,
  BLOG_SAVE_LIMIT,
  checkRateLimit,
} from '@/lib/rate-limit'
import { PostModel } from '@/models/Post'

/**
 * The blog tools: every one calls `post-service` / `image-service` / `illustrate-run`, the
 * same modules `/api/admin/blog/**` calls (premise 2), and runs inside `runTool`.
 *
 * ```
 *   read     list_posts · get_post · list_taxonomy · get_writing_brief · lint_draft
 *   write    create_draft (keyed) · update_post* · generate_image* (keyed) · illustrate_post*
 *   publish  publish_post · archive_post
 *            * a published target needs publish too - checked here at run time, because the
 *              scope a call needs depends on the post, not on the tool (the live-post rule)
 * ```
 *
 * `illustrate_post` answers at once and draws inside `after()` (R2): the agent polls
 * `get_post` for `illustration { state, remaining, lastError }`. Every image it draws spends
 * the token's own image bucket (R5).
 */

const json = (value: unknown) => JSON.stringify(value, null, 2)

const siteUrl = () =>
  (process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/+$/, '')

const adminUrl = (id: string) => `${siteUrl()}/admin/blog/${id}`
const publicUrl = (slug: string) => `${siteUrl()}/blog/${slug}`

const canPublish = (token: AgentContext) => token.scopes.includes('publish')

const LIVE_POST_REFUSAL =
  'This post is published, so changing it changes the live site, which needs the publish scope. This token does not have it. Nothing was changed.'

/** A service refusal as a teaching tool error, keeping its reason for the audit feed. */
function fromFailure(result: ServiceFailure): ToolResult {
  const reason =
    typeof result.extra?.reason === 'string'
      ? result.extra.reason
      : result.status === 404
        ? 'not-found'
        : result.status === 409
          ? 'conflict'
          : 'invalid'
  return refuse(result.error, reason)
}

const objectId = z.string().regex(/^[0-9a-f]{24}$/i, 'must be a post id')
const imagePrompts = z
  .array(
    z.object({
      key: z.string().regex(/^image\d+$/, 'must be an imageN key'),
      prompt: z.string().min(1).max(2000),
    })
  )
  .max(12)
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a calendar day, YYYY-MM-DD')

// MARK: Reads

export const listPostsTool = defineTool({
  name: 'list_posts',
  title: 'List blog posts',
  description:
    'Blog posts with filters, a text query over title/excerpt/slug, a sort, and paging (pass nextCursor back as cursor). Deleted posts are left out unless asked for. Each row carries views, shares and attributions counted over the LAST 180 DAYS only - blog events are kept 180 days, so "no views" means none in that window. Dates are YYYY-MM-DD, both ends inclusive.',
  scopes: ['read'],
  input: z.object({
    status: z.array(z.enum(POST_STATUSES)).optional(),
    kind: z.string().max(48).optional(),
    series: z.string().max(48).optional(),
    publishedFrom: day.optional(),
    publishedTo: day.optional(),
    query: z.string().max(200).optional(),
    sort: z.enum(['publishedAt', 'updatedAt', 'views']).default('updatedAt'),
    order: z.enum(['asc', 'desc']).default('desc'),
    cursor: z.string().max(200).optional(),
    limit: z.number().int().min(1).max(25).default(20),
  }),
  annotations: { readOnlyHint: true, openWorldHint: false },
  async run(args) {
    const result = await listPosts({
      ...args,
      publishedFrom: args.publishedFrom
        ? new Date(`${args.publishedFrom}T00:00:00.000Z`)
        : undefined,
      publishedTo: args.publishedTo
        ? new Date(`${args.publishedTo}T23:59:59.999Z`)
        : undefined,
    })
    return ok(
      json({
        total: result.total,
        nextCursor: result.nextCursor,
        metricsWindow: 'views, shares and attributions: last 180 days',
        posts: result.items,
      })
    )
  },
})

export const getPostTool = defineTool({
  name: 'get_post',
  title: 'Get one blog post',
  description:
    'One post by id or slug: metadata, unfilled image placeholders (and whether each has a prompt), 180-day metrics, illustration { state, remaining, lastError }, and the markdown body in pages of about 24,000 characters (offset, nextOffset, complete). version is the full-body hash, needed only to replace a whole one-page body with update_post. Poll this after illustrate_post until illustration.state is idle.',
  scopes: ['read'],
  input: z.object({
    id: objectId.optional(),
    slug: z.string().max(80).optional(),
    offset: z.number().int().min(0).default(0),
  }),
  annotations: { readOnlyHint: true, openWorldHint: false },
  async run({ id, slug, offset }) {
    if (!id && !slug) return refuse('Give the post id or its slug.')
    const page = await readPostPage({ id, slug }, offset)
    if (!page) return refuse('No post with that id or slug.', 'not-found')
    return ok(
      json({
        ...page,
        adminUrl: adminUrl(page.id),
        publicUrl: page.status === 'published' ? publicUrl(page.slug) : null,
      })
    )
  },
})

export const listTaxonomyTool = defineTool({
  name: 'list_taxonomy',
  title: 'List kinds and series',
  description:
    'Every post kind and series with its slug and post count. create_draft and update_post take these slugs.',
  scopes: ['read'],
  input: z.object({}),
  annotations: { readOnlyHint: true, openWorldHint: false },
  async run() {
    await connectDatabase()
    const [kinds, series] = await Promise.all([
      listKindsWithCounts(),
      listSeriesWithCounts(),
    ])
    return ok(
      json({
        kinds: kinds.map(({ slug, label, postCount }) => ({
          slug,
          label,
          postCount,
        })),
        series: series.map(({ slug, title, blurb, postCount }) => ({
          slug,
          title,
          blurb,
          postCount,
        })),
      })
    )
  },
})

export const getWritingBriefTool = defineTool({
  name: 'get_writing_brief',
  title: "The owner's writing brief",
  description:
    "The owner's voice rules - method, shape, evidence law, sentence rules, markdown contract, a structure - and the steps from draft to published post. The same text as the write-post prompt, for clients without MCP prompts. Read it before drafting.",
  scopes: ['read'],
  input: z.object({
    language: z.enum(['vi', 'en']).default('vi'),
    kind: z.string().max(48).optional(),
    structure: z.enum(STRUCTURE_NAMES as [string, ...string[]]).optional(),
  }),
  annotations: { readOnlyHint: true, openWorldHint: false },
  async run(args, { token }) {
    return ok(
      buildWritingBrief({
        ...args,
        loop: {
          canWrite: token.scopes.includes('write'),
          canPublish: canPublish(token),
        },
      })
    )
  },
})

export const lintDraftTool = defineTool({
  name: 'lint_draft',
  title: 'Lint a draft',
  description:
    "Check a markdown draft against the owner's prose audit (em dashes, banned phrases, parallel sections, recap closers, unsourced specifics) and a dry run of the renderer (raw HTML it would drop, image URLs it would refuse, a stray h1), and list the image placeholders. Pass evidence (the material the post may cite) so sourced specifics are not flagged. Saves nothing. See get_writing_brief for the rules.",
  scopes: ['read'],
  input: z.object({
    bodyMarkdown: z.string().max(200_000),
    language: z.enum(['vi', 'en']).default('vi'),
    evidence: z.string().max(20_000).optional(),
    structure: z.string().max(40).optional(),
    imagePrompts: z
      .array(z.object({ key: z.string() }))
      .max(12)
      .optional(),
  }),
  annotations: { readOnlyHint: true, openWorldHint: false },
  async run(args) {
    const report = lintDraft(args)
    return ok(
      json({
        summary: report.clean
          ? 'Clean: no prose findings and nothing the renderer would drop.'
          : 'Fix the findings below, or explain to the owner why one does not apply.',
        ...report,
      })
    )
  },
})

// MARK: Writes

export const createDraftTool = defineTool({
  name: 'create_draft',
  title: 'Create a draft post',
  description:
    'Save a new draft: title, markdown body, excerpt, kind and series (slugs from list_taxonomy), language, and optionally a slug (derived from the title otherwise). Pictures: put ![alt](image1), ![alt](image2)... in the body and give one prompt per key in imagePrompts, plus coverImagePrompt for the cover; illustrate_post draws them. Never publishes. Returns the id, the admin link and lint findings. Call get_writing_brief (or use the write-post prompt) first.',
  scopes: ['write'],
  keyed: true,
  cost: () => [BLOG_SAVE_LIMIT],
  input: z.object({
    title: z.string().min(1).max(140),
    bodyMarkdown: z.string().max(200_000),
    excerpt: z.string().max(300).optional(),
    kind: z.string().max(48).optional(),
    series: z.string().max(48).nullable().optional(),
    language: z.enum(['vi', 'en']).optional(),
    slug: z.string().max(80).optional(),
    coverImagePrompt: z.string().max(2000).optional(),
    imagePrompts: imagePrompts.optional(),
    tags: z
      .array(z.string().regex(/^[a-z0-9-]{1,32}$/))
      .max(8)
      .optional(),
  }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  async run(args, { setTarget }) {
    const result = await createDraft(args)
    if (!result.ok) return fromFailure(result)
    const { id, slug } = result.value
    setTarget({ kind: 'post', id, slug })
    const lint = lintDraft({
      bodyMarkdown: args.bodyMarkdown,
      language: args.language ?? 'vi',
      imagePrompts: args.imagePrompts,
    })
    return ok(
      json({
        id,
        slug,
        status: 'draft',
        adminUrl: adminUrl(id),
        placeholders: lint.placeholders,
        lint: {
          clean: lint.clean,
          prose: lint.prose,
          rawHtml: lint.rawHtml,
          refusedImages: lint.refusedImages,
          h1: lint.h1,
        },
        next: lint.placeholders.length
          ? 'Call illustrate_post to draw the cover and placeholders, then poll get_post.'
          : 'Add a cover with generate_image (mode attach, target cover) before publishing.',
      })
    )
  },
})

export const updatePostTool = defineTool({
  name: 'update_post',
  title: 'Edit a post',
  description:
    'Change text fields, kind/series, tags, image prompts, or the body. Body changes are edits: [{ find, replace }] - each find must match the current body exactly once, or the whole call fails and names it; copy find text from get_post. A whole bodyMarkdown replace is allowed only for a post that fits in one page, with the version from get_post. There is no status here: use publish_post. A published post needs the publish scope, and may not be left holding an unfilled ![alt](imageN) placeholder - generate the image first (generate_image, mode return) and insert ![alt](url) with an edit.',
  scopes: ['write'],
  audited: true,
  cost: () => [BLOG_SAVE_LIMIT],
  input: z
    .object({
      id: objectId,
      title: z.string().min(1).max(140).optional(),
      excerpt: z.string().max(300).optional(),
      kind: z.string().max(48).optional(),
      series: z.string().max(48).nullable().optional(),
      language: z.enum(['vi', 'en']).optional(),
      tags: z
        .array(z.string().regex(/^[a-z0-9-]{1,32}$/))
        .max(8)
        .optional(),
      coverCaption: z.string().max(140).optional(),
      coverImagePrompt: z.string().max(2000).optional(),
      imagePrompts: imagePrompts.optional(),
      edits: z
        .array(z.object({ find: z.string().min(1), replace: z.string() }))
        .max(50)
        .optional(),
      bodyMarkdown: z.string().max(200_000).optional(),
      version: z.string().max(32).optional(),
    })
    .strict(),
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  async run({ id, ...input }, { token, setTarget }) {
    const result = await updatePostAsAgent(id, input, {
      canEditLive: canPublish(token),
    })
    if (!result.ok) return fromFailure(result)
    const { slug, status, bodyChanged, version } = result.value
    setTarget({ kind: 'post', id, slug })
    return ok(json({ id, slug, status, bodyChanged, version }))
  },
})

const IMAGE_MODELS = IMAGE_MODEL_OPTIONS.map(option => option.value) as [
  string,
  ...string[],
]

export const generateImageTool = defineTool({
  name: 'generate_image',
  title: 'Generate one image',
  description:
    "Draw one image for a post (synchronous, up to about two minutes). The prompt is the one you pass, else the post's stored prompt for the target, else one written from the post's prose. mode 'return' (default) only returns the URL - insert it yourself as ![alt](url) with update_post. mode 'attach' saves it as the cover (target 'cover') or into one placeholder (target 'image1'...), and on a published post needs the publish scope. model defaults to the cheapest.",
  scopes: ['write'],
  keyed: true,
  cost: args =>
    args.mode === 'attach'
      ? [BLOG_GENERATE_IMAGE_LIMIT, BLOG_SAVE_LIMIT]
      : [BLOG_GENERATE_IMAGE_LIMIT],
  input: z.object({
    postId: objectId,
    target: z
      .string()
      .regex(/^(cover|image\d+)$/, "must be 'cover' or an imageN key")
      .optional(),
    prompt: z.string().min(1).max(2000).optional(),
    mode: z.enum(['return', 'attach']).default('return'),
    model: z.enum(IMAGE_MODELS).default(IMAGE_MODELS[0]),
  }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  async run(args, { token, setTarget }) {
    if (args.mode === 'attach' && !args.target)
      return refuse("mode 'attach' needs a target: 'cover' or an imageN key.")

    await connectDatabase()
    const post = await PostModel.findById(args.postId)
      .select('slug status coverImagePrompt imagePrompts')
      .lean()
    if (!post || post.status === 'deleted')
      return refuse('Post not found.', 'not-found')
    setTarget({ kind: 'post', id: args.postId, slug: post.slug })
    if (
      args.mode === 'attach' &&
      post.status === 'published' &&
      !canPublish(token)
    )
      return refuse(LIVE_POST_REFUSAL, 'live-post')

    let prompt = args.prompt
    if (!prompt && args.target)
      prompt =
        args.target === COVER_KEY
          ? post.coverImagePrompt || undefined
          : post.imagePrompts.find(entry => entry.key === args.target)
              ?.prompt || undefined
    try {
      if (!prompt) {
        if (!args.target)
          return refuse(
            'Pass a prompt, or a target to write one from the post.'
          )
        const spent = await checkRateLimit(
          `mcp-token:${token.tokenId}`,
          BLOG_IMAGE_PROMPT_LIMIT
        )
        if (!spent.ok)
          return refuse(
            `Rate limit: this token has used its image-prompt budget. Pass a prompt yourself, or try again in ${spent.retryAfterSeconds} s.`,
            'rate'
          )
        const written = await writeImagePrompt(
          args.postId,
          args.target === COVER_KEY
            ? { cover: true }
            : { cover: false, key: args.target },
          { save: args.mode === 'attach' }
        )
        if (!written.ok) return fromFailure(written)
        prompt = written.value.prompt
      }

      const drawn = await generateImageUrl({
        postId: args.postId,
        prompt,
        model: args.model,
        name: args.target ?? 'image',
      })
      if (!drawn.ok) return fromFailure(drawn)

      if (args.mode === 'return')
        return ok(
          json({
            url: drawn.value.url,
            model: drawn.value.model,
            attached: false,
            prompt,
          })
        )

      const saved = await patchImageIntoPost(
        args.postId,
        args.target!,
        drawn.value.url
      )
      if (saved.outcome === 'skipped')
        return refuse(
          `"${args.target}" is not a placeholder in the post body any more, so the image was not attached. Its URL: ${drawn.value.url}`,
          'conflict'
        )
      if (saved.outcome !== 'saved')
        return refuse(
          `The image was drawn but could not be saved (${saved.outcome}). Its URL: ${drawn.value.url}`,
          'conflict'
        )
      return ok(
        json({
          url: drawn.value.url,
          model: drawn.value.model,
          attached: true,
          target: args.target,
          live: saved.live,
        })
      )
    } catch (error) {
      if (error instanceof ImageGenError || error instanceof LlmError)
        return {
          text: `The image could not be generated: ${error.message}`,
          outcome: 'error',
          reason: 'upstream',
        }
      throw error
    }
  },
})

/** The run's budget: 85% of the route's 300 s, the same stop the cron uses. */
const ILLUSTRATE_BUDGET_MS = 300_000 * 0.85

export const illustratePostTool = defineTool({
  name: 'illustrate_post',
  title: 'Draw all missing images',
  description:
    'Start drawing the cover (if missing) and every ![alt](imageN) placeholder that has a prompt in imagePrompts, and return at once with { started, placeholders }. The run continues on the server for up to about four minutes, patching each image into the post as it lands. Poll get_post every ~20 s until illustration.state is idle (done) or failed (read lastError). It never publishes. A second start while a run is live is refused. On a published post it needs the publish scope. Placeholders without a prompt are skipped: add prompts with update_post first.',
  scopes: ['write'],
  audited: true,
  cost: () => [BLOG_SAVE_LIMIT],
  input: z.object({
    id: objectId,
    model: z.enum(IMAGE_MODELS).default(IMAGE_MODELS[0]),
  }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  async run({ id, model }, { token, setTarget }) {
    const startedAt = Date.now()
    await connectDatabase()
    const post = await PostModel.findById(id).select('+bodyMarkdown').lean()
    if (!post || post.status === 'deleted')
      return refuse('Post not found.', 'not-found')
    setTarget({ kind: 'post', id, slug: post.slug })
    if (post.status === 'published' && !canPublish(token))
      return refuse(LIVE_POST_REFUSAL, 'live-post')

    const planned = plannedImages(post)
    if (planned === 0)
      return refuse(
        'Nothing to draw: the post has a cover (or no cover prompt) and no placeholder with a prompt. Check get_post placeholders[].hasPrompt, and add imagePrompts with update_post.',
        'nothing-to-draw'
      )

    const claim = await claimIllustration(id, planned)
    if (!claim.claimed)
      return refuse(
        `An image run is already in progress for this post (${claim.remaining} left). Poll get_post until illustration.state is idle.`,
        'in-flight'
      )

    after(() =>
      runIllustration(id, {
        model,
        deadlineAt: startedAt + ILLUSTRATE_BUDGET_MS,
        publish: false,
        spendImage: () =>
          checkRateLimit(
            `mcp-token:${token.tokenId}`,
            BLOG_GENERATE_IMAGE_LIMIT
          ),
      })
    )

    return ok(
      json({
        started: true,
        placeholders: planned,
        next: 'Poll get_post about every 20 seconds until illustration.state is idle and remaining is 0.',
      })
    )
  },
})

export const publishPostTool = defineTool({
  name: 'publish_post',
  title: 'Publish a post',
  description:
    'Make a draft or archived post public at /blog/<slug>. Refused while the post has no cover, an unfilled image placeholder, no title or no body. Publish only when the owner asked for it.',
  scopes: ['publish'],
  audited: true,
  cost: () => [BLOG_SAVE_LIMIT],
  input: z.object({ id: objectId }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  async run({ id }, { setTarget }) {
    const result = await publishPost(id)
    if (!result.ok) return fromFailure(result)
    setTarget({ kind: 'post', id, slug: result.value.slug })
    return ok(
      json({
        slug: result.value.slug,
        url: publicUrl(result.value.slug),
        alreadyPublished: result.value.alreadyPublished,
      })
    )
  },
})

export const archivePostTool = defineTool({
  name: 'archive_post',
  title: 'Archive or unarchive a post',
  description:
    "action 'archive' takes a published post off the site (it 404s and leaves /blog and the feed; nothing is deleted). action 'unarchive' returns an archived post that was never public to draft; one that was public is refused - use publish_post to make it live again.",
  scopes: ['publish'],
  audited: true,
  cost: () => [BLOG_SAVE_LIMIT],
  input: z.object({
    id: objectId,
    action: z.enum(['archive', 'unarchive']),
  }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  async run({ id, action }, { setTarget }) {
    const result = await archivePost(id, action)
    if (!result.ok) return fromFailure(result)
    setTarget({ kind: 'post', id, slug: result.value.slug })
    return ok(json({ id, ...result.value }))
  },
})

export const BLOG_TOOLS = [
  listPostsTool,
  getPostTool,
  listTaxonomyTool,
  getWritingBriefTool,
  lintDraftTool,
  createDraftTool,
  updatePostTool,
  generateImageTool,
  illustratePostTool,
  publishPostTool,
  archivePostTool,
]
