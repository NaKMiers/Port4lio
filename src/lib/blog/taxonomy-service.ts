import 'server-only'

import { revalidatePath } from 'next/cache'

import { KIND_SLUG_PATTERN, SERIES_SLUG_PATTERN } from '@/lib/blog/constants'
import { postsUsingKind } from '@/lib/blog/kind-data'
import type { ServiceResult } from '@/lib/blog/post-service'
import { postsUsingSeries } from '@/lib/blog/series-data'
import { connectDatabase } from '@/lib/mongodb'
import { KindModel } from '@/models/Kind'
import { SeriesModel } from '@/models/Series'

/**
 * Kinds and series: create, relabel, delete - moved from `/api/admin/blog/kinds/**` and
 * `/api/admin/blog/series/**`, whose routes are now a gate and a response around these.
 *
 * ```
 *   create   slug pattern · unique · appended to the order          no revalidation: unused yet
 *   update   the slug is frozen (posts reference it) ──▶ 400
 *            label / title / blurb / eyebrow / order ──▶ save ──▶ revalidatePath('/blog')
 *   delete   still used by posts ──▶ 409 + the posts
 *            the last kind       ──▶ 409  (every post must have one; series may be empty)
 *            ──▶ deleteOne ──▶ revalidatePath('/blog')
 * ```
 *
 * ## Why `revalidatePath('/blog')` lives here (C8)
 *
 * A kind's `label` prints on the listing card for any kind with `eyebrow` set, and a series
 * title heads its cluster, so relabelling either changes `/blog` - which would otherwise hold
 * the old word for its 300 s ISR window. The call moved in with the write so that no front
 * door can make the change and skip the invalidation. A literal path, never the pattern form;
 * see `lib/blog/revalidate.ts`.
 *
 * ## The last-kind guard, which has no series equivalent
 *
 * `Post.series` is nullable - a post with no series renders under "Everything else", which is
 * a real and reasonable state. `Post.kind` is `required`, so emptying the kinds would break
 * post creation outright: `createBarePost` asks `defaultKindSlug()` for a kind and has nothing
 * to fall back on. Refusing here keeps that unreachable.
 *
 * The MCP's `save_taxonomy` tool was cut from the registry (acceptance.md D1); the extraction
 * stays, because this is still the one place the revalidation rule lives.
 */

type Failure = {
  ok: false
  status: number
  error: string
  extra?: Record<string, unknown>
}

const fail = (
  status: number,
  error: string,
  extra?: Record<string, unknown>
): Failure => ({
  ok: false,
  status,
  error,
  extra,
})

function isValidationError(error: unknown) {
  return error instanceof Error && error.name === 'ValidationError'
}

// MARK: Kinds

export interface KindView {
  id: string
  slug: string
  label: string
  eyebrow: boolean
  order: number
}

export async function createKind(input: {
  slug?: unknown
  label?: unknown
  eyebrow?: unknown
}): Promise<ServiceResult<KindView & { postCount: number }>> {
  const slug = typeof input.slug === 'string' ? input.slug.trim() : ''
  const label = typeof input.label === 'string' ? input.label.trim() : ''
  const eyebrow = input.eyebrow === true

  if (!KIND_SLUG_PATTERN.test(slug))
    return fail(400, 'Kind slug must match ^[a-z0-9-]{1,48}$.')
  if (!label) return fail(400, 'A label is required.')

  await connectDatabase()

  if (await KindModel.exists({ slug }))
    return fail(409, `The kind "${slug}" already exists.`)

  const last = await KindModel.findOne({})
    .sort({ order: -1 })
    .select('order')
    .lean()
  const created = await KindModel.create({
    slug,
    label,
    eyebrow,
    order: (last?.order ?? -1) + 1,
  })

  return {
    ok: true,
    value: {
      id: String(created._id),
      slug: created.slug,
      label: created.label,
      eyebrow: created.eyebrow,
      order: created.order,
      postCount: 0,
    },
  }
}

