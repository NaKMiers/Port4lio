import mongoose, { Schema, type Types } from 'mongoose'

import { MCP_SCOPES, type McpScope } from '@/lib/mcp/scopes'
import { compileModel } from '@/lib/mongoose-model'

/**
 * A revocable, scoped agent token for the site-wide MCP (Claude Code, Codex).
 *
 * Only the sha256 of the token is stored. The plaintext `p4_...` is shown once, in the
 * response that created it, and never again, so a database dump does not hand anyone agent
 * access. `prefix` is the first 8 characters, enough to tell two tokens apart in the list
 * without being a usable secret.
 *
 * `scopes` decides which tools the token's `tools/list` contains, and `runTool` checks it
 * again on every call - see `lib/mcp/scopes.ts` and `lib/mcp/token.ts`.
 *
 * Revoke sets `revokedAt` and keeps the record, so the list can still show it greyed out and
 * the AgentAction feed can still name it.
 */

export type AgentTokenDocument = {
  _id: Types.ObjectId
  name: string
  prefix: string
  hash: string
  scopes: McpScope[]
  lastUsedAt: Date | null
  revokedAt: Date | null
  createdAt: Date
}

const agentTokenSchema = new Schema<AgentTokenDocument>(
  {
    name: { type: String, required: true, maxlength: 80 },
    prefix: { type: String, required: true },
    hash: { type: String, required: true, unique: true },
    scopes: {
      type: [{ type: String, enum: MCP_SCOPES }],
      default: [],
    },
    lastUsedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
  },
  {
    collection: 'agent_tokens',
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false,
  }
)

export const AgentTokenModel: mongoose.Model<AgentTokenDocument> = compileModel(
  'AgentToken',
  agentTokenSchema
)
