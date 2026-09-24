# MCP implementation - progress notes

Short notes after each phase (done / next / surprises), so the work survives a context compaction. Branch `feat/mcp`. Owner decisions D1-D5 are in `acceptance.md` "Owner decisions".

## Phase 0 - done (4881f9a)

- Done: `acceptance.md` (10 asks, tool coverage, cuts); R10 pins `tests/api/profile-route.test.ts` (18), `ccaf-route.test.ts` (16), `admin-metrics-route.test.ts` (9), green on unchanged code. These three files may never be modified again.
- Decisions taken after the phase: D1 cut `delete_post`, `save_taxonomy`, `get_test_metrics`, `whiteboard_update_item` (23 tools, 12 read); D2 `resultEmailedAt` on both payment models; D3 `ccaf_update` takes `correct` only; D4 the legacy `wbt_` create route stays until T11, UI creation goes; D5 `create_draft`/`update_post` accept `coverImagePrompt` + `imagePrompts`.
- Surprises: a `$`-prefixed key makes `POST /api/profile` refuse the whole save (pinned). Mongoose's `setDefaultsOnInsert` writes every schema default on the first profile upsert (pinned). `first-week-asks.md` is the owner's file and is left unstaged.
- Next: phase 1 (MCP core, tokens, `/admin/agents`).

## Phase 1 - done

- Done: `src/lib/mcp/{scopes,budget,transport,token,run-tool,server,audit}.ts`, `tools/{me,whiteboard}.ts`; models `AgentToken`, `AgentAction`; `src/lib/profile-sections.ts`; `POST /api/mcp`; the alias and `context.md` on the new guard; `/admin/agents` + `api/admin/agents/tokens` (+`[id]`); the whiteboard Agents button is a link. `WHITEBOARD_AGENT_LIMIT` is `MCP_AGENT_LIMIT`. C7 comment in `profile-data.ts` updated now, because `get_profile` already serves the resume.
- Tests: `mcp-core.test.ts` (33), `agents-tokens.test.ts` (8), `retention.test.ts` +2 cases, `whiteboard-agent.test.ts` green with import-only changes; `tests/e2e/agents.spec.ts` (4). Whiteboard e2e (6) and (13) rewritten: they drove the old popover's token UI, which the plan replaces with a link (coverage moved to agents.spec.ts).
- Surprises: `src/lib/whiteboard/mcp.ts` became empty after the move (tools to `tools/whiteboard.ts`, transport to `transport.ts`) and is deleted now rather than at T11. The shared whiteboard renderers hardcoded the alias tool names in their hints; they now take the names. SDK input validation is bypassed on purpose (passthrough schema) so `runTool` can audit `refused(invalid)`. Pre-existing failures NOT caused by this work, also red on the Phase 0 commit: `blog-cron-route.test.ts` (3, the BLOG_CRON_LIMIT 1-vs-10 mismatch, TODOS T2) and `blog-post-data.test.ts` (1, `createdAt` in the public listing projection).
- Next: phase 2 (blog services, illustration, blog tools), after the owner rules on the two pre-existing failures.
