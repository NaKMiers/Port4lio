# Whiteboard - session prompts

Two prompts: one that implements the whole plan in a single session, and one for `/review`. The plan is [whiteboard.md](whiteboard.md). The QA test plan is [whiteboard-plan.md](whiteboard-plan.md).

Before running the implementation prompt: do the Assignment (plan > "The Assignment"). If 3 or more of your 15 items felt too private, change `true` to `false` on the `includeInAi default` line below.

---

## Implementation prompt (whole plan, one session)

```
Implement the whole /admin/whiteboard feature in this repo, following docs/designs/whiteboard.md end to end.

## Read first, fully, before writing code

- AGENTS.md and every file in .agents/rules/.
- docs/designs/whiteboard.md, all of it. It is binding, including the Decision ledger (D15-D30), "Section 4: Performance" (D27-D29), "Common work added by this session", and the "Design Review" section (DR1-DR12). Where the doc body and a later decision disagree, the later decision wins.
- docs/designs/whiteboard-plan.md (QA test plan).
- The approved wireframes (read the PNGs):
  ~/.gstack/projects/NaKMiers-Port4lio/designs/whiteboard-20260923/wireframe-board.png
  ~/.gstack/projects/NaKMiers-Port4lio/designs/whiteboard-20260923/wireframe-empty.png
  ~/.gstack/projects/NaKMiers-Port4lio/designs/whiteboard-20260923/wireframe-multi.png
- This is Next.js 16: read the route-handler, streaming and after() guides in node_modules/next/dist/docs/ before writing handlers.
- Existing code to reuse (plan "What already exists"): src/lib/require-owner.ts, api-response.ts, read-json-body.ts, rate-limit.ts, mongoose-model.ts, SelectField, ToggleSwitch, ConfirmDialog, Spinner, settings-utils.ts classes, OwnerAuthGate, AdminHomeLink, the vocab framed page, the admin hub BOARDS, and tests/e2e/global-setup.ts.

includeInAi default: true

## Setup

- If on main: `git switch -c feat/whiteboard` (keeps the uncommitted docs). If the branch exists, switch to it.
- `bun add @xyflow/react perfect-freehand mcp-handler` (mcp-handler v2).

## Work in phases. Each phase must be green before the next one starts.

"Green" = the phase's tests pass, plus `bun run typecheck` and `bun run lint`. Commit on feat/whiteboard at the end of each phase with a conventional message (`feat(whiteboard): ...`).

Phase 1 - serializer + limits (plan T1, "Next Steps" step 1)
- src/lib/whiteboard/limits.ts: pure (no server-only). Caps, the single-line rule, WHITEBOARD_TIMEZONE, and the shared validators.
- src/lib/whiteboard/context.ts: the one pure serializer. Grouping, links in/out, out-of-scope and truncated targets (R3-10), ink labels from ink.bbox (D27), escaping, 1 MB priority truncation, the date rule + meta line (D22, R3-11), and the MCP budget helpers (D18).
- tests/unit: every step-1 case, the D22 boundaries, D18 clipping. Use a FICTIONAL 15-item fixture, never real data.

Phase 2 - models + data layer (T2, step 2)
- WhiteboardItem / WhiteboardLink / WhiteboardToken via compileModel, with every index (text index default_language 'none'). ink.bbox is derived by the server.
- src/lib/whiteboard/data.ts: loadAgentVisible (privacy rules 1-10), validation, idempotent upserts for items and links (R3-4), only-changed-fields PATCH (R3-1), bulk PATCH all-or-nothing + rule 8 (R3-2), delete order with dangling tolerance, un-hide keepChildrenPrivate (D24), stream order frames -> items -> links (D28). Agent reads skip ink.points, and counts use countDocuments (D27).
- tests/api: every step-2 case, plus D27 "no agent read returns points" and the D28 order.

Phase 3 - admin UI routes + hub card (T3, step 3)
- Every route in "Routes > UI". Each starts with requireOwner. Use jsonError, and readJsonBody maxBytes of 256 KB for items, 2 MB for restore, default elsewhere.
- Streamed NDJSON load + backup (D21, D28). PATCH links/[id] (D19). Context returns { markdown, excludedCount, scopeHidden } (D25). Batched idempotent restore with dry run (D20, D21). Cache-Control no-store, private everywhere.
- Add the Whiteboard card to BOARDS in src/app/(admin)/admin/page.tsx, and update its doc-comment diagram.
- tests/api for every route + the no-store table test. tests/e2e/whiteboard-owner-gate.spec.ts mirroring blog-owner-gate.spec.ts.

Phase 4 - tokens + agent routes + MCP (T6, T7, steps 7-8)
- src/lib/whiteboard/token.ts: wbt_ + 32 bytes shown once, sha256, fail-closed verify (DB error -> 503), revoke, a throttled lastUsedAt touch via after() (D29). Token routes never return the hash.
- WHITEBOARD_AGENT_LIMIT (120 / 10 min) checked BEFORE verification. Bearer header only. REQUIRE_ADMIN never opens these routes.
- GET /api/whiteboard/context.md and POST /api/whiteboard/mcp on mcp-handler (D17) with exactly get_overview, search_context and get_item. Every read goes through loadAgentVisible, within the D18 budget. Empty search returns the isError text (D23). A malformed id is treated as unknown (R3-14). GET/DELETE -> 405, notifications -> 202, unknown request -> -32601. Confirm mcp-handler's defaults and wrap them where they differ.
- tests/api: every step-8 case, plus 429 before verify, a query-string token ignored, 503 on a DB error, one touch per 5 min, Vietnamese search.

Phase 5 - canvas shell, nodes, save queue (T4, DT1-DT4, DT6)
- page.tsx in OwnerAuthGate with noindex metadata. The framed layout (DR2). AdminHomeLink hides on /admin/whiteboard (update its comment). Top bar, rail, zoom and dot grid as in wireframe-board.png.
- Nodes: text, todo, frame (join/leave with a coordinate helper), labelled edges with inline label edit. meaning-style.ts (DR7). Hidden + error styling.
- useSaveQueue: client ObjectIds, per-item ordering, parent/link waits (R3-3), debounce, 5xx retry / 4xx permanent, bulk re-queue (R3-15), delete in the queue (R3-6), drag saves on stop. The NDJSON loader batches state, and a partial board is never editable (D28, DR4).
- Delete rules (R3-7, R3-19). ConfirmDialog gets a secondary action and moves to src/components/admin/, with the blog imports updated (DR6). Shortcut guard + a11y (DR9). Responsive tiers (DR8). DR4 states for board, pill and cards.
- tests/unit: save queue (every rule), shortcut guard, coordinate helper, MEANING_STYLE coverage.

Phase 6 - inspector, shapes/ink, export, backup, agents UI (T4 rest, T5, DT5, DT7, DT8)
- Inspector: Body textarea + counter and inline edit (DR10). Nothing selected shows shortcuts. Multi-select summary + bulk meaning / AI toggle through the queue (DR11). Effective visibility, "Hidden by frame <title>", the 3-choice un-hide confirm (D24).
- Shapes + ink with perfect-freehand: simplify, point cap, memoized path, eraser = ink only (D27, D28).
- Export sheet: 480px non-modal, live selection scope, token estimate, Copy, the D25 notices, DR4 states (DR3).
- Backup menu: streamed download + restore preview, batch progress, "Run again".
- Agents popover: create / list / revoke, token shown once, 3 connect steps with the single-quoted ${PORT4LIO_WB_TOKEN} header, a Codex tab (verify the Codex config keys against current docs first), and the 5 s first-call check that flips to "Connected" (DR5).
- tests: unit multi-select fan-out, tests/api bulk AI-on over a hidden-frame child stays hidden.

Phase 7 - e2e + final verification (T8)
- tests/e2e/whiteboard.spec.ts: (1) a card persists after reload, (2) delete a frame -> restore brings everything back, (3) a hidden card is left out of the export and the D25 notice shows, (4) a failed load shows Retry with no writes, (5) the Esc order, (6) the Agents "Connected" flip.
- Run all: `bun run format:check`, `bun run lint`, `bun run typecheck`, `bun run test`, `bun run test:e2e:local` (disposable DB only, never a real one).
- Compare the running page (`bun run dev`) with the 3 wireframes at 1440x900.

## Rules for the whole session

- Modules with subtle invariants open with a why-comment + ASCII diagram: context.ts, data.ts, token.ts, useSaveQueue (AGENTS.md "Comments explain why").
- House rules: compileModel, jsonError, readJsonBody, SelectField, cn(), className on reusable components, hyphens not em dashes, lucide icons not arrow glyphs.
- Nothing in NOT in scope (plan "NOT in scope" + design "NOT in scope").
- If the plan is ambiguous or contradicts the code, stop and ask. Don't invent behaviour. If a phase can't go green after 3 honest attempts, stop and report.
- Keep a short progress note after each phase (done / next / surprises) so the work survives a context compaction.

## Final report

Per phase: files added/changed, test counts, commit hash. Then the plan's "Success Criteria", each one met / not met with evidence. Then every D/DR decision you could not implement exactly, and why. Then open questions.
```

