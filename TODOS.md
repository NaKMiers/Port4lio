# TODOS

## IQ

### IQ certificate links die with their 21-day attempt

**What:** Keep IQ certificate and verify pages reachable after the paid attempt's 21-day TTL.

**Why:** A paid customer's shared certificate link starts returning 404 about three weeks after purchase.

**Context:** `src/app/(choice)/[lang]/iq/(plain)/certificate/[id]/page.tsx:48` and `verify/[id]/page.tsx:75` read only `IqAttemptModel.findOne({ certificateId })`. `src/models/IqAttempt.ts:163` puts a TTL on `expireAt`, and `src/lib/iq/fulfil.ts:151` deliberately leaves a paid attempt's `expireAt` alone. Options are a separate certificate row that outlives the attempt (name, score band, issued date, id only) or clearing `expireAt` on paid attempts. Either way, check the IQ privacy page (vi and en) against what is kept, and extend `tests/api/retention.test.ts`. Found during the MCP eng review, 2026-09-24 (`docs/designs/mcp/mcp-plan.md` T1).

**Effort:** S
**Priority:** P2
**Depends on:** None

## Blog

### BLOG_CRON_LIMIT and its comment disagree (10 a day vs "already at 1")

**What:** Decide whether the daily blog cron allows 1 or 10 runs a day, then make the constant and its comment agree.

**Why:** The comment says a duplicate delivery is refused by a counter already at 1, but `limit: 10` lets it run, so a duplicate delivery can publish a second auto-generated post the same day. Or the number is deliberate (manual re-runs) and the comment misleads.

**Context:** `src/lib/rate-limit.ts:325-345` (`BLOG_CRON_LIMIT`), the schedule `22 22 * * *` in `vercel.json`, and `docs/blog/generate-daily.yml`. Add a unit test in `tests/unit/rate-limit.test.ts` pinning the chosen value. Found during the MCP eng review, 2026-09-24 (`docs/designs/mcp/mcp-plan.md` T2).

**Effort:** S
**Priority:** P3
**Depends on:** None

## Completed

### Local undo/redo on the canvas

**What:** A client-side undo stack (Cmd/Ctrl+Z, Shift+Cmd/Ctrl+Z, Ctrl+Y) on `/admin/whiteboard` for moves, edits, creates and deletes. The delete confirm came out with it: Delete now removes the selection at once and offers Undo on a toast.

**Why:** Hard delete plus ~600 ms autosave means a mis-drag or a wrong delete is saved almost at once. In v1 the only ways back were the delete confirm and "Restore from backup", which needs a backup downloaded earlier.

**How it went:** Deferred from the whiteboard eng review (D30). Not built on the save queue or `data.ts` as sketched, and not on the restore route either - `src/components/whiteboard/history.ts` diffs a board snapshot against the board and sends the difference through the queue's existing ops, so there is no second write path to keep in step. Delete-undo did need its own rule: R3-6 keeps a deleted id dead for the session, so the card comes back as a copy under a fresh id rather than being revived. Rule 8 holds - every field comes back, `includeInAi` included. See `docs/designs/whiteboard.md` > "Undo/redo".
