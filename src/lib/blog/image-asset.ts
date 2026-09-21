import 'server-only'

import { generateImage } from '@/lib/blog/image-gen'
import { uploadToCloudinary } from '@/lib/cloudinary'

/**
 * Draw one image and put it somewhere the renderer will accept it.
 *
 * ```
 *   prompt ──▶ generateImage ──▶ { base64, mimeType }
 *                                      │
 *                          Buffer.from(base64) ──▶ File
 *                                      │
 *                          uploadToCloudinary('portfolio/blog')
 *                                      ▼
 *                             https://res.cloudinary.com/...
 * ```
 *
 * ## Why the upload is not optional
 *
 * `rehypeRestrictImageHosts` requires `https`, the host `res.cloudinary.com`, and a path under
 * this site's cloud name - so base64 bytes are not something the body can hold, and neither is
 * a URL from anywhere else. Every path that makes an image has to end here, which is why this
 * is one function rather than two steps each caller assembles: a caller that generated an
 * image and skipped the upload would produce a URL the editor accepts, the card clears for,
 * and the published page renders as a broken-image icon.
 *
 * Both callers - the editor's Generate button and the cron's automatic run - go through it,
 * and they used to be two copies of the same twelve lines with their own mime-to-extension
 * tables.
 */

/** Google returns `image/jpeg` on every model checked so far; the others are here for whatever ships next. */
const EXTENSION_FOR_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

export type DrawnImage = {
  /** A `res.cloudinary.com` URL, ready to be written into a body or onto `coverImage`. */
  url: string
  /** The model that actually answered. Reported, never trusted to be the one asked for. */
  model: string
}

export async function drawImageAsset({
  prompt,
  model,
  /** Becomes the Cloudinary filename stem. The post slug plus what the image is for. */
  name,
  timeoutMs,
}: {
  prompt: string
  model: string
  name: string
  timeoutMs?: number
}): Promise<DrawnImage> {
  const image = await generateImage({ prompt, model, timeoutMs })

  const extension = EXTENSION_FOR_MIME[image.mimeType] ?? 'jpg'
  const bytes = Buffer.from(image.base64, 'base64')
  const file = new File([bytes], `${name}.${extension}`, {
    type: image.mimeType,
  })

  // Same folder `POST /api/upload` uses for a `kind: 'post'` upload - a generated image and a
  // hand-uploaded one are the same asset by the same door.
  const uploaded = await uploadToCloudinary(file, 'portfolio/blog', 'image')

  return { url: uploaded.url, model: image.model }
}
