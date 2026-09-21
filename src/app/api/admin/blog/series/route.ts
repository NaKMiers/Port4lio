import { NextResponse, type NextRequest } from 'next/server'

import { jsonError } from '@/lib/api-response'
import { SERIES_SLUG_PATTERN } from '@/lib/blog/constants'
import { listSeriesWithCounts } from '@/lib/blog/series-data'
import { connectDatabase } from '@/lib/mongodb'
import { readJsonBody } from '@/lib/read-json-body'
import { requireOwner } from '@/lib/require-owner'
import { SeriesModel } from '@/models/Series'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** A series is a slug, a title and one line of blurb. Nothing large. */
const MAX_BODY_BYTES = 8 * 1024

/**
 * [GET]  /api/admin/blog/series - the manage dialog's list, with post counts
 * [POST] /api/admin/blog/series - create one
 *
 * Gated by `requireOwner` as the first statement, matching the six handlers that came before
 * it - a 401 should cost an unauthorised caller nothing of ours.
 *
 * ## Why the editor reads its dropdown from here and not from a constant
 *
 * It used to import `POST_SERIES` directly, which was correct while the list was frozen at
 * build time. Now the list lives in a collection, and a client component cannot import
 * `SeriesModel` without pulling mongoose into the browser bundle - the exact failure
 * `lib/blog/constants.ts` documents at the top. So the dropdown is fetched, and this is the
 * only route that serves it.
 */
export async function GET(request: NextRequest) {
  const denied = requireOwner(request)
  if (denied) return denied

  try {
    return NextResponse.json({ series: await listSeriesWithCounts() })
  } catch {
    return jsonError('Unable to load series right now.', 500)
  }
}

export async function POST(request: NextRequest) {
  const denied = requireOwner(request)
  if (denied) return denied

  const parsed = await readJsonBody<{
    slug?: unknown
    title?: unknown
    blurb?: unknown
  }>(request, { maxBytes: MAX_BODY_BYTES })
  if (!parsed.ok) return jsonError(parsed.error, parsed.status)

  const slug =
    typeof parsed.body?.slug === 'string' ? parsed.body.slug.trim() : ''
  const title =
    typeof parsed.body?.title === 'string' ? parsed.body.title.trim() : ''
  const blurb =
    typeof parsed.body?.blurb === 'string' ? parsed.body.blurb.trim() : ''

  if (!SERIES_SLUG_PATTERN.test(slug))
    return jsonError('Series slug must match ^[a-z0-9-]{1,48}$.', 400)

  if (!title) return jsonError('A title is required.', 400)

  try {
    await connectDatabase()

    if (await SeriesModel.exists({ slug }))
      return jsonError(`The series "${slug}" already exists.`, 409)

    // Appended, not prepended. A new series is the least established one, and the index
    // order is editorial - putting it first would silently demote the pillar clusters.
    const last = await SeriesModel.findOne({})
      .sort({ order: -1 })
      .select('order')
      .lean()
    const created = await SeriesModel.create({
      slug,
      title,
      blurb,
      order: (last?.order ?? -1) + 1,
    })

    return NextResponse.json({
      series: {
        id: String(created._id),
        slug: created.slug,
        title: created.title,
        blurb: created.blurb,
        order: created.order,
        postCount: 0,
      },
    })
  } catch {
    return jsonError('Unable to create the series right now.', 500)
  }
}
