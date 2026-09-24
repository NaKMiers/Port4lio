import 'server-only'

import { FUNNEL_EVENTS } from '@/lib/test-events'
import { TEST_PRODUCTS, type TestProduct } from '@/lib/test-kit/nav'
import { connectDatabase } from '@/lib/mongodb'
import { IqPaymentModel } from '@/models/IqPayment'
import { PaymentModel } from '@/models/Payment'
import {
  BLOG_EVENT_TTL_DAYS,
  PostEventModel,
  type PostEventKind,
} from '@/models/PostEvent'
import { PostModel } from '@/models/Post'
import { SubscriberModel } from '@/models/Subscriber'
import { ATTEMPT_TTL_DAYS } from '@/models/Attempt'
import { TestEventModel } from '@/models/TestEvent'

/**
 * "How did this week go?" - one period against the equal period before it, every section
 * computed only over data that still exists (mcp.md "get_briefing windows follow retention").
 *
 * ```
 *   period N days (week = 7)      current  = [now - N, now)      previous = [now - 2N, now - N)
 *
 *   section               source                                         both windows must fit
 *   blog                  PostEvent documents by createdAt (never $sum)   2N <= 180 days  ──▶ N <= 90
 *   subscribers           Subscriber.confirmedAt / unsubscribedAt         any N
 *   orders + revenue      Payment + IqPayment, status paid, by paidAt     any N (paid rows are kept)
 *   test funnel           TestEvent funnel day buckets, full UTC days     2N <= 20 days   ──▶ N <= 10
 *                         ending yesterday (today is partial)
 *     conversion = paid / paywall-seen, per product
 *
 *   a section whose windows do not fit is LEFT OUT, with a one-line reason - never computed
 *   over data the TTL has already deleted
 * ```
 *
 * ## Why a section is omitted rather than computed "as far as it goes"
 *
 * A month's test funnel over a 21-day TTL would compare 21 days of this month against zero
 * days of last month and report a collapse that never happened - and it would look exactly
 * like a real number. The briefing is read by an agent that will write it up with
 * confidence, so the only safe answer to "I do not have that data" is to say so.
 *
 * ## Why aggregates only
 *
 * Premise 5: no customer's personal data leaves the server. Every query below counts or sums;
 * none projects an email, a name or an attempt token, and `tests/api/mcp-metrics.test.ts`
 * seeds real-looking customer rows and greps every tool answer for them.
 *
 * The date indexes this reads through are R11: `PostEvent { kind, createdAt }` and
 * `Payment` / `IqPayment { status, paidAt }`.
 */

const DAY_MS = 86_400_000

/** Both windows inside the 180-day event TTL. */
export const MAX_BLOG_DAYS = Math.floor(BLOG_EVENT_TTL_DAYS / 2)
/** Both windows inside the 21-day attempt TTL, in whole days with a day of margin. */
export const MAX_FUNNEL_DAYS = Math.floor((ATTEMPT_TTL_DAYS - 1) / 2)

export const TOP_POSTS = 10

export interface Window {
  from: Date
  to: Date
}

export interface Compared {
  current: number
  previous: number
  change: number
}

const compare = (current: number, previous: number): Compared => ({
  current,
  previous,
  change: current - previous,
})

export type Section<T> =
  ({ included: true } & T) | { included: false; reason: string }

export interface Briefing {
  days: number
  current: { from: string; to: string }
  previous: { from: string; to: string }
  blog: Section<{
    views: Compared
    shares: Compared
    attributions: Compared
    topPosts: {
      slug: string
      title: string
      views: number
      previousViews: number
    }[]
  }>
  subscribers: Section<{
    confirmed: Compared
    unsubscribed: Compared
    activeNow: number
  }>
  orders: Section<{
    currency: 'VND'
    byProduct: Record<TestProduct, { paid: Compared; revenue: Compared }>
    total: { paid: Compared; revenue: Compared }
  }>
  testFunnel: Section<{
    note: string
    byProduct: Record<
      TestProduct,
      {
        resultViewed: Compared
        paywallSeen: Compared
        checkoutStarted: Compared
        paid: Compared
        conversion: { current: number | null; previous: number | null }
      }
    >
  }>
}

export function windowsFor(days: number, now = new Date()) {
  const current: Window = {
    from: new Date(now.getTime() - days * DAY_MS),
    to: now,
  }
  const previous: Window = {
    from: new Date(now.getTime() - 2 * days * DAY_MS),
    to: current.from,
  }
  return { current, previous }
}

const inWindow = ({ from, to }: Window) => ({ $gte: from, $lt: to })

