import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { hasOwnerAccess } from '@/lib/admin-gate'
import { getAuthCookieName } from '@/lib/auth'
import { uploadToCloudinary } from '@/lib/cloudinary'
import { MAX_UPLOAD_BYTES } from '@/lib/upload-limits'

const ALLOWED_KINDS = new Set(['avatar', 'background', 'cv', 'cv-photo', 'project', 'post'])

/**
 * The MIME types a `post` upload may carry.
 *
 * Only the `post` kind is constrained, and the asymmetry is the point rather than an
 * oversight. The other five are chosen by the owner through a file picker and land on pages
 * that render them as `<img>`; a bad file there is a broken avatar. A `post` image lands in
 * markdown, and the markdown pipeline trusts `res.cloudinary.com` UNCONDITIONALLY as the one
 * host a post may load from - so anything that reaches that hostname through this route
 * inherits that trust.
 *
 * SVG is excluded and that is the whole reason this list exists. It is a scripting format:
 * `<svg><script>alert(1)</script></svg>` executes when the file is navigated to directly, and
 * it would be doing so from the origin the image allowlist vouches for. `text/html` likewise.
 * `resource_type: 'image'` in `cloudinary.ts` is the second lock on the same door - this one
 * gives a legible error, that one holds if this list is ever widened carelessly.
 */
const POST_IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'])

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function resolveUploadFolder(
  kind: string,
  projectIndex: string | null
): { folder: string } | { error: string } {
  if (kind === 'avatar') {
    return { folder: 'portfolio/avatar' }
  }

  if (kind === 'background') {
    return { folder: 'portfolio/background' }
  }

  if (kind === 'cv') {
    return { folder: 'portfolio/cv' }
  }

  // Its own folder rather than sharing `portfolio/avatar`: the printed CV photo is
  // cropped to a circle at a fixed size and is often not the same picture as the hero.
  if (kind === 'cv-photo') {
    return { folder: 'portfolio/cv/photo' }
  }

  // Its own folder so blog assets are separable from profile assets - the two have different
  // lifetimes and a post image outlives any number of avatar changes.
  if (kind === 'post') {
    return { folder: 'portfolio/blog' }
  }

  if (typeof projectIndex !== 'string' || !/^\d+$/.test(projectIndex)) {
    return { error: 'Project uploads require a numeric projectIndex.' }
  }

  return { folder: `portfolio/projects/${projectIndex}` }
}

function toUploadError(error: unknown): { status: number; message: string } {
  if (error && typeof error === 'object') {
    const httpCode = 'httpCode' in error ? error.httpCode : undefined
    if (typeof httpCode === 'number' && httpCode === 413) {
      return {
        status: 413,
        message: `File exceeds ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB limit`,
      }
    }
  }

  const message = error instanceof Error ? error.message : 'Upload failed'
  return { status: 500, message }
}

export async function POST(request: NextRequest) {
  const authCookie = request.cookies.get(getAuthCookieName())?.value
  if (!hasOwnerAccess(authCookie)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const formData = await request.formData()
    const kind = formData.get('kind')
    const file = formData.get('file')

    if (typeof kind !== 'string' || !ALLOWED_KINDS.has(kind)) {
      return NextResponse.json(
        { error: 'Invalid or missing kind (avatar | background | cv | cv-photo | project | post)' },
        { status: 400 }
      )
    }

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Missing file' }, { status: 400 })
    }

    if (typeof file.size === 'number' && file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: `File exceeds ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB limit` },
        { status: 413 }
      )
    }

    // Checked AFTER the size bound, so a 50MB SVG is refused as too large rather than read.
    // `file.type` is client-supplied, so this is a usability gate that produces a clear error
    // - `resource_type: 'image'` below is what actually holds if it is lied to.
    if (kind === 'post' && !POST_IMAGE_MIME.has(file.type)) {
      return NextResponse.json(
        {
          error: `Post images must be JPEG, PNG, WebP, GIF or AVIF. SVG is refused: it is a scripting format, and it would be served from the one host the markdown pipeline trusts.`,
        },
        { status: 415 }
      )
    }

    const target = resolveUploadFolder(kind, formData.get('projectIndex')?.toString() ?? null)
    if ('error' in target) {
      return NextResponse.json({ error: target.error }, { status: 400 })
    }

    const uploaded = await uploadToCloudinary(file, target.folder, 'image')
    return NextResponse.json({ url: uploaded.url })
  } catch (error) {
    const uploadError = toUploadError(error)
    return NextResponse.json({ error: uploadError.message }, { status: uploadError.status })
  }
}
