# Owner isolation - plan

Status: DRAFT, under `/plan-eng-review` (2026-09-24). Nothing is implemented yet.
Target: this plan. Branch: `main`.

## 1. Problem

Several people deploy this source against one MongoDB. The portfolio page picks
its data with `PROFILE_DOCUMENT_ID` (`src/models/Profile.ts:6`), but that key
scopes one collection only. Every other record - posts, kinds, series,
subscribers, orders, contact messages, whiteboard, CCA-F, agent tokens, audit
rows - is global. So a deployment with `PROFILE_DOCUMENT_ID=khanhan` shows
anhkhoa's blog, and its owner can read anhkhoa's orders and agent activity.

Goal, in the owner's words: everything refers to the profile id in `.env`, so
that others running this source cannot reach anhkhoa's personal data.

## 2. What the investigation found

The live database (`port4lio` on an Atlas replica set, selected by the URI
path; read-only probe on 2026-09-24):

| Collection | Docs | Scoped by profile today | Collides across owners | Notes |
|---|---|---|---|---|
| `profile` | 3 (`anhkhoa`, `khanhan`, `ngoctram`) | yes (`_id`) | - | only scoped collection |
| `posts` | 11 | no | unique `slug`; unique partial `{series}` pillar index | `loadPost(id)` and 15 other `findById` sites trust the id |
| `blog_kinds`, `blog_series` | 1, 2 | no | unique `slug`; seed guard uses `estimatedDocumentCount()` on the whole collection (`kind-data.ts:34`, `series-data.ts:40`) | `taxonomy-service.ts:131/168/259/296` find by URL id |
| `postEvents` | 50 | no | `_id` = `blog:<kind>:<slug>:<session>` | `permanentDeletePost` runs `deleteMany({slug})` (`post-service.ts:758`) and `updateMany({relatedSlugs})` (`:773`) across everyone |
| `subscribers` | 1 | no | unique `email` | confirm/unsubscribe look up by token only |
| `contactMessages` | 1 | no | - | holds visitor PII; `countDocuments({sourceSlug})` is global |
| `mbtiAttempts`, `iqAttempts` | 1, 8 | no | unique partial `certificateId` | result page lock follows the *serving* deployment's price env, so a paid token opened on a free deployment shows the full result |
| `mbtiPayments`, `iqPayments` | 4, 1 | no | unique `orderCode` | buyer email PII; webhook + poller find by `orderCode` only; `find_order` MCP tool returns any row |
| `testEvents` | 5 | no | `_id` = `<product>:funnel:<event>:<day>` | all deployments increment one funnel doc per day |
| `mbtiRateLimits` | 0 | no | `_id` = `<route>:<ip>:<window>` | `blog-cron:daily` is one 10-a-day budget for every deployment |
| `ccafProgress` | 1 | no | fixed `_id: 'ccaf-progress'` (`CcafProgress.ts:44`) | singleton shared by everyone |
| `whiteboard_vocab` | 1 | no | fixed `_id: 'vocab'` (`WhiteboardVocab.ts:18`) | singleton |
| `whiteboard_boards/items/links` | 1, 13, 5 | no (board only) | unique `{from,to,label}` on links; client-generated `_id`s | `ensureBoards` adopts every `boardId:null` row (`whiteboard/data.ts:277-282`); `?board=` is never ownership-checked; restore uses raw `collection.bulkWrite` (`data.ts:1643`, `:1663`), which bypasses Mongoose middleware |
| `agent_tokens`, `whiteboard_tokens` | 1, 0 | no | unique `hash` | `verifyBearer` is `findOne({hash, revokedAt:null})` (`mcp/token.ts:257`): a `p4_` token minted on A works on B |
| `agent_actions` | 0 | no | - | owner feed is `find({})` (`mcp/audit.ts:16`) |
| `publishState` | 1 | - | - | no code references it; legacy |

Every non-profile record was created between 2026-09-02 and 2026-09-24. The
`khanhan` and `ngoctram` profiles were last written 2026-03-30 and 2026-04-19,
so those deployments most likely run older code and own none of the other rows.
**Assumption A0: every non-profile row belongs to `anhkhoa`.** To be confirmed.

Outside the database:

- The owner cookie payload is only `{exp}`, HMAC-signed with `AUTH_SECRET`
  (`src/lib/auth.ts:25-30`). The OTP cookie hashes only the code (`auth.ts:69`).
  If two deployments share `AUTH_SECRET` (a copied `.env`), a cookie from one
  unlocks the other.
- Mail `from` is hard-coded to `no-reply@anhkhoa.info` (`src/lib/mailer.ts:44`)
  for every deployment.
- Cloudinary folders are fixed (`portfolio/blog`, ...). Whoever shares the
  Cloudinary keys shares the asset library. No code lists or deletes assets.