---

## Review prompt (/review)

Run once the implementation is done (or after any phase), before `/ship`.

```
/review

Context for this review: branch feat/whiteboard implements docs/designs/whiteboard.md. That doc is the spec, including the Decision ledger (D15-D30) and the Design Review (DR1-DR12). Later decisions override the doc body.

Beyond your normal checklist, check these, because they are where this feature can fail quietly:
- Privacy: every agent-facing read (export context, context.md, all 3 MCP tools, get_overview counts, ink labels) goes through loadAgentVisible. Nothing queries WhiteboardItem directly on those paths. Rules 1-10 in plan "Privacy" hold, including rule 8 on single AND bulk moves, and the D24 un-hide.
- Auth: every /api/admin/whiteboard handler starts with requireOwner. Agent routes use the bearer header only, the rate limit runs before verification, a DB error gives 503, REQUIRE_ADMIN can't open them, and no hash or plaintext token is ever stored or returned after creation.
- No caching of private data: Cache-Control no-store, private on every whiteboard response.
- Save queue: idempotent creates, no recreate after delete, 4xx permanent / 5xx retried, parent/link waits, bulk reject re-queue, no editing of a partial board.
- Vercel limits: large reads are streamed in frames -> items -> links order, restore goes in <= 2 MB batches, and agent reads never load ink.points.
- House rules: compileModel, jsonError, readJsonBody with explicit maxBytes, SelectField, cn(), hyphens not em dashes, lucide icons not arrow glyphs, why-comments with ASCII diagrams on context.ts / data.ts / token.ts / useSaveQueue.
- Tests exist for each item above (see plan "Test coverage diagram" and "Tests added by this review").

Report which decisions (D/DR ids) the diff implements, which it misses, and anything it does that the plan doesn't allow.
```
