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
  if (!cloudName || !apiKey || !apiSecret)
    throw new Error('Missing Cloudinary env vars')

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