async function blogSection(
  days: number,
  current: Window,
  previous: Window
): Promise<Briefing['blog']> {
  if (days > MAX_BLOG_DAYS)
    return {
      included: false,
      reason: `Blog events are kept ${BLOG_EVENT_TTL_DAYS} days, so a ${days}-day period and the one before it do not both fit. Ask for ${MAX_BLOG_DAYS} days or fewer.`,
    }

  const count = (kind: PostEventKind, window: Window) =>
    PostEventModel.countDocuments({ kind, createdAt: inWindow(window) })

  /*
    Only slugs of real posts. `/api/blog/event` is public and anonymous, so its slug is
    whatever a client sent - an invented one would otherwise crowd out real posts and put
    arbitrary text, as a "title", in front of the agent writing the briefing up.
  */
  const known = await PostModel.distinct('slug', { status: { $ne: 'deleted' } })
  const topViews = (window: Window, slugs: string[] = known) =>
    PostEventModel.aggregate<{ _id: string; views: number }>([
      {
        $match: {
          kind: 'view',
          createdAt: inWindow(window),
          slug: { $in: slugs },
        },
      },
      // Documents, never `$sum: '$count'` - one document is one reader (see TestEvent.ts).
      { $group: { _id: '$slug', views: { $sum: 1 } } },
      { $sort: { views: -1, _id: 1 } },
      ...(slugs === known ? [{ $limit: TOP_POSTS }] : []),
    ])

  const [
    views,
    previousViews,
    shares,
    previousShares,
    attributions,
    previousAttributions,
    top,
  ] = await Promise.all([
    count('view', current),
    count('view', previous),
    count('share', current),
    count('share', previous),
    count('attribute', current),
    count('attribute', previous),
    topViews(current),
  ])

  const slugs = top.map(row => row._id)
  const [before, posts] = await Promise.all([
    slugs.length ? topViews(previous, slugs) : Promise.resolve([]),
    PostModel.find({ slug: { $in: slugs } })
      .select('slug title')
      .lean(),
  ])
  const titleOf = new Map(posts.map(post => [post.slug, post.title]))
  const previousOf = new Map(before.map(row => [row._id, row.views]))

  return {
    included: true,
    views: compare(views, previousViews),
    shares: compare(shares, previousShares),
    attributions: compare(attributions, previousAttributions),
    topPosts: top.map(row => ({
      slug: row._id,
      title: titleOf.get(row._id) ?? '(untitled)',
      views: row.views,
      previousViews: previousOf.get(row._id) ?? 0,
    })),
  }
}

async function subscriberSection(
  current: Window,
  previous: Window
): Promise<Briefing['subscribers']> {
  const [
    confirmed,
    previousConfirmed,
    unsubscribed,
    previousUnsubscribed,
    activeNow,
  ] = await Promise.all([
    SubscriberModel.countDocuments({ confirmedAt: inWindow(current) }),
    SubscriberModel.countDocuments({ confirmedAt: inWindow(previous) }),
    SubscriberModel.countDocuments({ unsubscribedAt: inWindow(current) }),
    SubscriberModel.countDocuments({ unsubscribedAt: inWindow(previous) }),
    SubscriberModel.countDocuments({ status: 'confirmed' }),
  ])
  return {
    included: true,
    confirmed: compare(confirmed, previousConfirmed),
    unsubscribed: compare(unsubscribed, previousUnsubscribed),
    activeNow,
  }
}

async function paidIn(
  model: typeof PaymentModel | typeof IqPaymentModel,
  window: Window
) {
  const [row] = await (model as typeof PaymentModel).aggregate<{
    paid: number
    revenue: number
  }>([
    { $match: { status: 'paid', paidAt: inWindow(window) } },
    { $group: { _id: null, paid: { $sum: 1 }, revenue: { $sum: '$amount' } } },
  ])
  return { paid: row?.paid ?? 0, revenue: row?.revenue ?? 0 }
}

async function ordersSection(
  current: Window,
  previous: Window
): Promise<Briefing['orders']> {
  const models: Record<
    TestProduct,
    typeof PaymentModel | typeof IqPaymentModel
  > = {
    mbti: PaymentModel,
    iq: IqPaymentModel,
  }
  const byProduct = {} as Record<
    TestProduct,
    { paid: Compared; revenue: Compared }
  >
  let paid = 0
  let previousPaid = 0
  let revenue = 0
  let previousRevenue = 0
  for (const product of TEST_PRODUCTS) {
    const [now, before] = await Promise.all([
      paidIn(models[product], current),
      paidIn(models[product], previous),
    ])
    byProduct[product] = {
      paid: compare(now.paid, before.paid),
      revenue: compare(now.revenue, before.revenue),
    }
    paid += now.paid
    previousPaid += before.paid
    revenue += now.revenue
    previousRevenue += before.revenue
  }
  return {
    included: true,
    currency: 'VND',
    byProduct,
    total: {
      paid: compare(paid, previousPaid),
      revenue: compare(revenue, previousRevenue),
    },
  }
}

