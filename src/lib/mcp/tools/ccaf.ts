import 'server-only'

import { z } from 'zod'

import { MAX_CONFIDENCE, MOCK_QUESTION_COUNT } from '@/lib/ccaf/progress'
import {
  applyCcafUpdate,
  ccafStatus,
  checkCcafUpdate,
} from '@/lib/ccaf/progress-service'
import { defineTool, ok, refuse } from '@/lib/mcp/run-tool'
import { CCAF_SAVE_LIMIT } from '@/lib/rate-limit'

/**
 * The CCA-F study tracker (`/admin/certificates/ccaf`), through `ccaf/progress-service` - the
 * same write path as the tracker page's `PUT /api/ccaf`.
 *
 * ```
 *   ccaf_status (read)   progress · readiness · latest mock's scaled score · days to the exam
 *                        · weakest domains · next task ids · checklist ids
 *   ccaf_update (write)  tick/untick tasks and checks · log a mock (correct of 60) · confidence
 *                        keyed (clientRef, R4): a retried "log my mock" logs it once
 * ```
 */

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a calendar day, YYYY-MM-DD')
  // The shape alone lets 2026-13-01 through, and `sanitizeState` would then swap in the
  // default exam date (or file a mock under it) while the call reports ok.
  .refine(
    value => !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime()),
    'must be a real calendar day'
  )

export const ccafStatusTool = defineTool({
  name: 'ccaf_status',
  title: 'CCA-F study status',
  description:
    "The owner's Claude Certified Architect - Foundations study tracker: task progress overall and by week, readiness (confidence weighted by each domain's share of the exam), the latest mock with its estimated scaled score against the 720 pass mark, days to the exam, the two weakest domains, the next undone task ids and the exam-day checklist ids. ccaf_update takes these ids.",
  scopes: ['read'],
  input: z.object({}),
  annotations: { readOnlyHint: true, openWorldHint: false },
  async run() {
    return ok(JSON.stringify(await ccafStatus(), null, 2))
  },
})

export const ccafUpdateTool = defineTool({
  name: 'ccaf_update',
  title: 'Update CCA-F progress',
  description: `Change the CCA-F tracker: tick or untick tasks and exam-day checks (ids from ccaf_status), log a mock exam, or set a domain's self-rated confidence (domain 1-5, level 0-${MAX_CONFIDENCE}). A mock is logged as correct answers out of ${MOCK_QUESTION_COUNT} - that is what the tracker stores. If the owner gives a scaled score (like 720) instead, ask how many answers were right; a scaled score does not convert back exactly. The date defaults to today in Vietnam. Pass a clientRef so a retry does not log the same mock twice.`,
  scopes: ['write'],
  keyed: true,
  cost: () => [CCAF_SAVE_LIMIT],
  // Spent after the id checks, so a typo'd task id costs the token nothing.
  lazyCost: true,
  input: z.object({
    tickTasks: z.array(z.string().max(40)).max(100).optional(),
    untickTasks: z.array(z.string().max(40)).max(100).optional(),
    tickChecks: z.array(z.string().max(20)).max(20).optional(),
    untickChecks: z.array(z.string().max(20)).max(20).optional(),
    logMock: z
      .object({
        correct: z.number().int().min(0).max(MOCK_QUESTION_COUNT),
        date: day.optional(),
        label: z.string().min(1).max(24).optional(),
        domainPercents: z
          .array(z.number().int().min(0).max(100).nullable())
          .length(5)
          .optional(),
      })
      .optional(),
    confidence: z
      .array(
        z.object({
          domain: z.number().int().min(1).max(5),
          level: z.number().int().min(0).max(MAX_CONFIDENCE),
        })
      )
      .max(5)
      .optional(),
    examDate: day.optional(),
  }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  async run(args, { setTarget, spend }) {
    setTarget({ kind: 'ccaf', id: 'ccaf-progress' })
    const { clientRef: _clientRef, ...update } = args as typeof args & {
      clientRef?: string
    }
    if (Object.values(update).every(value => value === undefined))
      return refuse(
        'Nothing to change: pass tickTasks, untickTasks, tickChecks, untickChecks, logMock, confidence or examDate.'
      )
    const invalid = checkCcafUpdate(update)
    if (invalid) return refuse(invalid)
    const refused = await spend()
    if (refused) return refused
    const result = await applyCcafUpdate(update)
    if (!result.ok) return refuse(result.error)
    return ok(
      JSON.stringify(
        {
          loggedMock: result.loggedMock,
          status: await ccafStatus(),
        },
        null,
        2
      )
    )
  },
})

export const CCAF_TOOLS = [ccafStatusTool, ccafUpdateTool]
