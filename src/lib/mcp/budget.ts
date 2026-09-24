/**
 * The response budget every MCP tool answer stays inside (whiteboard D18, generalised).
 *
 * ```
 *   list tools          page by cursor          list_posts, whiteboard_search (limit <= 25)
 *   get_post            pages the body          offset / nextOffset / complete
 *   single objects      capped by construction  get_me: titles only, 5 posts; briefing: top 10
 *        │
 *        ▼
 *   clipToBudget  ── last-resort net: over budget ──▶ cut + "[truncated: N chars dropped]" + warn
 * ```
 *
 * No tool is supposed to reach the net (C10). It exists so that a tool which does - a profile
 * section grown past anything seeded - degrades into an answer that SAYS it was cut, rather
 * than a silently shorter one the agent would take as whole. The warning is the signal that a
 * tool needs paging; `tests/api/mcp-core.test.ts` asserts no tool reaches it with seeded
 * maximum-size data.
 */

/** ~8k tokens at chars/4. Claude Code caps a tool answer at 25k tokens; this stays well under. */
export const MCP_BUDGET_CHARS = 32_000

export function truncationMarker(dropped: number): string {
  return `\n[truncated: ${dropped} chars dropped]`
}

export function clipToBudget(
  text: string,
  tool: string,
  budget = MCP_BUDGET_CHARS
): string {
  if (text.length <= budget) return text

  // The marker's own length depends on the count it prints, so size it for the worst case.
  const reserve = truncationMarker(text.length).length
  const kept = text.slice(0, budget - reserve)
  console.warn(
    `[mcp] ${tool} answer hit the budget net (${text.length} chars) - it needs paging`
  )
  return kept + truncationMarker(text.length - kept.length)
}