/** `YYYY-MM-DD` for the `days` UTC days ending `endingDaysAgo` days before today, newest last. */
function dayBuckets(days: number, endingDaysAgo: number, now: Date) {
  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate()
  )
  return Array.from({ length: days }, (_, index) =>
    new Date(today - (endingDaysAgo + days - 1 - index) * DAY_MS)
      .toISOString()
      .slice(0, 10)
  )
}

async function funnelSection(
  days: number,
  now: Date
): Promise<Briefing['testFunnel']> {
  if (days > MAX_FUNNEL_DAYS)
    return {
      included: false,
      reason: `Test attempts and their funnel events are deleted after ${ATTEMPT_TTL_DAYS} days, so a ${days}-day period and the one before it do not both fit. Ask for ${MAX_FUNNEL_DAYS} days or fewer for the funnel and conversion.`,
    }

  // Both windows are N FULL days, ending yesterday. Counting today's partial day against a
  // full day made every week read low until evening (and the UTC day ends at 07:00 in
  // Vietnam). The oldest bucket is then 2N days back, still inside the TTL for N <= 10.
  const currentDays = dayBuckets(days, 1, now)
  const previousDays = dayBuckets(days, days + 1, now)
  const events = [
    FUNNEL_EVENTS.resultViewed,
    FUNNEL_EVENTS.paywallSeen,
    FUNNEL_EVENTS.checkoutStarted,
    FUNNEL_EVENTS.paid,
  ]

  // Funnel counters are day buckets keyed `<product>:funnel:<event>:<day>`, so a window is an
  // exact `_id` list - and summing `count` IS right here, one document being one day.
  const sums = async (product: TestProduct, dayList: string[]) => {
    const rows = await TestEventModel.aggregate<{ _id: string; total: number }>(
      [
        {
          $match: {
            _id: {
              $in: events.flatMap(event =>
                dayList.map(day => `${product}:funnel:${event}:${day}`)
              ),
            },
          },
        },
        { $group: { _id: '$event', total: { $sum: '$count' } } },
      ]
    )
    const totals = new Map(rows.map(row => [row._id, row.total]))
    return (event: string) => totals.get(event) ?? 0
  }

  const byProduct = {} as Extract<
    Briefing['testFunnel'],
    { included: true }
  >['byProduct']
  for (const product of TEST_PRODUCTS) {
    const [now, before] = await Promise.all([
      sums(product, currentDays),
      sums(product, previousDays),
    ])
    const rate = (get: (event: string) => number) =>
      get(FUNNEL_EVENTS.paywallSeen) > 0
        ? get(FUNNEL_EVENTS.paid) / get(FUNNEL_EVENTS.paywallSeen)
        : null
    byProduct[product] = {
      resultViewed: compare(
        now(FUNNEL_EVENTS.resultViewed),
        before(FUNNEL_EVENTS.resultViewed)
      ),
      paywallSeen: compare(
        now(FUNNEL_EVENTS.paywallSeen),
        before(FUNNEL_EVENTS.paywallSeen)
      ),
      checkoutStarted: compare(
        now(FUNNEL_EVENTS.checkoutStarted),
        before(FUNNEL_EVENTS.checkoutStarted)
      ),
      paid: compare(now(FUNNEL_EVENTS.paid), before(FUNNEL_EVENTS.paid)),
      conversion: { current: rate(now), previous: rate(before) },
    }
  }

  return {
    included: true,
    note: `Counted in whole UTC days: the ${days} full days ending yesterday, against the ${days} before - so today is not in it yet, unlike the blog and order sections, which are rolling ${days}-day windows up to now. Conversion is paid divided by paywall-seen.`,
    byProduct,
  }
}

export async function getBriefing(
  days = 7,
  now = new Date()
): Promise<Briefing> {
  await connectDatabase()
  const { current, previous } = windowsFor(days, now)
  const [blog, subscribers, orders, testFunnel] = await Promise.all([
    blogSection(days, current, previous),
    subscriberSection(current, previous),
    ordersSection(current, previous),
    funnelSection(days, now),
  ])
  return {
    days,
    current: { from: current.from.toISOString(), to: current.to.toISOString() },
    previous: {
      from: previous.from.toISOString(),
      to: previous.to.toISOString(),
    },
    blog,
    subscribers,
    orders,
    testFunnel,
  }
}