Size of a row-level change: 263 model call sites in 56 `src` files, plus 34 test
files that create or read models directly.

## 3. The premise that decides the approach

**Whoever holds the shared `MONGODB_URI` can read everything, whatever the code
does.** MongoDB has no row-level security. Access is granted per database or
per collection. A `profileId` filter in our queries is enforced only by our own
code. A person who has this source and the shared URI can set
`PROFILE_DOCUMENT_ID=anhkhoa`, or open `mongosh`, and read every row, including
`resume.contact`, buyer emails and contact messages.

So row-level `profileId` gives **isolation against mistakes** (the wrong blog
showing up), not **protection from people**. The owner's goal is protection.
That needs a separate credential per owner, and in MongoDB the smallest unit
a credential can be limited to is a database.

## 4. Approaches

### A. One database per owner, one Atlas user per database (recommended)

Each deployment's `MONGODB_URI` names its own database (`.../port4lio` for
anhkhoa, `.../port4lio_khanhan`, `.../port4lio_ngoctram`). Each URI uses its
own Atlas database user, granted `readWrite` on that database only. The old
shared user is deleted. Collections, indexes and queries stay as they are.

```
  deployment (anhkhoa)            deployment (khanhan)
  MONGODB_URI=u_anhkhoa@.../port4lio     MONGODB_URI=u_khanhan@.../port4lio_khanhan
          │                                   │
          ▼                                   ▼
  ┌──────────────────┐   Atlas refuses   ┌───────────────────────┐
  │ db port4lio      │◀──── u_khanhan ───│ db port4lio_khanhan   │
  │ profile:anhkhoa  │                   │ profile:khanhan       │
  │ posts, orders... │                   │ (its own posts later) │
  └──────────────────┘                   └───────────────────────┘
```

Code work stays small, and all of it hardens the deployment rather than
re-plumbing queries:

- A1 (ops, the owner in Atlas): create `u_anhkhoa`, `u_khanhan`, `u_ngoctram`
  with `readWrite@<own db>`; update each deployment's env; delete the shared
  user. Until this step, nothing is protected.
- A2 (migration script): copy the `khanhan` and `ngoctram` profile documents
  into their own databases, verify them, then delete them from `port4lio`. Dry
  run by default. Under A0 nothing else moves.
- A3 (tripwire at connect, `src/lib/mongodb.ts`): refuse to serve when the
  connected database is Mongo's default `test` (a URI with no path), or when
  `profile` contains any `_id` other than `PROFILE_DOCUMENT_ID`. That catches a
  second owner being pointed at the wrong database before it writes anything.
- A4 (auth binding, `src/lib/auth.ts`): put `sub: PROFILE_DOCUMENT_ID` into the
  owner cookie and into the OTP hash input, and reject a mismatch. A shared
  `AUTH_SECRET` then no longer crosses deployments. Existing sessions end once;
  the owner signs in again.
- A5 (docs): `.env.example`, `AGENTS.md` "Deployment model" and a short
  `docs/deploy/own-database.md` walkthrough of the Atlas steps.
- A6 (tests): unit tests for the tripwire and the cookie binding; an API test
  against `mongodb-memory-server` for the tripwire.

### B. `profileId` on every row, explicit filters (what was literally asked)

Add `profileId` (required, immutable, default `PROFILE_DOCUMENT_ID`) to 17
models. Add a `scoped()` filter helper and use it at all 263 call sites. Replace
7 unique indexes with compound `{profileId, ...}` ones. Re-key the 2 singletons
and the string `_id` schemes (`testEvents`, `postEvents`, `mbtiRateLimits`) with
a profile prefix. Fix `estimatedDocumentCount` seed guards, `ensureBoards`
orphan adoption, the raw `bulkWrite` in restore, the `find_order` / webhook /
poller lookups, token verification and the result-page capability tokens.
Backfill every existing row with `profileId: 'anhkhoa'`, and drop and rebuild
the indexes on the live cluster. Touches about 56 source files and 34 tests.

### C. `profileId` on every row, injected by a Mongoose plugin

The same data change as B, but a global plugin adds the field and injects
`{profileId}` into query and aggregate middleware, so most call sites stay
untouched. Raw driver calls (`collection.bulkWrite`), `estimatedDocumentCount`
and the string-`_id` schemes still need hand edits. Fewer diffs, more magic: a
filter the reader cannot see.

### Comparison

