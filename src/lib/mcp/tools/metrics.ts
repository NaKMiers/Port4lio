import 'server-only'

import { z } from 'zod'

import { defineTool, ok, refuse } from '@/lib/mcp/run-tool'
import {
  getBriefing,
  MAX_BLOG_DAYS,
  MAX_FUNNEL_DAYS,
} from '@/lib/metrics/briefing'
import { findOrder } from '@/lib/metrics/orders'

/**
 * Metrics tools: aggregates only, and one order by code (premise 5). `get_test_metrics` was
 * cut from the registry (acceptance.md D1); `lib/metrics/tests.ts` still serves the admin board.
 *
 * ```
 *   get_briefing (read)  ──▶ metrics/briefing   period vs the one before; windows follow retention
 *   find_order   (pii)   ──▶ metrics/orders     one order, never an email or certificate name; audited
 * ```
 */

const PERIOD_DAYS = { week: 7, month: 30, quarter: 90 } as const

export const getBriefingTool = defineTool({
  name: 'get_briefing',
  title: 'Business briefing',
  description: `How a period went, compared with the equal period before it: blog views, shares and attributions with the top ${10} posts; new subscribers and unsubscribes; paid MBTI and IQ orders and revenue (VND); the test funnel and conversion (paid / paywall-seen). period is week (default), month or quarter, or pass days. A section whose data has already expired is left out with a reason: blog sections need ${MAX_BLOG_DAYS} days or fewer, the test funnel ${MAX_FUNNEL_DAYS} or fewer. Aggregates only - no customer data.`,
  scopes: ['read'],
  input: z.object({
    period: z.enum(['week', 'month', 'quarter']).default('week'),
    days: z.number().int().min(1).max(365).optional(),
  }),
  annotations: { readOnlyHint: true, openWorldHint: false },
  async run({ period, days }) {
    return ok(
      JSON.stringify(await getBriefing(days ?? PERIOD_DAYS[period]), null, 2)
    )
  },
})

export const findOrderTool = defineTool({
  name: 'find_order',
  title: 'Look up one order',
  description:
    'One MBTI or IQ order by its PayOS order code: product, amount, status, created and paid dates, and whether the result email went out. Never returns the buyer email or the certificate name, and there is no lookup by email. Every call is logged.',
  scopes: ['pii'],
  audited: true,
  input: z.object({
    orderCode: z.number().int().positive(),
  }),
  annotations: { readOnlyHint: true, openWorldHint: false },
  async run({ orderCode }, { setTarget }) {
    setTarget({ kind: 'order', id: String(orderCode) })
    const order = await findOrder(orderCode)
    if (!order) return refuse(`No order with code ${orderCode}.`, 'not-found')
    return ok(JSON.stringify(order, null, 2))
  },
})

export const METRICS_TOOLS = [getBriefingTool, findOrderTool]
