import mongoose, { Schema, type Types } from 'mongoose'

import { MCP_SCOPES, type McpScope } from '@/lib/mcp/scopes'
import { compileModel } from '@/lib/mongoose-model'

/**
 * A revocable, scoped agent token for the site-wide MCP (Claude Code, Codex).
 *
 * Verification only ever uses the sha256 of the token (`hash`). The plaintext is also kept
 * SEALED (`sealed`, AES-256-GCM, lib/mcp/token-vault.ts) so the owner can copy a token again
 * from `/admin/agents` whenever they need it - a database dump alone still hands nobody agent
 * access, because the key is derived from AUTH_SECRET and never stored. `select: false`, so
 * no query carries it unless it asks by name, and the one that does (`revealAgentToken`) is
 * owner-only. Tokens created before sealing have no `sealed` and cannot be copied again.
 * `prefix` is the first 8 characters, enough to tell two tokens apart in the list without
 * being a usable secret.
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
  /** The sealed plaintext, or absent on a token created before sealing. */
  sealed?: string
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
    sealed: { type: String, select: false },
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
