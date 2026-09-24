import { KeyRound } from 'lucide-react'
import Link from 'next/link'

import { cn } from '@/lib/utils'

/**
 * The board's Agents button: a link to `/admin/agents`, where MCP tokens now live.
 *
 * ```
 *   [Agents] ──▶ /admin/agents     create scoped p4_ tokens, connect Claude Code / Codex,
 *                                  revoke (legacy wbt_ too), read the agent activity feed
 * ```
 *
 * It used to be a popover that created read-only `wbt_` whiteboard tokens. When the MCP moved
 * from the whiteboard to the whole site (docs/designs/mcp/mcp.md premise 7), token management
 * moved with it: one page for one token system, instead of a whiteboard panel that could only
 * mint the old kind. The file keeps its name so the board's import and the toolbar slot stay
 * put; nothing here creates a token any more (owner decision D4).
 */
export function AgentsButton({ className }: { className?: string }) {
  return (
    <Link
      href="/admin/agents"
      aria-label="Agents: MCP tokens and activity"
      className={cn(
        'inline-flex min-h-[40px] shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-pp-line bg-white/85 px-3 font-display text-[11px] font-semibold uppercase tracking-[0.13em] text-pp-text no-underline sm:px-3.5',
        className
      )}
    >
      <KeyRound
        aria-hidden
        size={14}
      />
      <span className="hidden xl:inline">Agents</span>
    </Link>
  )
}
