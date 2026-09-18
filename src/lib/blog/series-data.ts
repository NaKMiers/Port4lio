import 'server-only'

import { SEED_SERIES } from '@/lib/blog/constants'
import { connectDatabase } from '@/lib/mongodb'
import { PostModel } from '@/models/Post'
import { SeriesModel } from '@/models/Series'

/**
 * Reads and integrity checks for the `blog_series` collection.
 *
 * `import 'server-only'` for the same reason `markdown.ts` has it: `SeriesModel` pulls in
 * mongoose, and a client component importing anything from here would drag the whole mongodb
 * driver into the browser bundle. The editor gets its list over HTTP instead.
 */

export type SeriesRecord = {
  id: string
  slug: string
  title: string
  blurb: string
  order: number
  /** How many posts point at this slug. Drives the delete guard and the board's counts. */
  postCount: number
}

/**
 * Put the three original series in the database if the collection is empty.
 *
 * Every post already written references one of these slugs, so without this an existing
 * database renders `/blog` with every cluster missing and every post in "Everything else" -
 * a silent regression that looks like data loss. Running it on read rather than as a
 * migration script keeps it true for a fresh clone, a test database and production without
 * anyone having to remember a step.
 *
 * Guarded on the collection being EMPTY rather than upserting each slug, which matters: an
 * upsert per slug would resurrect a series the owner deliberately deleted, every time the
 * index revalidated. Seeding is a first-run action, not a reconciliation.
 */
export async function ensureSeriesSeeded(): Promise<void> {
  if ((await SeriesModel.estimatedDocumentCount()) > 0) return

  await SeriesModel.insertMany(
    SEED_SERIES.map((series, index) => ({ ...series, order: index })),
    // A concurrent first request may win the race between the count and the insert. That is
    // a duplicate key on `slug`, not a problem, and it must not fail the page render.
    { ordered: false }
  ).catch(() => undefined)
}

/** Ordered, without post counts. What the public index needs. */
export async function listSeries(): Promise<Omit<SeriesRecord, 'postCount'>[]> {
  await connectDatabase()
  await ensureSeriesSeeded()

  const rows = await SeriesModel.find({}).sort({ order: 1, slug: 1 }).lean()

  return rows.map(row => ({
    id: String(row._id),
    slug: row.slug,
    title: row.title,
    blurb: row.blurb ?? '',
    order: row.order ?? 0,
  }))
}

/**
 * Ordered, with a post count per series. What the manage dialog needs.
 *
 * One `$group` rather than a `countDocuments` per series: the dialog is owner-only and the
 * list is short, but N+1 against a collection that grows is the kind of thing that is free
 * to avoid now and annoying to notice later.
 *
 * Counts EVERY status including `deleted`. A soft-deleted post still holds its series
 * reference, so a series that looks unused by published-post count is still referenced - and
 * deleting it would leave a dangling value on a document that can be restored.
 */
export async function listSeriesWithCounts(): Promise<SeriesRecord[]> {
  await connectDatabase()
  await ensureSeriesSeeded()

  const [rows, counts] = await Promise.all([
    SeriesModel.find({}).sort({ order: 1, slug: 1 }).lean(),
    PostModel.aggregate<{ _id: string; n: number }>([
      { $match: { series: { $ne: null } } },
      { $group: { _id: '$series', n: { $sum: 1 } } },
    ]),
  ])

  const bySlug = new Map(counts.map(row => [row._id, row.n]))

  return rows.map(row => ({
    id: String(row._id),
    slug: row.slug,
    title: row.title,
    blurb: row.blurb ?? '',
    order: row.order ?? 0,
    postCount: bySlug.get(row.slug) ?? 0,
  }))
}

/** Titles of the posts still pointing at a slug, for the delete guard's error message. */
export async function postsUsingSeries(slug: string): Promise<{ id: string; title: string }[]> {
  const rows = await PostModel.find({ series: slug }).select('title').limit(20).lean()
  return rows.map(row => ({ id: String(row._id), title: row.title }))
}

/** Whether a slug exists. The write path's replacement for the old mongoose enum. */
export async function seriesExists(slug: string): Promise<boolean> {
  return (await SeriesModel.exists({ slug })) !== null
}
