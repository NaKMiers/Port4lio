/**
 * Agent token scopes, and the shapes `/admin/agents` renders. No server imports, so the
 * owner page can use them too.
 *
 * ```
 *   read     every read tool, lint_draft, get_writing_brief, context.md      on by default
 *   write    drafts, images for unpublished posts, whiteboard + CCA-F writes  on by default
 *   publish  anything the public sees: publish, archive, a live post,         off by default
 *            profile edits (never the resume)
 *   pii      find_order, and nothing else                                     off by default
 *
 *   whiteboard:legacy   held only by a migrated wbt_ token, never grantable, gone with the
 *                       /api/whiteboard/mcp alias (premise 7)
 * ```
 *
 * A tool lists the scopes that let a token call it, and ANY one of them is enough (C5). That
 * is what lets the whiteboard alias accept both a legacy token and a `p4_` token with `read`.
 */

export const MCP_SCOPES = ['read', 'write', 'publish', 'pii'] as const
export type McpScope = (typeof MCP_SCOPES)[number]

export const LEGACY_SCOPE = 'whiteboard:legacy'
/** Anything a verified token can hold. `LEGACY_SCOPE` only ever comes from a `wbt_` token. */
export type TokenScope = McpScope | typeof LEGACY_SCOPE

export const DEFAULT_SCOPES: readonly McpScope[] = ['read', 'write']

export const SCOPE_INFO: Record<McpScope, { label: string; grants: string }> = {
  read: {
    label: 'Read',
    grants:
      'Profile, CV, posts, metrics, the visible whiteboard and CCA-F progress. Linting and the writing brief.',
  },
  write: {
    label: 'Write',
    grants:
      'Drafts, images for unpublished posts, whiteboard cards and links, CCA-F progress.',
  },
  publish: {
    label: 'Publish',
    grants:
      'Anything the public sees: publish and archive posts, edit a live post, edit profile sections (never the CV).',
  },
  pii: {
    label: 'Order lookup',
    grants:
      'find_order: one order by its code. Never an email or a certificate name.',
  },
}

export function isMcpScope(value: unknown): value is McpScope {
  return MCP_SCOPES.includes(value as McpScope)
}

/** The shell variable the connect instructions use. The token itself never goes in a config. */
export const MCP_TOKEN_ENV = 'PORT4LIO_MCP_TOKEN'

/** A `p4_` token as the owner page sees it. Never carries the hash. */
export interface ClientAgentToken {
  id: string
  name: string
  prefix: string
  scopes: McpScope[]
  createdAt: string
  lastUsedAt: string | null
  revokedAt: string | null
}

export type AgentActionOutcome = 'ok' | 'refused' | 'error' | 'pending'

/** One audited tool call, as the owner page's feed shows it. */
export interface ClientAgentAction {
  id: string
  tokenName: string
  tool: string
  outcome: AgentActionOutcome
  reason: string | null
  target: { kind: string; id: string; slug?: string } | null
  argsPreview: string
  at: string
}
