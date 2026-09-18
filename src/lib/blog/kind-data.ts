import 'server-only'

import { SEED_KINDS } from '@/lib/blog/constants'
import { connectDatabase } from '@/lib/mongodb'
import { KindModel } from '@/models/Kind'
import { PostModel } from '@/models/Post'

/**
 * Reads and integrity checks for `blog_kinds`. The mirror of `series-data.ts`.
 *
 * `import 'server-only'` for the same reason: `KindModel` pulls in mongoose, and a client
 * component importing from here would drag the mongodb driver into the browser bundle.
 */

export type KindRecord = {
  id: string
  slug: string
  label: string
  eyebrow: boolean
  order: number
  postCount: number
}

/** What `PostCard` needs to render one post's kind, keyed by slug. */
export type KindPresentation = { label: string; eyebrow: boolean }

/**
 * Seed `article` and `note` into an empty collection.
 *
 * Same first-run-only guard as `ensureSeriesSeeded`, and for the same reason: an
 * upsert-per-slug would resurrect a kind the owner deleted, every time the index revalidated.
 */
export async function ensureKindsSeeded(): Promise<void> {
  if ((await KindModel.estimatedDocumentCount()) > 0) return

  await KindModel.insertMany(
    SEED_KINDS.map((kind, index) => ({ ...kind, order: index })),
    { ordered: false }
  ).catch(() => undefined)
}

export async function listKinds(): Promise<Omit<KindRecord, 'postCount'>[]> {
  await connectDatabase()
  await ensureKindsSeeded()

  const rows = await KindModel.find({}).sort({ order: 1, slug: 1 }).lean()

  return rows.map(row => ({
    id: String(row._id),
    slug: row.slug,
    label: row.label,
    eyebrow: row.eyebrow ?? false,
    order: row.order ?? 0,
  }))
}

/** The lookup `/blog` hands to each card, so a card never queries for itself. */
export async function kindPresentationMap(): Promise<Map<string, KindPresentation>> {
  const kinds = await listKinds()
  return new Map(kinds.map(kind => [kind.slug, { label: kind.label, eyebrow: kind.eyebrow }]))
}

export async function listKindsWithCounts(): Promise<KindRecord[]> {
  await connectDatabase()
  await ensureKindsSeeded()

  const [rows, counts] = await Promise.all([
    KindModel.find({}).sort({ order: 1, slug: 1 }).lean(),
    PostModel.aggregate<{ _id: string; n: number }>([{ $group: { _id: '$kind', n: { $sum: 1 } } }]),
  ])

  const bySlug = new Map(counts.map(row => [row._id, row.n]))

  return rows.map(row => ({
    id: String(row._id),
    slug: row.slug,
    label: row.label,
    eyebrow: row.eyebrow ?? false,
    order: row.order ?? 0,
    postCount: bySlug.get(row.slug) ?? 0,
  }))
}

export async function postsUsingKind(slug: string): Promise<{ id: string; title: string }[]> {
  const rows = await PostModel.find({ kind: slug }).select('title').limit(20).lean()
  return rows.map(row => ({ id: String(row._id), title: row.title }))
}

export async function kindExists(slug: string): Promise<boolean> {
  return (await KindModel.exists({ slug })) !== null
}

/**
 * The kind a brand-new draft gets: first by `order`.
 *
 * `PostModel.create({ slug, title, status })` used to fall through to the schema's
 * `default: 'note'`, which is exactly the thing an editable list cannot keep - delete `note`
 * and every subsequent draft is created pointing at a kind that does not exist, silently,
 * with no write path involved to catch it.
 *
 * Returns `null` only if the collection is empty, which `DELETE` refuses to allow.
 */
export async function defaultKindSlug(): Promise<string | null> {
  await ensureKindsSeeded()
  const first = await KindModel.findOne({}).sort({ order: 1, slug: 1 }).select('slug').lean()
  return first?.slug ?? null
}
