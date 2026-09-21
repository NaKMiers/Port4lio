import { connectDatabase } from '@/lib/mongodb'
import {
  PostEventModel,
  postEventExpiryFrom,
  type PostEventKind,
} from '@/models/PostEvent'

/**
 * Write one blog event. Never throws.
 *
 * Written standalone rather than through a helper shared with `lib/test-events.ts`
 * `recordEvent` (D4). The shape is the same on purpose - `$inc count` with `upsert`, subject
 * in the `_id` - but the TTL, the id grammar and the privacy promise all differ, and two call
 * sites is not enough to justify an abstraction that would have to know about all three.
 * Extracting it would also strand the doc comments at `test-events.ts:34-40` and `:111-117`
 * on an empty wrapper. Revisit at three collections.
 *
 * ## Fire-and-forget, same doctrine as `test-events.ts`
 *
 * These rows are worth nothing next to the page they instrument. A Mongo blip must never
 * blank a post somebody arrived at from a cross-post, so this logs and returns rather than
 * rejecting. The trade is explicit: an outage means missing measurement, never a broken page.
 *
 * ## `$inc` with `upsert` is the whole concurrency story
 *
 * Two simultaneous writes cannot both read 0 and both write 1, because neither reads at all.
 * And because the subject is in the `_id`, the second one updates the first document rather
 * than creating a sibling - which is what makes "count documents, never sum count" work.
 */
export async function recordPostEvent(input: {
  kind: PostEventKind
  slug: string
  /** The part of the `_id` after the kind. A session id, a share token, or both. */
  subject: string
}): Promise<void> {
  const { kind, slug, subject } = input

  try {
    await connectDatabase()
    const now = new Date()

    await PostEventModel.findByIdAndUpdate(
      `blog:${kind}:${subject}`,
      {
        $inc: { count: 1 },
        // Set only on insert: `createdAt` is when this subject was FIRST seen, and letting a
        // re-fire move it would turn "when did this post start getting read" into "when was
        // it last read". `expireAt` likewise - a popular post must not have its retention
        // window extended indefinitely by being popular.
        $setOnInsert: {
          kind,
          slug,
          clientReported: true,
          createdAt: now,
          expireAt: postEventExpiryFrom(now),
        },
      },
      { upsert: true }
    )
  } catch (error) {
    console.error(
      `[blog] could not record ${kind} for ${slug} - continuing`,
      error
    )
  }
}

export type PostMetrics = {
  slug: string
  /** DOCUMENTS, never a sum of `count`. See the model's header. */
  views: number
  shares: number
  attributions: number
}

/**
 * Per-slug counts for the admin board.
 *
 * ## `$sum: 1`, and why `$sum: '$count'` would be a bug
 *
 * `count` records how many times one subject re-fired: one reader refreshing a post five
 * times produces a single document with `count: 5`. Summing it would report five readers.
 * Counting documents reports one, which is the question being asked.
 *
 * The rule is inherited from `TestEvent.ts` and is stated there too, because it is the kind
 * of thing that looks like a missed optimisation to whoever reads the aggregation next.
 */
export async function aggregatePostMetrics(): Promise<
  Map<string, PostMetrics>
> {
  await connectDatabase()

  const rows = await PostEventModel.aggregate<{
    _id: { slug: string; kind: PostEventKind }
    documents: number
  }>([
    {
      $group: { _id: { slug: '$slug', kind: '$kind' }, documents: { $sum: 1 } },
    },
  ])

  const metrics = new Map<string, PostMetrics>()

  for (const row of rows) {
    const current = metrics.get(row._id.slug) ?? {
      slug: row._id.slug,
      views: 0,
      shares: 0,
      attributions: 0,
    }

    if (row._id.kind === 'view') current.views = row.documents
    if (row._id.kind === 'share') current.shares = row.documents
    if (row._id.kind === 'attribute') current.attributions = row.documents

    metrics.set(row._id.slug, current)
  }

  return metrics
}
