import { NextResponse, type NextRequest } from 'next/server'

import { jsonError } from '@/lib/api-response'
import { KIND_SLUG_PATTERN } from '@/lib/blog/constants'
import { listKindsWithCounts } from '@/lib/blog/kind-data'
import { connectDatabase } from '@/lib/mongodb'
import { readJsonBody } from '@/lib/read-json-body'
import { requireOwner } from '@/lib/require-owner'
import { KindModel } from '@/models/Kind'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_BODY_BYTES = 8 * 1024

/**
 * [GET]  /api/admin/blog/kinds - the manage dialog's list, with post counts
 * [POST] /api/admin/blog/kinds - create one
 *
 * The mirror of `/api/admin/blog/series`, down to the shape of the responses. Kept as its own
 * route rather than a `?type=` parameter on that one: the two collections have different
 * delete rules (a post must always HAVE a kind, and may have no series), and a handler that
 * branched on a query string to decide which invariant to enforce is a handler where the
 * wrong branch is one typo away.
 */
export async function GET(request: NextRequest) {
  const denied = requireOwner(request)
  if (denied) return denied

  try {
    return NextResponse.json({ kinds: await listKindsWithCounts() })
  } catch {
    return jsonError('Unable to load kinds right now.', 500)
  }
}

export async function POST(request: NextRequest) {
  const denied = requireOwner(request)
  if (denied) return denied

  const parsed = await readJsonBody<{ slug?: unknown; label?: unknown; eyebrow?: unknown }>(
    request,
    { maxBytes: MAX_BODY_BYTES }
  )
  if (!parsed.ok) return jsonError(parsed.error, parsed.status)

  const slug = typeof parsed.body?.slug === 'string' ? parsed.body.slug.trim() : ''
  const label = typeof parsed.body?.label === 'string' ? parsed.body.label.trim() : ''
  const eyebrow = parsed.body?.eyebrow === true

  if (!KIND_SLUG_PATTERN.test(slug)) {
    return jsonError('Kind slug must match ^[a-z0-9-]{1,48}$.', 400)
  }
  if (!label) return jsonError('A label is required.', 400)

  try {
    await connectDatabase()

    if (await KindModel.exists({ slug })) {
      return jsonError(`The kind "${slug}" already exists.`, 409)
    }

    const last = await KindModel.findOne({}).sort({ order: -1 }).select('order').lean()
    const created = await KindModel.create({
      slug,
      label,
      eyebrow,
      order: (last?.order ?? -1) + 1,
    })

    return NextResponse.json({
      kind: {
        id: String(created._id),
        slug: created.slug,
        label: created.label,
        eyebrow: created.eyebrow,
        order: created.order,
        postCount: 0,
      },
    })
  } catch {
    return jsonError('Unable to create the kind right now.', 500)
  }
}