export async function updateKind(
  id: string,
  body: { label?: unknown; eyebrow?: unknown; order?: unknown; slug?: unknown }
): Promise<ServiceResult<KindView>> {
  if ('slug' in body && body.slug !== undefined)
    return fail(
      400,
      'A kind slug cannot be changed - posts reference it. Create the new kind, move the posts, then delete the old one.'
    )

  await connectDatabase()

  const kind = await KindModel.findById(id)
  if (!kind) return fail(404, 'Kind not found.')

  if (typeof body.label === 'string') {
    const label = body.label.trim()
    if (!label) return fail(400, 'A label is required.')
    kind.label = label
  }
  if (typeof body.eyebrow === 'boolean') kind.eyebrow = body.eyebrow
  if (typeof body.order === 'number' && Number.isFinite(body.order))
    kind.order = Math.round(body.order)

  try {
    await kind.save()
  } catch (error) {
    if (isValidationError(error)) return fail(400, (error as Error).message)
    throw error
  }
  revalidatePath('/blog')

  return {
    ok: true,
    value: {
      id: String(kind._id),
      slug: kind.slug,
      label: kind.label,
      eyebrow: kind.eyebrow,
      order: kind.order,
    },
  }
}

export async function deleteKind(
  id: string
): Promise<ServiceResult<{ ok: true }>> {
  await connectDatabase()

  const kind = await KindModel.findById(id)
  if (!kind) return fail(404, 'Kind not found.')

  // Checked before the in-use count, because it is the one an owner cannot work around by
  // moving posts - saying so first avoids sending them to reassign posts pointlessly.
  if ((await KindModel.countDocuments({})) <= 1)
    return fail(
      409,
      'This is the only kind left. Every post must have one, so create another before deleting this.'
    )

  const inUse = await postsUsingKind(kind.slug)
  if (inUse.length > 0)
    return fail(
      409,
      `"${kind.label}" is still used by ${inUse.length} post${inUse.length === 1 ? '' : 's'}. Move them to another kind first.`,
      { posts: inUse }
    )

  await kind.deleteOne()
  revalidatePath('/blog')

  return { ok: true, value: { ok: true } }
}

// MARK: Series

export interface SeriesView {
  id: string
  slug: string
  title: string
  blurb: string
  order: number
}

export async function createSeries(input: {
  slug?: unknown
  title?: unknown
  blurb?: unknown
}): Promise<ServiceResult<SeriesView & { postCount: number }>> {
  const slug = typeof input.slug === 'string' ? input.slug.trim() : ''
  const title = typeof input.title === 'string' ? input.title.trim() : ''
  const blurb = typeof input.blurb === 'string' ? input.blurb.trim() : ''

  if (!SERIES_SLUG_PATTERN.test(slug))
    return fail(400, 'Series slug must match ^[a-z0-9-]{1,48}$.')
  if (!title) return fail(400, 'A title is required.')

  await connectDatabase()

  if (await SeriesModel.exists({ slug }))
    return fail(409, `The series "${slug}" already exists.`)

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

  return {
    ok: true,
    value: {
      id: String(created._id),
      slug: created.slug,
      title: created.title,
      blurb: created.blurb,
      order: created.order,
      postCount: 0,
    },
  }
}

export async function updateSeries(
  id: string,
  body: { title?: unknown; blurb?: unknown; order?: unknown; slug?: unknown }
): Promise<ServiceResult<SeriesView>> {
  if ('slug' in body && body.slug !== undefined)
    return fail(
      400,
      'A series slug cannot be changed - posts reference it. Create the new series, move the posts, then delete the old one.'
    )

  await connectDatabase()

  const series = await SeriesModel.findById(id)
  if (!series) return fail(404, 'Series not found.')

  if (typeof body.title === 'string') {
    const title = body.title.trim()
    if (!title) return fail(400, 'A title is required.')
    series.title = title
  }
  if (typeof body.blurb === 'string') series.blurb = body.blurb.trim()
  if (typeof body.order === 'number' && Number.isFinite(body.order))
    series.order = Math.round(body.order)

  try {
    await series.save()
  } catch (error) {
    if (isValidationError(error)) return fail(400, (error as Error).message)
    throw error
  }
  revalidatePath('/blog')

  return {
    ok: true,
    value: {
      id: String(series._id),
      slug: series.slug,
      title: series.title,
      blurb: series.blurb,
      order: series.order,
    },
  }
}

export async function deleteSeries(
  id: string
): Promise<ServiceResult<{ ok: true }>> {
  await connectDatabase()

  const series = await SeriesModel.findById(id)
  if (!series) return fail(404, 'Series not found.')

  const inUse = await postsUsingSeries(series.slug)
  if (inUse.length > 0)
    return fail(
      409,
      `"${series.title}" is still used by ${inUse.length} post${inUse.length === 1 ? '' : 's'}. Move them to another series first.`,
      { posts: inUse }
    )

  await series.deleteOne()
  revalidatePath('/blog')

  return { ok: true, value: { ok: true } }
}
