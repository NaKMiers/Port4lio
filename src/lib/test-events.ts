import { connectDatabase } from '@/lib/mongodb'
import {
  dayBucket,
  TestEventModel,
  testEventExpiryFrom,
  testEventId,
  type TestEventKind,
} from '@/models/TestEvent'

/**
 * Writing measurement rows, and the trust boundary around them.
 *
 * ```
 *   BROWSER ──▶ POST /api/event ──▶ assertClientPostable() ──▶ recordEvent()
 *                                          │                        ▲
 *                                    throws on a                    │
 *                                    server-only kind               │
 *   SERVER CODE ───────────────────────────────────────────────────┘
 *   (payos-fulfil, checkout route, result page)   never touches the endpoint
 * ```
 *
 * ## Why server events do not travel through the endpoint
 *
 * `paid` decides whether this product makes money, and it is the number a pricing decision
 * will be made from. If one public endpoint accepted whatever `kind` the caller named, a
 * stranger with `curl` could invent payments - and a forged row is indistinguishable from
 * a real one afterward, so the funnel would be quietly worthless rather than obviously
 * broken.
 *
 * The fix is structural, not a validation table: server-authoritative events are written
 * by server code calling `recordEvent` directly. There is no request shape that reaches
 * them. `assertClientPostable` guards the one door that is open.
 *
 * ## Why every write is fire-and-forget
 *
 * These rows are worth exactly nothing compared to the pages they instrument. A Mongo blip
 * must never blank a result someone paid for, or fail a checkout. `record*` never rejects
 * and never blocks - it logs and moves on. The trade is explicit: an outage means missing
 * measurement, never a broken page.
 */

export const FUNNEL_EVENTS = {
  resultViewed: 'result-viewed',
  paywallSeen: 'paywall-seen',
  checkoutStarted: 'checkout-started',
  paid: 'paid',
  /**
   * A result was released without payment because the attempt did not measure anything.
   *
   * Counted separately from `paid` and deliberately NOT folded into it: a waived unlock is
   * a free result, and letting it touch the paid counter would report revenue that never
   * existed. Read against `result-viewed` it is also the number that says whether the
   * waiver is being discovered and abused - see `lib/test-kit/effort.ts`.
   */
  waived: 'waived',
} as const

/**
 * No funnel event may be reported by a browser. The list is empty on purpose.
 *
 * `paywall-seen` used to be here, on the reasoning that the paywall renders client-side so
 * nothing else knows it was displayed. That stopped being true: both result pages decide
 * `locked` on the server and emit the event there, so the door was standing open with
 * nobody walking through it.
 *
 * Leaving it open was not free. `paywall-seen` is a DENOMINATOR - `/metrics` reads MBTI
 * conversion as `paid / (result-viewed + paywall-seen)` - so forged rows would push the
 * reported conversion rate down, and a rate that is quietly wrong is worse than one that is
 * obviously broken. Kept as an empty list rather than deleted so the next funnel event has
 * to make its case here.
 */
const CLIENT_POSTABLE_FUNNEL_EVENTS: readonly string[] = []

const CLIENT_POSTABLE_KINDS: readonly TestEventKind[] = ['share', 'attribute', 'progress']

export class ServerOnlyEventError extends Error {
  constructor(kind: string, event: string | null) {
    super(`"${kind}${event ? `:${event}` : ''}" is server-authoritative and cannot be posted`)
    this.name = 'ServerOnlyEventError'
  }
}

/**
 * Throws unless a browser is allowed to report this. Called by `/api/event` and by nothing
 * else - server callers are trusted by construction because they are already inside the
 * server.
 */
export function assertClientPostable(kind: string, event: string | null): asserts kind is TestEventKind {
  if (kind === 'funnel') {
    if (!event || !CLIENT_POSTABLE_FUNNEL_EVENTS.includes(event)) {
      throw new ServerOnlyEventError(kind, event)
    }
    return
  }
  if (!CLIENT_POSTABLE_KINDS.includes(kind as TestEventKind)) {
    throw new ServerOnlyEventError(kind, event)
  }
}

type RecordInput = {
  id: string
  product: string
  kind: TestEventKind
  event?: string | null
  clientReported?: boolean
  data?: Record<string, unknown>
  /** Merged into the update with `$max`, so a later, smaller value cannot regress it. */
  max?: Record<string, number>
}

/**
 * Upsert one event row. Never throws.
 *
 * `$inc count` on every write means a repeat of the same real-world event updates the one
 * document rather than adding a second. `count` is a re-fire diagnostic; rates are computed
 * by counting documents.
 */
export async function recordEvent(input: RecordInput): Promise<void> {
  const { id, product, kind, event = null, clientReported = false, data, max } = input
  try {
    await connectDatabase()
    const now = new Date()
    await TestEventModel.findByIdAndUpdate(
      id,
      {
        $inc: { count: 1 },
        $setOnInsert: {
          product,
          kind,
          event,
          clientReported,
          createdAt: now,
          expireAt: testEventExpiryFrom(now),
        },
        ...(data ? { $set: Object.fromEntries(Object.entries(data).map(([k, v]) => [`data.${k}`, v])) } : {}),
        ...(max ? { $max: Object.fromEntries(Object.entries(max).map(([k, v]) => [`data.${k}`, v])) } : {}),
      },
      { upsert: true, lean: true }
    )
  } catch (error) {
    // Deliberately swallowed. See the fire-and-forget note above: a measurement failure
    // must never surface to a visitor or fail the page that triggered it.
    console.error(`[test-events] write failed for ${id}`, error)
  }
}

/** Server-side funnel counter, bucketed by day so a time series falls out of the key. */
export async function recordFunnel(product: string, event: string): Promise<void> {
  const now = new Date()
  await recordEvent({
    id: testEventId.funnel(product, event, dayBucket(now)),
    product,
    kind: 'funnel',
    event,
    clientReported: false,
  })
}

/**
 * Fire-and-forget for call sites that must not await, notably the `force-dynamic` result
 * page: a render should not wait on a counter. Errors are already swallowed inside
 * `recordEvent`; the extra `catch` guards against a rejection from `connectDatabase`
 * escaping before the inner try is entered.
 */
export function recordFunnelDetached(product: string, event: string): void {
  void recordFunnel(product, event).catch(() => {})
}
