import 'server-only'

import { z } from 'zod'

import {
  deleteCloudinaryAsset,
  getCloudinaryAsset,
  listCloudinaryAssets,
  uploadFromUrl,
} from '@/lib/cloudinary'
import { defineTool, ok, refuse } from '@/lib/mcp/run-tool'
import {
  CLOUDINARY_DELETE_LIMIT,
  CLOUDINARY_UPLOAD_LIMIT,
} from '@/lib/rate-limit'

/**
 * Cloudinary asset tools: list/get are read-only against the Admin API, upload and delete go
 * through `src/lib/cloudinary.ts` - the same module `/api/upload` and the blog image pipeline
 * use. Every asset here is `resource_type: 'image'`, never `'auto'`: `res.cloudinary.com` is
 * the one host the blog markdown pipeline trusts unconditionally, and an SVG or HTML file
 * uploaded as `'auto'` would be served from that trusted origin as a live script (see the
 * doc comment on `uploadToCloudinary`).
 *
 * ```
 *   read     list_cloudinary_assets · get_cloudinary_asset
 *   write    upload_cloudinary_asset (keyed, R4, its own rate bucket)
 *   publish  delete_cloudinary_asset - irreversible, and this app tracks no back-reference
 *            from an asset to the post/profile field that uses its URL, so a delete can
 *            break a live page silently. Gated like the other tools that touch what the
 *            public sees.
 * ```
 */

const json = (value: unknown) => JSON.stringify(value, null, 2)

const publicId = z
  .string()
  .min(1)
  .max(255)
  .describe("A Cloudinary public_id, e.g. 'portfolio/blog/my-post-cover'.")

const folder = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-zA-Z0-9/_-]+$/, 'must contain only letters, numbers, /, _ and -')

export const listCloudinaryAssetsTool = defineTool({
  name: 'list_cloudinary_assets',
  title: 'List Cloudinary assets',
  description:
    "Images stored in Cloudinary, optionally under one folder (prefix match, e.g. 'portfolio/blog'). Paged: pass nextCursor back as cursor. Every asset is resource_type image.",
  scopes: ['read'],
  input: z.object({
    folder: folder.optional(),
    cursor: z.string().max(200).optional(),
    limit: z.number().int().min(1).max(100).default(30),
  }),
  annotations: { readOnlyHint: true, openWorldHint: true },
  async run({ folder: prefix, cursor, limit }) {
    const result = await listCloudinaryAssets({
      folder: prefix,
      maxResults: limit,
      nextCursor: cursor,
    })
    return ok(
      json({ nextCursor: result.nextCursor ?? null, assets: result.assets })
    )
  },
})

export const getCloudinaryAssetTool = defineTool({
  name: 'get_cloudinary_asset',
  title: 'Get one Cloudinary asset',
  description:
    'One Cloudinary asset by its public_id: url, folder, format, dimensions, bytes and tags.',
  scopes: ['read'],
  input: z.object({ publicId }),
  annotations: { readOnlyHint: true, openWorldHint: true },
  async run({ publicId: id }) {
    const asset = await getCloudinaryAsset(id)
    if (!asset)
      return refuse('No Cloudinary asset with that public_id.', 'not-found')
    return ok(json(asset))
  },
})

export const uploadCloudinaryAssetTool = defineTool({
  name: 'upload_cloudinary_asset',
  title: 'Upload an image to Cloudinary',
  description:
    "Bring a remote image (sourceUrl) into Cloudinary as resource_type image, so it can be used as ![alt](url) in a post body (update_post) or as a profile image (update_profile). Refused for anything Cloudinary does not recognise as a raster image - that includes SVG. folder defaults to 'portfolio/agent'; use a post or project's own folder only if you know it (list_cloudinary_assets shows existing ones).",
  scopes: ['write'],
  keyed: true,
  cost: () => [CLOUDINARY_UPLOAD_LIMIT],
  input: z.object({
    sourceUrl: z.string().url().max(2000),
    folder: folder.default('portfolio/agent'),
  }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  async run({ sourceUrl, folder: targetFolder }, { setTarget }) {
    try {
      const asset = await uploadFromUrl(sourceUrl, targetFolder)
      setTarget({ kind: 'cloudinary-asset', id: asset.publicId })
      return ok(json(asset))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Upload failed'
      return refuse(
        `Could not upload from that URL: ${message}. Cloudinary only accepts it if it is reachable and recognised as a raster image (JPEG, PNG, WebP, GIF, AVIF...).`,
        'upstream'
      )
    }
  },
})

export const deleteCloudinaryAssetTool = defineTool({
  name: 'delete_cloudinary_asset',
  title: 'Delete a Cloudinary asset',
  description:
    "Permanently delete one image from Cloudinary by public_id. Irreversible, and this app does not track which post or profile field uses an asset's URL - deleting one still referenced by a live post or the profile leaves a broken image there. Check the post/profile first if unsure. Only use this for an asset you know is unused (e.g. one just uploaded by mistake).",
  scopes: ['publish'],
  audited: true,
  cost: () => [CLOUDINARY_DELETE_LIMIT],
  input: z.object({ publicId }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  async run({ publicId: id }, { setTarget }) {
    setTarget({ kind: 'cloudinary-asset', id })
    const deleted = await deleteCloudinaryAsset(id)
    if (!deleted)
      return refuse('No Cloudinary asset with that public_id.', 'not-found')
    return ok(json({ publicId: id, deleted: true }))
  },
})

export const CLOUDINARY_TOOLS = [
  listCloudinaryAssetsTool,
  getCloudinaryAssetTool,
  uploadCloudinaryAssetTool,
  deleteCloudinaryAssetTool,
]
