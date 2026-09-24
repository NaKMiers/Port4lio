import 'server-only'

import { connectDatabase } from '@/lib/mongodb'
import { TEST_PRODUCTS, type TestProduct } from '@/lib/test-kit/nav'
import { TestEventModel } from '@/models/TestEvent'

/**
 * The MBTI / IQ funnel read, per product - moved from `GET /api/admin/metrics` so the admin
 * board and the site MCP's briefing read the same numbers (premise 2). The route is now a
 * gate and a `NextResponse.json` around `readTestMetrics`.
 *
 * ```
 *   per product in TEST_PRODUCTS:
 *     funnel        $sum count per event    (day buckets: summing IS right)
 *     shares        countDocuments          (one doc = one share)
 *     attributions  countDocuments
 *     shareRate     attributions / shares, null with no shares
 *     abandonment   { sessions, medianFurthest }   count, then skip to the middle
 * ```
 *
 * ## Why the shape is keyed by product
 *
 * Every query here used to hardcode `product: 'mbti'`, so the IQ test recorded events that
 * nothing ever read. Iterating `TEST_PRODUCTS` instead means a third product appears on the
 * dashboard the day it starts emitting, with no change here - and a product with no events
 * yet still renders its zeros rather than vanishing, which is the reading you want while
 * waiting for the first one.
 *
 * ## Why `countDocuments`, never `$sum: count`
 *
 * For `share` / `attribute` / `progress`, a document IS one real-world occurrence. Its
 * `count` field records how many times that same occurrence re-fired - StrictMode, a
 * refresh, a tab switch. Summing `count` would reintroduce the exact double-counting the
 * composite `_id` exists to prevent, and the resulting share rate would read high while
 * looking perfectly plausible.
 *
 * Funnel counters are the one place summing IS right: each document is a day-bucket, and
 * `count` is genuinely how many happened that day.
 *
 * `tests/api/admin-metrics-route.test.ts` pins every number here field by field (R10).
 */

export type ProductMetrics = {
  funnel: Record<string, number>
  shares: number
  attributions: number
  shareRate: number | null
  abandonment: { sessions: number; medianFurthest: number | null }
}

export async function readTestMetrics(): Promise<
  Record<TestProduct, ProductMetrics>
> {
  await connectDatabase()

  const entries = await Promise.all(
    TEST_PRODUCTS.map(
      async product => [product, await readProduct(product)] as const
    )
  )

  return Object.fromEntries(entries) as Record<TestProduct, ProductMetrics>
}

async function readProduct(product: TestProduct): Promise<ProductMetrics> {
  const [funnel, shares, attributions, progressSessions] = await Promise.all([
    TestEventModel.aggregate<{ _id: string; total: number }>([
      { $match: { product, kind: 'funnel' } },
      { $group: { _id: '$event', total: { $sum: '$count' } } },
    ]),
    TestEventModel.countDocuments({ product, kind: 'share' }),
    TestEventModel.countDocuments({ product, kind: 'attribute' }),
    TestEventModel.countDocuments({ product, kind: 'progress' }),
  ])

  /**
   * The median, without loading every row.
   *
   * Reading all progress documents to sort them in Node would grow with traffic, and this
   * page is the one place that gets slower exactly as the product starts working. Counting
   * first and then skipping to the middle keeps both reads bounded: one count, one
   * single-document fetch, regardless of how many sessions exist.
   */
  const medianDoc = progressSessions
    ? await TestEventModel.find(
        { product, kind: 'progress' },
        { 'data.furthest': 1 }
      )
        .sort({ 'data.furthest': 1 })
        .skip(Math.floor(progressSessions / 2))
        .limit(1)
        .lean()
    : []

  const medianFurthest = medianDoc.length
    ? Number((medianDoc[0]?.data as { furthest?: unknown })?.furthest ?? 0) ||
      null
    : null

  return {
    funnel: Object.fromEntries(funnel.map(row => [row._id, row.total])),
    /** Distinct shares and distinct arrivals-from-a-share. Documents, not sums. */
    shares,
    attributions,
    /** Arrivals per share. The number the loop is judged on. */
    shareRate: shares > 0 ? attributions / shares : null,
    abandonment: { sessions: progressSessions, medianFurthest },
  }
}
