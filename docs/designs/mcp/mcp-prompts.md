# Site-wide MCP - session prompts

Two prompts: one that implements the plan in a single session, and one for `/review`.

- The design is [mcp.md](mcp.md).
- The engineering plan, which wins where the two differ, is [mcp-plan.md](mcp-plan.md).
- The QA test plan is [mcp-test-plan.md](mcp-test-plan.md).

Before running the implementation prompt, do the Assignment (design > "The Assignment"): write `docs/designs/mcp/first-week-asks.md`, the first 10 things you would ask the agent to do. The implementation session stops and asks if that file is missing.

---

## Implementation prompt (whole plan, one session)

```
Implement the site-wide MCP server in this repo, following docs/designs/mcp/mcp-plan.md and docs/designs/mcp/mcp.md end to end.

## Read first, fully, before writing code

- AGENTS.md and every file in .agents/rules/.
- docs/designs/mcp/mcp-plan.md, all of it. It is binding, including:
  - the corrections C1-C11
  - the Decision ledger (R1-R11, T1-T3): only the "Accepted scope" of each record is approved; the options not chosen are not
  - "What already exists", "Failure modes", "Worktree parallelization strategy"
  - "Implementation Tasks" (T1-T11)
  Where mcp-plan.md and mcp.md disagree, mcp-plan.md wins.
- docs/designs/mcp/mcp.md: the premises, tool table, scopes, data model, success criteria and "NOT in scope". Skip the generated "Reviewer Concerns" section; mcp.md "Eng review amendments" maps each concern to its resolution.
- docs/designs/mcp/mcp-test-plan.md.
- docs/designs/mcp/first-week-asks.md. If it does not exist, stop and ask me to write it.
- This is Next.js 16. Before writing handlers, read the route-handler, after() and revalidation guides in node_modules/next/dist/docs/.
- The code the plan reuses (mcp-plan.md "What already exists"):
  - src/lib/whiteboard/{token,mcp,context,data}.ts
  - node_modules/mcp-handler/dist/index.mjs (a server is built per request)
  - src/lib/blog/{generate,illustrate-run,image-gen,image-asset,image-prompt,image-placeholders,auto-illustrate,prose-audit,brief,markdown,revalidate,post-events}.ts
  - src/lib/rate-limit.ts, src/lib/profile-data.ts, src/lib/ccaf/progress*.ts
  - the admin routes under src/app/api/admin/**
  - tests/api/whiteboard-agent.test.ts (its after() queue pattern)

## Setup

- The working tree may hold my unrelated, uncommitted whiteboard edits. Never stage, revert or reformat files you did not change for this work. Stage paths explicitly, never `git add -A`.
- If on main: `git switch -c feat/mcp`. If the branch exists, switch to it.
- No new dependencies: mcp-handler 2.2, @modelcontextprotocol/server and zod 4 are already installed.

## Work in phases. Each phase must be green before the next one starts.

"Green" means the phase's tests pass, plus `bun run typecheck` and `bun run lint`. Commit on feat/mcp at the end of each phase with a conventional message (`feat(mcp): ...`, `test(mcp): ...`, `refactor(blog): ...`).

Phase 0 - acceptance + regression pins (plan T1, R10)
- Turn first-week-asks.md into docs/designs/mcp/acceptance.md: each ask, the scene it belongs to, the tools it needs, and the observable result.
- List registry tools that no ask needs and PROPOSE cuts. Do not cut anything until I answer.
- Write tests/api/profile-route.test.ts, tests/api/ccaf-route.test.ts and tests/api/admin-metrics-route.test.ts against the CURRENT routes, with the assertions in R10 (auth 401 and the REQUIRE_ADMIN rule, validation, the exact stored document, revalidateTag(PUBLIC_PROFILE_CACHE_TAG, 'max'), 429, metrics JSON field by field). They must pass on unchanged code. From here on they may never be modified.

Phase 1 - MCP core, tokens, /admin/agents (T2, T3; C1, C5, R1, R4, R5)
- Move guardAgent / verifyBearer / touchLastUsed and sseToJson / withAcceptBoth into src/lib/mcp/. Move, don't copy; the whiteboard imports them from there.
- AgentToken (compileModel, p4_ + 32 bytes base64url, shown once, sha256 stored) and AgentAction (compileModel, 180-day TTL, a pending outcome, a unique partial index on tokenId + clientRef).
- src/lib/mcp/server.ts:
  - per-request registration through a closure over the verified token (C1)
  - definitions and JSON schemas built once at module load
  - prompts registered per scope (C6)
- src/lib/mcp/run-tool.ts:
  - scope recheck, zod teaching errors
  - claim-first clientRef (R4)
  - per-token cost buckets `mcp-token:<id>` (R5)
  - the budget safety net with its truncation marker (C10)
  - exactly one AgentAction row per audited call, in finally
- POST /api/mcp: p4_ only; GET and DELETE return 405. Out-of-scope registry names get an isError plus a refused row (R1). Rename WHITEBOARD_AGENT_LIMIT to MCP_AGENT_LIMIT.
- Alias and context.md: /api/whiteboard/mcp keeps the old 3 tool names, and context.md stays. Both accept wbt_ (scope whiteboard:legacy) or p4_ with read (C5). /api/mcp gives wbt_ a 401.
- Tools this phase: whiteboard_overview, whiteboard_search, whiteboard_get_item, get_profile (section keys per C3, section version hash). get_me waits for phase 2 (C4).
- /admin/agents page plus api/admin/agents/tokens (requireOwner):
  - create with scope checkboxes (publish and pii off by default)
  - list, revoke, and the legacy wbt_ tokens (revoke only)
  - the AgentAction feed
  - connect instructions for Claude Code and Codex with PORT4LIO_MCP_TOKEN and the single-quoted header
  The whiteboard Agents popover becomes a link to it.
- tests/api/mcp-core.test.ts and agents-tokens.test.ts. tests/api/whiteboard-agent.test.ts must still pass; only its import paths may change. tests/e2e/agents.spec.ts.

Phase 2 - blog services, illustration, blog tools (T4, T5, T6; C8, C9, C11, R2, R3, R6, R7, R9)
- Extract src/lib/blog/post-service.ts and image-service.ts from the admin blog routes, and make the routes thin.
  - Revalidation lives INSIDE the services (C8).
  - The existing blog-patch, blog-image-prompt, blog-permanent-delete, blog-post-data, blog-kinds and blog-series tests must pass UNMODIFIED.
- Admin PATCH: an optional baseUpdatedAt gives a 409 when stale. BlogEditor gets the Reload / Overwrite anyway banner (R9). A PATCH without the field is unchanged.
- illustrate-run.ts, with its header diagram updated:
  - `publish: false`
  - a per-post lease on Post.illustration (R3)
  - patch-in-place image saves that skip removed placeholders
  - per-token image budget (R5)
  - a background run via after(), with every failure in lastError (R2)
  - the cron uses the same path
- Tools: get_me, list_posts, get_post (paged body, version, illustration status), list_taxonomy, get_writing_brief, lint_draft, create_draft (atomic, slug per C9, clientRef), update_post (find/replace edits per R6, the live-post rules per R7, no status), generate_image, illustrate_post (start and return), publish_post.
- The write-post prompt, built from brief.ts.
- tests/api/blog-post-service.test.ts, blog-illustrate.test.ts, mcp-blog-tools.test.ts. tests/e2e/mcp-scene1.spec.ts under next start: create, illustrate, poll, publish, /blog/<slug> fresh, and the editor banner after an MCP update_post.

Phase 3 - metrics (T7; R11, premise 5)
- src/lib/metrics/briefing.ts, tests.ts (moved from api/admin/metrics; its route becomes thin), orders.ts.
  - Briefing windows follow retention: blog up to 90 days, test funnel up to 10 days, otherwise omitted with a reason.
  - find_order looks up by order code only and never returns an email or certificate name.
- Indexes: PostEvent { kind: 1, createdAt: -1 }; Payment and IqPayment { status: 1, paidAt: -1 }. retention.test.ts asserts they build.
- Tools get_briefing, get_test_metrics, find_order, and the weekly-briefing prompt.
- tests/api/mcp-metrics.test.ts, including a test that no tool output contains any seeded customer email or certificate name.

Phase 4 - profile, ccaf, taxonomy, whiteboard writes (T8, T9; R8)
- src/lib/profile-service.ts: replaceProfile (the admin route, unchanged) and patchProfileSection with a version; it refuses `resume` (R8).
- src/lib/ccaf/progress-service.ts, and src/lib/blog/taxonomy-service.ts with revalidatePath('/blog') inside.
- Tools: update_profile, archive_post (unarchive per C11), delete_post (soft, destructiveHint), save_taxonomy, ccaf_status, ccaf_update, whiteboard_add_item / whiteboard_update_item (updatedAt precondition) / whiteboard_link. Whiteboard writes are visible-only, new items get includeInAi true and the `agent` tag, and they accept clientRef.
- The tailor-cv prompt, markdown only.
- Tests: the phase 0 tests stay unmodified; mcp-whiteboard-tools.test.ts; an agent-created case in whiteboard-export-parity.test.ts; the e2e check that save_taxonomy refreshes /blog.

Phase 5 - comment pass + docs (T10; T3/D30)
- Update the header diagrams in src/lib/mcp/*, illustrate-run.ts, AgentsPopover.tsx, and the loadPublicResume comment in profile-data.ts (C7).
- Fix src/lib/payos-fulfil.ts:17, so the Payment is the row whose expireAt is cleared.
- AGENTS.md "Cross-cutting pieces": the MCP front door, the one-service rule, revalidation inside services.
- Do NOT do plan T11 (removing the alias and WhiteboardToken). It waits one release.

Final verification
- `bun run format:check`, `bun run lint`, `bun run typecheck`, `bun run test`, `bun run test:e2e:local` (a disposable DB only, never a real one).
- Connect a local Claude Code session to `bun run dev` with a fresh token and walk acceptance.md. Record what passed.

## Rules for the whole session

- Modules with subtle invariants open with a why-comment and an ASCII diagram: token.ts, server.ts, run-tool.ts, post-service.ts, illustrate-run.ts, briefing.ts (AGENTS.md "Comments explain why").
- House rules: compileModel, jsonError, readJsonBody, getRequiredEnv, checkRateLimit, SelectField, cn(), className on reusable components, hyphens not em dashes, lucide icons not arrow glyphs.
- Nothing from "NOT in scope" in mcp-plan.md: no generate_post, no find_order by email, no OAuth, no inbox, no live refresh, no agent resume writes.
- Never modify an existing test to make it pass during an extraction. A failing regression test means the extraction changed behavior. Fix the code, or stop and ask.
- If the plan is ambiguous or contradicts the code, stop and ask. Don't invent behavior. If a phase can't go green after 3 honest attempts, stop and report.
- Keep a short progress note after each phase (done / next / surprises) so the work survives a context compaction.

## Final report

1. Per phase: files added or changed, test counts, and the commit hash.
2. Each mcp.md "Success Criteria" item and each acceptance.md prompt: met or not met, with evidence.
3. Every C/R decision you could not implement exactly, and why.
4. Open questions.
```

