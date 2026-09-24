import { v2 as cloudinary } from 'cloudinary'
import { Readable } from 'stream'

import { MAX_UPLOAD_BYTES } from '@/lib/upload-limits'

const cloudName = process.env.CLOUDINARY_CLOUD_NAME
const apiKey = process.env.CLOUDINARY_API_KEY
const apiSecret = process.env.CLOUDINARY_API_SECRET

if (cloudName && apiKey && apiSecret)
  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
  })

export type UploadedAsset = {
  url: string
  publicId?: string
}

export type CloudinaryAssetInfo = {
  publicId: string
  url: string
  folder: string
  format: string
  width: number
  height: number
  bytes: number
  createdAt: string
  tags: string[]
}

function assertConfigured() {
  if (!cloudName || !apiKey || !apiSecret)
    throw new Error('Missing Cloudinary env vars')
}

function toAssetInfo(resource: {
  public_id: string
  secure_url: string
  folder?: string
  format?: string
  width?: number
  height?: number
  bytes?: number
  created_at?: string
  tags?: string[]
}): CloudinaryAssetInfo {
  return {
    publicId: resource.public_id,
    url: resource.secure_url,
    folder:
      resource.folder ?? resource.public_id.split('/').slice(0, -1).join('/'),
    format: resource.format ?? '',
    width: resource.width ?? 0,
    height: resource.height ?? 0,
    bytes: resource.bytes ?? 0,
    createdAt: resource.created_at ?? '',
    tags: resource.tags ?? [],
  }
}

/**
 * `resource_type`, and why `'auto'` was the wrong default once the blog existed.
 *
 * `'auto'` tells Cloudinary to sniff the file and store it as whatever it looks like -
 * including `raw`, which accepts anything at all. That was survivable while every upload
 * was an avatar or a CV chosen by the owner through a file picker. It stopped being
 * survivable when the markdown pipeline started trusting `res.cloudinary.com`
 * unconditionally as the ONE host a post may load images from.
 *
 * Under `'auto'`, an SVG or an HTML file uploaded through the editor comes back as a
 * `res.cloudinary.com` URL. SVG is a scripting format - `<svg><script>` executes when the
 * file is navigated to directly - and it would be served from the exact origin the image
 * allowlist exists to vouch for. `'image'` makes Cloudinary reject anything that is not a
 * raster image at the door, which is the constraint the allowlist was assuming all along.
 */
export async function uploadToCloudinary(
  file: File,
  folder: string,
  resourceType: 'image' | 'auto' = 'image'
): Promise<UploadedAsset> {
  assertConfigured()

  if (typeof file.size === 'number' && file.size > MAX_UPLOAD_BYTES)
    throw new Error(
      `File exceeds ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB upload limit`
    )

  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  const uploadResult: UploadedAsset = await new Promise((resolve, reject) => {
    const stream = Readable.from(buffer)
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: resourceType,
        public_id: undefined,
      },
      (error, result) => {
        if (error) return reject(error)
        if (!result || !('secure_url' in result))
          return reject(new Error('Cloudinary upload failed'))

        resolve({ url: result.secure_url, publicId: result.public_id })
      }
    )

    stream.on('error', reject)
    uploadStream.on('error', reject)
    stream.pipe(uploadStream)
  })

  return uploadResult
}

/**
 * Bring a remote image into Cloudinary by URL, `resource_type: 'image'` for the same reason
 * as `uploadToCloudinary` - this is the only door the MCP agent has onto `res.cloudinary.com`,
 * and the markdown pipeline trusts that host unconditionally.
 */
export async function uploadFromUrl(
  sourceUrl: string,
  folder: string
): Promise<CloudinaryAssetInfo> {
  assertConfigured()
  const result = await cloudinary.uploader.upload(sourceUrl, {
    folder,
    resource_type: 'image',
  })
  return toAssetInfo(result)
}

export async function listCloudinaryAssets(options: {
  folder?: string
  maxResults: number
  nextCursor?: string
}): Promise<{ assets: CloudinaryAssetInfo[]; nextCursor?: string }> {
  assertConfigured()
  const result = await cloudinary.api.resources({
    type: 'upload',
    resource_type: 'image',
    prefix: options.folder,
    max_results: options.maxResults,
    next_cursor: options.nextCursor,
    tags: true,
  })
  return {
    assets: (result.resources ?? []).map(toAssetInfo),
    nextCursor: result.next_cursor,
  }
}

export async function getCloudinaryAsset(
  publicId: string
): Promise<CloudinaryAssetInfo | null> {
  assertConfigured()
  try {
    const result = await cloudinary.api.resource(publicId, {
      resource_type: 'image',
      tags: true,
    })
    return toAssetInfo(result)
  } catch (error) {
    if (error && typeof error === 'object' && 'http_code' in error) {
      const httpCode = (error as { http_code?: unknown }).http_code
      if (httpCode === 404) return null
    }
    throw error
  }
}

/** Irreversible. Deleting an asset still referenced by a live post or the profile breaks it. */
export async function deleteCloudinaryAsset(
  publicId: string
): Promise<boolean> {
  assertConfigured()
  const result = await cloudinary.uploader.destroy(publicId, {
    resource_type: 'image',
    invalidate: true,
  })
  return result?.result === 'ok'
}
