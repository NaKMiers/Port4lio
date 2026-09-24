import mongoose, { Schema, type Types } from 'mongoose'

import type { AgentActionOutcome } from '@/lib/mcp/scopes'
import { compileModel } from '@/lib/mongoose-model'

/**
 * The agent audit log, and the retry ledger behind `clientRef` (mcp-plan.md R4).
 *
 * ```
 *   one row per audited tool call (every write tool, plus find_order), whatever the outcome
 *
 *   unkeyed call ──▶ after(): insert { outcome: ok | refused | error }
 *
 *   keyed call   ──▶ insert { clientRef, argsHash, outcome: 'pending' }      BEFORE the work
 *                      │   unique partial index (tokenId, clientRef) decides who runs
 *                      ▼
 *                    finally: $set outcome, reason, resultPreview (awaited)
 * ```
 *
 * `resultPreview` is only kept on a keyed row, because it is what a replay returns. It is the
 * full tool answer, which is already bounded by the response budget, so "preview" means
 * "bounded", not "shortened".
 *
 * `argsPreview` is at most 2 KB, with long strings (markdown bodies) replaced by their length
 * and anything shaped like an email address masked - see `previewArgs` in `run-tool.ts`. No
 * tool takes a customer email, and this makes sure an agent that pastes one does not put it
 * in the log either.
 *
 * ## Retention
 *
 * 180 days through a TTL index on `expireAt`, the same window as blog events. The 24-hour
 * replay window is a rule in `run-tool.ts` over `at`, not a second expiry.
 */

/** How long an audit row is kept. The same window as `PostEvent`. */
export const AGENT_ACTION_TTL_DAYS = 180

export function agentActionExpiryFrom(now: Date): Date {
  return new Date(now.getTime() + AGENT_ACTION_TTL_DAYS * 24 * 60 * 60 * 1000)
}

export type AgentActionTarget = { kind: string; id: string; slug?: string }

export type AgentActionDocument = {
  _id: Types.ObjectId
  tokenId: Types.ObjectId
  tokenName: string
  tool: string
  clientRef?: string
  argsHash?: string
  target: AgentActionTarget | null
  outcome: AgentActionOutcome
  reason: string | null
  resultPreview?: string
  argsPreview: string
  at: Date
  expireAt: Date
}

const agentActionSchema = new Schema<AgentActionDocument>(
  {
    tokenId: { type: Schema.Types.ObjectId, required: true },
    tokenName: { type: String, required: true },
    tool: { type: String, required: true },
    clientRef: { type: String },
    argsHash: { type: String },
    target: {
      type: new Schema(
        {
          kind: { type: String, required: true },
          id: { type: String, required: true },
          slug: { type: String },
        },
        { _id: false }
      ),
      default: null,
    },
    outcome: {
      type: String,
      required: true,
      enum: ['ok', 'refused', 'error', 'pending'],
    },
    reason: { type: String, default: null },
    resultPreview: { type: String },
    argsPreview: { type: String, default: '', maxlength: 2048 },
    at: { type: Date, required: true },
    expireAt: { type: Date, required: true },
  },
  { collection: 'agent_actions', versionKey: false }
)

/**
 * The claim. Partial, because most rows carry no `clientRef` and must not collide on a
 * missing one - a plain unique index would treat every unkeyed row as the same `null`.
 */
agentActionSchema.index(
  { tokenId: 1, clientRef: 1 },
  { unique: true, partialFilterExpression: { clientRef: { $type: 'string' } } }
)

/** The owner feed: newest first. */
agentActionSchema.index({ at: -1 })

agentActionSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 })

agentActionSchema.on('index', (error: unknown) => {
  if (error)
    console.error(
      '[AgentAction] index build FAILED - clientRef claims or retention may not be enforced',
      error
    )
})

export const AgentActionModel: mongoose.Model<AgentActionDocument> =
  compileModel('AgentAction', agentActionSchema)