---

## Review prompt (/review)

Run once the implementation is done (or after any phase), before `/ship`.

```
/review

Context for this review: branch feat/mcp implements docs/designs/mcp/mcp-plan.md, the binding engineering plan (corrections C1-C11, Decision ledger R1-R11 and T1-T3; only each record's "Accepted scope" is approved). It also implements docs/designs/mcp/mcp.md (premises, tool table, scopes, success criteria). mcp-plan.md wins where they differ.

Beyond your normal checklist, check these, because they are where this feature can fail quietly:
- Scopes (premise 3, C1, R1):
  - tools/list and prompts are filtered per token
  - runTool rechecks the scope on every call
  - an out-of-scope registry name gets an isError plus exactly one refused AgentAction row; an unknown name gets the SDK error and no row
- Tokens (premise 7, C5):
  - /api/mcp accepts only p4_; wbt_ works only on /api/whiteboard/mcp and /api/whiteboard/context.md, with scope whiteboard:legacy
  - the rate limit runs before verification, and a DB error gives 503 (fail closed)
  - REQUIRE_ADMIN can't open any agent route
  - only sha256 hashes are stored, and the plaintext is returned once
- Personal data (premise 5):
  - no tool returns a customer email or certificate name
  - find_order looks up by order code only
  - argsPreview never holds an email
  - the owner's resume contact details appear only in get_me and get_profile (C7 comment updated)
- One implementation (premise 2):
  - admin routes and tools call the same services
  - revalidation happens inside the services (C8), including a live illustrate, taxonomy changes to /blog, and profile writes via revalidateTag(PUBLIC_PROFILE_CACHE_TAG, 'max')
  - `git diff main -- tests/` shows NO changes to the pre-existing blog tests or to the phase 0 route tests (R10), apart from import paths
- The live-post rule:
  - update_post, generate_image (attach) and illustrate_post need publish when the post is live
  - update_post has no status input
  - live posts refuse unresolved placeholders (R7)
- Illustration (R2, R3, R5):
  - publish:false never publishes
  - the lease refuses a second start and allows takeover after expiry
  - each image save patches only its placeholder into the current body
  - background failures land in lastError
  - per-token image budget; the cron uses the same path
- Retries (R4): the clientRef claim row is inserted BEFORE the service call under the unique index, and finalized in finally. Only ok rows replay. After refused or error, a retry runs again. An args-hash mismatch gives an isError. The tool list is create_draft, generate_image, whiteboard_add_item, whiteboard_link, ccaf_update.
- Edits (R6, R8, R9):
  - find/replace matches exactly once or the whole call fails
  - whole-body replace only for one-page posts
  - profile section version hashes
  - resume writes refused
  - admin PATCH baseUpdatedAt gives a 409, and a PATCH without it is byte-for-byte unchanged
- Whiteboard writes: only on visible items and boards; loadAgentVisible stays the only agent read path; new items get includeInAi true and the agent tag; updatedAt precondition.
- Performance (R11, C10): the new indexes exist and retention.test.ts asserts them; tool definitions are built once at module load; list tools page instead of clipping.
- Scope creep: nothing from mcp-plan.md "NOT in scope", and T11 (alias removal) is not done yet.
- House rules: compileModel, jsonError, readJsonBody, getRequiredEnv, cn(), hyphens not em dashes, lucide icons, why-comments with ASCII diagrams on token.ts, server.ts, run-tool.ts, post-service.ts, illustrate-run.ts, briefing.ts, and the payos-fulfil.ts:17 header fixed.
- Tests exist for each item above (mcp-plan.md Section 3 coverage diagram and mcp-test-plan.md).

Report which decisions (C/R/T ids) the diff implements, which it misses, and anything it does that the plan doesn't allow.
```
