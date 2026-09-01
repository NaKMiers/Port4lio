import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { hasOwnerAccess } from '@/lib/admin-gate'
import { getAuthCookieName } from '@/lib/auth'
import { uploadToCloudinary } from '@/lib/cloudinary'
import { MAX_UPLOAD_BYTES } from '@/lib/upload-limits'

const ALLOWED_KINDS = new Set(['avatar', 'background', 'cv', 'cv-photo', 'project'])

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
        { error: 'Invalid or missing kind (avatar | background | cv | cv-photo | project)' },
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

    const target = resolveUploadFolder(kind, formData.get('projectIndex')?.toString() ?? null)
    if ('error' in target) {
      return NextResponse.json({ error: target.error }, { status: 400 })
    }

    const uploaded = await uploadToCloudinary(file, target.folder)
    return NextResponse.json({ url: uploaded.url })
  } catch (error) {
    const uploadError = toUploadError(error)
    return NextResponse.json({ error: uploadError.message }, { status: uploadError.status })
  }
}