| | A. DB per owner | B. explicit `profileId` | C. plugin `profileId` |
|---|---|---|---|
| Stops a peer who has the source | **yes**, Atlas refuses | no (same URI) | no (same URI) |
| Stops the wrong blog showing | yes | yes | yes |
| Files touched | ~8 | ~90 | ~40 |
| Live index rebuilds | none | 7 unique + all compound | same as B |
| Risk of a missed call site | none, nothing to miss | high (263 sites) | medium (raw driver, string ids) |
| Migration risk to the live site | low (moves 2 profile docs) | high (backfill + index swap) | high |
| Reversible | yes (point the URI back) | hard | hard |
| Effort | human ~1 day / CC ~1-2 h | human ~2 weeks / CC ~1 day | human ~1 week / CC ~4 h |

B and C are still worth it only when owners must share one database user,
for example a hosted multi-tenant product. That is not the situation here.

## Decision ledger

### R1: How ownership is isolated
Finding: S1, P0, confidence 9/10, `src/models/Profile.ts:6` (`export const PROFILE_DOCUMENT_ID = process.env.PROFILE_DOCUMENT_ID!`), `src/lib/mongodb.ts:44-47` (`mongoose.connect(mongodbUri)` with the database taken from the URI path), live probe: 3 profiles and 21 shared collections in `port4lio`. Reviewer: Claude (plan-eng-review).
Plan baseline: owner's request - every record refers to the `.env` profile id (approach B or C).
Runtime evidence: every deployment connects with the same URI and user; MongoDB grants privileges per database or collection, never per row; 263 unscoped call sites.
Comparison grid:

| Choice | Current | A | B | C |
|---|---|---|---|---|
| Isolation unit | none (one shared DB, one user) | database + Atlas user per owner | `profileId` per row, explicit filters | `profileId` per row, plugin-injected |
| Enforced against a peer holding the source | no | yes | no | no |
| Existing data move | - | 2 profile docs out of `port4lio` | backfill all rows + 7 index swaps | same as B |
| Hardening A3 tripwire, A4 cookie binding | absent | pending (R2, R3 in Section 1) | pending (separate) | pending (separate) |
| Credential rotation (A1) | shared user | required, part of A | pending (separate) | pending (separate) |

Question D3:
D3 - How should each owner's data be isolated? Project/branch/task: Port4lio on main, making deployments that share one MongoDB stop seeing each other's data. ELI10: Right now all three people's sites log into the same database with the same password, and the only thing keeping a portfolio page on the right person is one field. You asked to tag every record with the profile id, which fixes the wrong blog showing up. But anyone holding that shared password can just change their profile id to yours, or open the database directly, and read everything. The only thing MongoDB can actually lock is a whole database, so real protection means one database and one password per person. Stakes if we pick wrong: we spend about a day re-plumbing 263 queries and rebuilding live indexes, and your buyers' emails, contact messages and CV contact details stay readable by anyone with the old URI. Recommendation: A because it is the only option that actually keeps other people out, and it is also the smallest change. Note: options differ in kind, not coverage - no completeness score. Pros / cons: A) Database per owner (recommended) ✅ Atlas itself refuses another owner's credentials, so no code bug can leak your data ✅ Under 10 files, no live index rebuilds, and reverting is just pointing the URI back ❌ You have to create 3 Atlas users and hand each person a new URI, and old deployments break until they update. B) profileId on every row ✅ Matches your original request exactly, and everyone keeps one database and one URI ✅ Guards against the wrong-blog-showing bug even if someone misconfigures ❌ Protects nothing from a peer with the shared URI, and touches about 90 files plus 7 live index swaps. C) profileId via plugin ✅ Same data model as B with far fewer diffs, because middleware injects the filter ❌ Same zero protection as B, plus an invisible filter that raw driver calls quietly bypass. Net: A buys real protection for less work; B and C buy tidiness inside a database everyone can still open.
Header: Isolation
Options:
A) Database per owner (recommended)
One Atlas database and database user per owner (approach A: A1 Atlas users and rotation, A2 profile split script, A5 docs, and the tests for those). No schema or query changes. The A3 tripwire and A4 cookie binding are decided separately (R2, R3). Human ~1 day / CC ~1-2 h. Low risk; the maintenance is keeping one env per owner.
B) profileId on every row
Approach B: a required `profileId` on 17 models, explicit filters at all 263 call sites, 7 compound unique indexes, re-keyed singletons and string ids, backfill to `anhkhoa`. Human ~2 weeks / CC ~1 day. High migration risk; every future query must remember the filter. Credential rotation and auth binding stay separate choices.
C) profileId via plugin
Approach C: the same data change as B, with filters injected by a global Mongoose plugin; hand edits only for raw driver calls, `estimatedDocumentCount` and string ids. Human ~1 week / CC ~4 h. High migration risk; the filter is invisible at the call site. Credential rotation and auth binding stay separate choices.

State: pending
Actual answer: unanswered
Accepted scope: none
History: none
