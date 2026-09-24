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

## Phase 2 - done

- Done: `src/lib/blog/post-service.ts` (board list, bare create, editor load, PATCH with optional `baseUpdatedAt`, soft and permanent delete - all moved verbatim - plus `createDraft`, `listPosts`, `readPostPage`, `updatePostAsAgent`, `publishPost`); `image-service.ts` (`generateImageUrl`, `writeImagePrompt`, `patchImageIntoPost`); `illustrate-run.ts` rewritten around `claimIllustration` / `runIllustration` (lease, patch saves, `publish: false`, `spendImage`, lastError), cron via `illustratePost`; `Post.illustration` subdoc; admin blog routes thin; `BlogEditor` stale-save banner (`StaleSaveBanner.tsx`); tools `get_me`, `list_posts`, `get_post`, `list_taxonomy`, `get_writing_brief`, `lint_draft`, `create_draft`, `update_post`, `generate_image`, `illustrate_post`, `publish_post`; prompt `write-post` (`writing-brief.ts`, `lint-draft.ts`).
- Tests: `blog-post-service.test.ts` (24), `blog-illustrate.test.ts` (14), `mcp-blog-tools.test.ts` (19); every existing blog suite unmodified and green except the 4 pre-existing failures (D6); `tests/e2e/mcp-scene1.spec.ts` 5 pass / 2 skipped (no GOOGLE_API_KEY locally); existing blog e2e 9/9 alone.
- Surprises: `GOOGLE_API_KEY` is empty in the local `.env`, so real images cannot be drawn; scene 1 e2e asserts the failure reaches `illustration.lastError` instead and skips the two image-only freshness steps. `blog-publish.spec.ts` "delete is soft" failed once when run in parallel with other blog specs (ISR timing), passes 2/2 alone. `resume-hide-photo` timed out once under full-suite load, passes alone. `update_post` saves conditionally on the `updatedAt` it read, so an image patched in during its render is a conflict, not an overwrite.
- Next: phase 3 (metrics services, indexes, get_briefing / find_order, weekly-briefing prompt; D2 resultEmailedAt).

## Phase 3 - done

- Done: `src/lib/metrics/tests.ts` (moved from `api/admin/metrics`, route thin), `briefing.ts` (windows follow retention: blog <= 90 days, funnel <= 10 days, else omitted with a reason), `orders.ts` (by code only, allowlist projection); R11 indexes on `PostEvent`, `Payment`, `IqPayment`; D2 `resultEmailedAt` on both payment models, stamped after a successful `deliver` in both fulfilment paths (diagrams updated); tools `get_briefing` (read), `find_order` (pii, audited); prompt `weekly-briefing`.
- Tests: `mcp-metrics.test.ts` (13, incl. the personal-data grep and the D2 stamp against a real mongod), `retention.test.ts` +2 index cases, `admin-metrics-route.test.ts` unmodified and green, `payos-fulfil` / `iq-fulfil` unit tests unmodified and green. Full suite: only the 4 D6 failures.
- Surprises: `find_order` distinguishes "not sent" (null) from "not recorded" (field absent on orders paid before D2), because Mongoose writes the `null` default only on new documents. `attemptToken` is excluded from `find_order` too - it is the capability that opens a result page.
- Next: phase 4 (profile/ccaf/taxonomy services, update_profile, archive_post, ccaf tools, whiteboard writes, tailor-cv).

## Phase 4 - done

- Done: `src/lib/blog/taxonomy-service.ts` (kinds/series routes thin; `revalidatePath('/blog')` on relabel and delete), `src/lib/profile-service.ts` (`replaceProfile` for `POST /api/profile`, `patchProfileSection` for the agent: resume refused (R8), exact section keys, version hash, conditional on `updatedAt`), `src/lib/ccaf/progress-service.ts` (`saveCcafState` for `PUT /api/ccaf`, `applyCcafUpdate`, `ccafStatus`), `archivePost` in post-service (C11), `createAgentItem` / `createAgentLink` in `whiteboard/data.ts` (visible boards and frames only, tag `agent`); tools `update_profile`, `archive_post`, `ccaf_status`, `ccaf_update` (D3: `correct` only), `whiteboard_add_item`, `whiteboard_link`; prompt `tailor-cv`. Registry: 23 tools (12 read), 3 prompts.
- Tests: `mcp-whiteboard-tools.test.ts` (10), `mcp-operator-tools.test.ts` (13), `whiteboard-export-parity.test.ts` +agent case (51), `mcp-core.test.ts` (34, pins the 23 tools); R10 `profile-route` (18) and `ccaf-route` (16) unmodified and green. e2e `taxonomy-revalidate.spec.ts` (1) + `agents.spec.ts` + `mcp-scene1.spec.ts`: 10 passed, 2 skipped (no `GOOGLE_API_KEY`). Full suite: only the 4 D6 failures.
- Surprises: `sanitizeState` keeps the first `MAX_MOCKS` mocks, so a mock logged past the cap would have vanished on save while reporting success - `ccaf_update` refuses it instead. The taxonomy e2e goes through the admin route, since `save_taxonomy` was cut (D1); the revalidation under test lives in the shared service either way.
- Next: phase 5 (header diagrams, `payos-fulfil.ts:17` diagram fix, AGENTS.md cross-cutting pieces; no T11), then final verification and the report.

## Phase 5 - done

- Done: `payos-fulfil.ts` header diagram corrected (the claim clears `Payment.expireAt`; `Attempt.expireAt` is left alone, as the code and the privacy page say - D30). AGENTS.md: `src/lib/mcp/` in Layering, plus "Site MCP" and "One service per write" (revalidation inside the service) under Cross-cutting pieces. The other T10 headers (`mcp/token.ts`, `server.ts`, `run-tool.ts`, `illustrate-run.ts`, `AgentsPopover.tsx`, `whiteboard/token.ts`, `profile-data.ts` C7, `post-service.ts`, `briefing.ts`) were rewritten in the phase that changed them and re-read here. T11 not done, by instruction.
- Next: final verification and the report.
