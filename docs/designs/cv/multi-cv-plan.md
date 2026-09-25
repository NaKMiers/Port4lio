# Multi-CV plan

Status: reviewed by `/plan-eng-review` (2026-09-25), ready to implement
Branch: main
Repo: NaKMiers/Port4lio
Target: the multi-CV requirements given in chat on 2026-09-25 (below, verbatim in intent)

## Requirements

- R1. Create, edit and delete many CVs instead of the single `profile.resume` block.
- R2. Exactly one CV is published; the published one is what `/cv` renders.
- R3. The published CV cannot be deleted. Publish another CV first, then delete.
- R4. The CV tab in `/admin/settings` gets a dropdown to pick the CV being edited, plus
  create, rename (label) and delete actions. Delete asks for confirmation.
- R5. On the CV tab, "Save profile" is disabled and a "Save CV" button is shown instead.

## Current state (what exists today)

```
 /admin/settings (client)                         Mongo: profile (singleton)
 ┌──────────────────────────────┐                ┌──────────────────────────┐
 │ SettingEditor                │  POST          │ _id = PROFILE_DOCUMENT_ID│
 │  profile state (ONE object)  │ /api/profile   │ fullName, socials, ...   │
 │   ├─ Profile/Career/Offering │ ─────────────▶ │ cv   (downloadable file) │
 │   └─ CV tab: profile.resume  │ replaceProfile │ resume (the /cv sheet)   │
 │ Save profile (toolbar+float) │  $set whole    └──────────────────────────┘
 └──────────────────────────────┘                   ▲            ▲
                                                    │            │ .select('resume avatar')
 MCP get_me / get_profile resume ── readProfileSection('resume')  │
 /cv page ── loadPublicResume (unstable_cache, PUBLIC_PROFILE_CACHE_TAG) ── deriveResume
```

- The CV lives in `profile.resume` (`src/models/Profile.ts:222`). Absent means "never
  written", and `deriveResume` (`src/lib/resume-view-model.ts`) then prints `RESUME_SEED`.
- One save button writes the whole profile, CV included (`cleanProfileForSave` ->
  `POST /api/profile` -> `replaceProfile`, `src/lib/profile-service.ts:74`).
- `/cv` reads it through `loadPublicResume` (`src/lib/profile-data.ts:125`), cached under
  `PUBLIC_PROFILE_CACHE_TAG` with a 60 s window, plus `export const revalidate = 60`.
- The site MCP reads it through `readProfileSection('resume')`
  (`src/lib/profile-sections.ts:106`); it is never agent-written (R8 in profile-service).
- Every CV card (`Resume*Section.tsx`, `useCvPageBreakFit`, `CvTabPreview`) takes the whole
  `profile` + `setProfile` and reaches `profile.resume` through `resumeOf` / `updateResume`
  (`src/components/settings/resume-utils.ts`), plus `profile.avatar` for the photo fallback.

## Final design (approved; decision ids in brackets)

### Data model [A1]

New collection `cvs`, model `CvModel` in `src/models/Cv.ts`, compiled with `compileModel`:

```text
 Cv {
   _id:          ObjectId          the migrated CV uses the constant LEGACY_CV_ID          [OV-2]
   label:        string            trimmed, 1..60 chars, shown in the dropdown             [D6]
   labelKey:     string            label.trim().toLowerCase(), unique index, set by the service
   resume:       resumeSchema      required                                                [OV-8]
   publishedAt:  Date | null       index { publishedAt: -1, _id: -1 }
   createdAt, updatedAt            Mongoose timestamps; updatedAt is the Save CV stale base
 }
```

"Published" = the CV with the greatest non-null `publishedAt`, ties broken by `_id`
[OV-3]. Publishing is ONE single-document write (`$currentDate: { publishedAt: true }`,
`{ timestamps: false }` so the editor's stale base survives [OV-1]). There is never a moment
with zero or two published CVs, and no transaction is needed (mongodb-memory-server in
`tests/api` is not a replica set). If the published CV disappears anyway, the previous
publish takes over rather than `/cv` going blank.

`resumeSchema` and its sub-schemas move from `Profile.ts` to `src/models/resume-schema.ts`
so `Profile.resume` (kept as the legacy source) and `Cv.resume` stay one definition.

Limits [D8]: `MAX_CVS = 20`, `MAX_CV_JSON_BYTES = 256 * 1024` in `src/lib/upload-limits.ts`.

### Service: one write path (`src/lib/cv/cv-service.ts`, `server-only`)

```text
 findPublished()                find({ publishedAt: { $ne: null } }).sort({ publishedAt: -1, _id: -1 }).limit(1)
                                shared by listCvs, the /cv resolver and MCP                  [OV-3]
 ensureMigrated()               await CvModel.init()                                          [OV-2]
                                estimatedDocumentCount() > 0 -> done
                                else insert { _id: LEGACY_CV_ID, label: "Main CV",
                                              resume: deriveResume(profile) (stored block or RESUME_SEED),
                                              publishedAt: $currentDate }
                                E11000 -> another request won; re-read, done
                                runs first in listCvs AND every mutating call                 [D5, OV-3]
 listCvs()                      ensureMigrated ; find().sort({ createdAt: 1 }) ; + publishedId
 createCv({ label, fromId })    count < MAX_CVS else { cap } 409 ; fromId must exist else 404
                                insert from explicit fields: label, labelKey, resume = copy of
                                fromId's SAVED resume, publishedAt: null                       [P1, OV-3]
                                E11000 on labelKey -> { labelTaken } 409                       [D6]
 saveCv(id, { resume?, label?, base })
                                base = updatedAt the editor loaded, or '*' (overwrite)         [OV-5]
                                findOneAndUpdate({ _id, updatedAt: base }, { $set: { resume: normalizeResume(resume), label, labelKey } })
                                miss + doc exists -> { stale, updatedAt } 409 ; miss + no doc -> 404
                                E11000 -> { labelTaken } 409
                                then ALWAYS revalidateTag(PUBLIC_PROFILE_CACHE_TAG, { expire: 0 })   [D10]
 publishCv(id)                  updateOne({ _id }, { $currentDate: { publishedAt: true } }, { timestamps: false })
                                0 matched -> 404 ; then revalidateTag(..., { expire: 0 })
 deleteCv(id)                   top = findPublished()
                                deleteOne({ _id: id, $or: [{ publishedAt: null },
                                                           { publishedAt: { $lt: top.publishedAt } }] })
                                0 deleted + doc exists -> { published } 409 ; + no doc -> 404   [R3, D10]
```

Revalidation lives inside the service after the write succeeds (AGENTS.md "one service per
write"). `{ expire: 0 }`, not `'max'`: the owner publishes and then opens `/cv` to check, and
stale-while-revalidate would show the old CV exactly once, the trap `patchProfileSection`
documents. The promise is "fresh on a full load"; a `/cv` copy the browser prefetched through
`<Link>` may still be served from the client router cache [OV-12].

`cv-service.ts` carries a header comment with this flow, including why publish uses
`$currentDate` + `timestamps: false` and why migration uses a fixed `_id`.

### Read paths

```text
 /cv page, generateMetadata ─▶ loadPublishedResume()      profile-data.ts, unstable_cache,
                                  ├─ findPublished()         same PUBLIC_PROFILE_CACHE_TAG
                                  ├─ none (never migrated) ─▶ profile.resume (legacy), or undefined -> seed
                                  └─ + profile.avatar for the photo fallback
                               ─▶ deriveResume(...) ─▶ CvSheets
 MCP readProfileSection('resume') ─▶ same resolver, uncached ─▶ deriveResume
```

Public reads never migrate (reads do not write). `/cv` is unchanged at deploy time: until
the owner first opens the CV tab, it renders `profile.resume` exactly as today.

### API (owner-only: `requireOwner` first line, `jsonError`, `readJsonBody` capped at `MAX_CV_JSON_BYTES`)

| Route                         | Method | Body                        | Result                                                                |
| ----------------------------- | ------ | --------------------------- | --------------------------------------------------------------------- |
| `/api/admin/cvs`              | GET    | -                           | `{ cvs: CvDto[], publishedId }`                                       |
| `/api/admin/cvs`              | POST   | `{ label, fromId }`         | 201 `{ cv }` ; 409 `labelTaken` / `cap` ; 404 fromId                  |
| `/api/admin/cvs/[id]`         | PATCH  | `{ label?, resume?, base }` | `{ cv }` ; 409 `code: 'stale'` + `updatedAt` ; 409 `labelTaken` ; 404 |
| `/api/admin/cvs/[id]`         | DELETE | -                           | `{ ok }` ; 409 `code: 'published'` ; 404                              |
| `/api/admin/cvs/[id]/publish` | POST   | -                           | `{ publishedId }` ; 404                                               |

`CvDto = { id, label, resume, publishedAt, updatedAt }`. Route `params` is a Promise in
Next 16 and is awaited before the ObjectId check; an invalid ObjectId is 404. Oversize body
is 413, malformed JSON 400. `resume` always goes through `normalizeResume` server-side.

### Settings UI

```text
 CV tab
 ┌──────────────────────────────────────────────────────────────────────┐
 │ [ Frontend CV · Published ▾ ]  [+ New]  [Rename]  [Publish]  [Delete] │  CvPicker
 │  The published CV is what /cv shows.   Unsaved changes                │
 │  Page break re-fitted - Save CV to keep it          (only when D9 hits)│
 ├──────────────────────────────────────────────────────────────────────┤
 │ ResumeMastheadSection / DragList of sections ... (unchanged look)     │
 └──────────────────────────────────────────────────────────────────────┘
 Toolbar:  [Metrics]  [Save profile]  [Save CV]
   CV tab:     Save profile disabled (title: "Switch to another tab to save the profile"), Save CV primary
   other tabs: Save CV hidden, Save profile as today
 Floating: follows whichever button is primary on the tab                             [R5]
```

State lives in a `useCvEditor` hook called from `SettingEditor` (not `CvTabSections`, which
unmounts on tab switch) so the draft survives tab switches and the preview rail can read it
[OV-4]. It owns: `cvs`, `publishedId`, `selectedId`, `draft: Resume`, `snapshot: Resume`
(last saved), `base` (updatedAt), `loading`/`error`, `stale`, and the actions. The pure
state transitions live in `src/components/settings/cv-editor-state.ts` so they unit-test
without React.

- `dirty` = `draft` deep-differs from `snapshot` [D9]. If the on-open auto-fit changes the
  page break, the notice line says so; the CV is then genuinely dirty.
- Dropdown: `SelectField`; options are the labels, the published one suffixed "Published".
- Switching with `dirty` opens `ConfirmDialog` "Discard unsaved changes to <label>?" [D4].
- New: `CvLabelDialog` asks for a label; content = saved copy of the selected CV [P1]. The new
  CV becomes selected. Rename: same dialog; a taken label shows the 409 message inline [D6].
- Delete: `ConfirmDialog`, destructive. Disabled with a title on the published CV ("Publish
  another CV first"); the server refuses anyway (409). After delete, the published CV is
  selected.
- Publish: disabled on the published CV and while `dirty` ("Save first"), so what goes live is
  always what was saved.
- While `uploading.cvPhoto`: picker, New, Delete and Publish are disabled [OV-6]. Save CV
  gates on `saving` and `uploading.cvPhoto` only.
- Save CV 409 stale: `StaleSaveBanner subject="cv"` (own test id, copy without "agent"):
  Reload refetches the CV list and resets the draft to the server copy; Overwrite re-sends
  with `base: '*'` [OV-5]. It never calls `refetchProfile`.
- On selecting a CV, the fitter re-runs `requestFit({ onlyIfClipped: true })` for it.
- CV cards take `resume` / `setResume` / `avatar` instead of `profile` / `setProfile` [S1];
  `resumeOf`/`updateResume` are removed. `CvTabPreview` and `useCvPageBreakFit` take
  `resume` + `avatar`; `PreviewRail` passes the draft on the CV tab.
- Profile side: `SettingEditor` stops seeding `resume`, and `cleanProfileForSave` deletes
  `resume` explicitly (it spreads `...profile`, and `/api/admin/profile` still returns the
  legacy field) [OV-8].
- Save CV body: `pruneResumeForCv(draft)`, a sibling of `pruneResume` that always returns a
  `Resume` (no "omit when empty") [OV-8].

### MCP

`get_me` and `get_profile resume` return the published CV through the shared resolver
(unchanged contract: one `resume` value, avatar fallback, seed when nothing exists).
`tailor-cv` text stays valid; its tool description can say "the published CV".
Listing or reading non-published CVs over MCP is not in scope.

### Legacy field

`profile.resume` stays in the schema and in Mongo, untouched, as the migration source and
the pre-migration fallback. `POST /api/profile` keeps accepting it
(`tests/api/profile-route.test.ts:265` pins that). A pre-deploy tab that saves the profile
after migration writes this ignored field (accepted, owner-only, one time). Removal is TODO
T1 in `TODOS.md`.

## NOT in scope

- Per-CV public URLs (`/cv/<slug>`): R2 says only the published CV is public.
- MCP tools to list, read or write non-published CVs: the resume stays human-edited (R8).
- Unpublishing (zero published CVs): R2/R3 imply there is always one.
- Removing the legacy `profile.resume` field: TODO T1, after the new path is proven.
- Version history per CV, per-CV drafts in memory (D4 chose one draft).

## What already exists (reuse, do not rebuild)

- `ConfirmDialog` (`src/components/admin/ConfirmDialog.tsx`) - discard and delete confirms, focus trap.
- `SelectField` (`src/components/settings/SelectField.tsx`) - the dropdown (AGENTS.md rule).
- `StaleSaveBanner` (`src/components/blog-admin/StaleSaveBanner.tsx`) - add `subject="cv"`.
- `requireOwner`, `jsonError`, `readJsonBody`, `compileModel` - route and model skeleton.
- `normalizeResume`, `makeEmptyResume` (`src/lib/profile.ts`), `deriveResume`, `RESUME_SEED`.
- `cleanProfileForSave`'s pruning helpers - `pruneResumeForCv` is built from the same pieces.
- `useCvPageBreakFit`, `CvSheets`, `CvTabPreview` - rendering unchanged, props narrowed.
- `PUBLIC_PROFILE_CACHE_TAG` - `/cv` already invalidates through it.
- Catch-11000-and-re-read (`src/lib/blog/post-service.ts`, `src/lib/mcp/run-tool.ts`) and the
  real-mongod index test (`tests/api/retention.test.ts`, `tests/api/setup-mongo.ts`).

## Review

### Step 0: Scope Challenge

1. Reuse: see "What already exists". Nothing in the repo already models "many of X, one
   live" except blog posts (status field), which is heavier than this needs.
2. Minimum: model + service + 3 routes + CV tab picker + save-button split + read-path
   switch. Per-CV URLs, MCP CV tools and history are deferred (NOT in scope).
3. Complexity: ~35 files, 2 new server modules. Gate tripped; structure answered in S1
   (Original arrangement).
4. Search: Aside not installed; no web search run. In-distribution knowledge only: the
   upsert-with-unique-index retry (MongoDB 4.2+) is Layer 1; "latest publishedAt wins" is
   Layer 3 reasoning, chosen so publish is one single-document write.
5. TODOS.md: no CV items. One new TODO proposed (T-legacy below).
6. Completeness: full api + unit + e2e coverage proposed (D7).
7. Distribution: no new artifacts; ships with the Next app.

Findings:

- S-1 [P2] (confidence 9/10) scope size, answered by S1.

### 1. Architecture

- Arch-1 [P1] (9/10) `src/models/Profile.ts:222` `resume: { type: resumeSchema, default: undefined }`
  and `src/lib/profile-service.ts:83` `$set: { ...parsed, updatedAt: now }`. Keeping many CVs
  in the singleton ties Save CV to the profile's stale guard. Answered by A1: separate collection.
- Arch-2 [P1] (9/10) `src/lib/profile-data.ts:93-95` reads `.select('resume avatar')` for
  `/cv`, and `src/lib/profile-sections.ts:113-124` does the same for MCP. Both must switch to
  the published-CV resolver with the legacy fallback, or `/cv` keeps printing the old block
  after the owner publishes. Necessary implementation of R2; no separate choice.
- Arch-3 [P1] (8/10) `src/app/(me)/cv/page.tsx:23` `export const revalidate = 60` and
  `src/lib/profile-service.ts:92` `revalidateTag(PUBLIC_PROFILE_CACHE_TAG, 'max')`. With
  `'max'`, the first `/cv` load after Publish still shows the previous CV (measured for the
  agent path, `profile-service.ts:52-56`). Publish and a save of the published CV use
  `{ expire: 0 }`. Necessary for R2 ("this will show on /cv"); no separate choice.
- Arch-4 [P2] (8/10) Migration timing for existing data: answered by D5.
- Arch-5 [P2] (7/10) Delete-published race: `deleteCv` reads the published id, then deletes.
  A concurrent Publish of the CV being deleted (two tabs) can delete the just-published CV;
  "latest publishedAt wins" then falls back to the previous publish, so `/cv` never goes
  blank, but it can serve a deleted CV for up to 60 s first. Reopened by the outside
  voice (OV-9); see D10.
- Security: every new route is owner-only via `requireOwner` (AGENTS.md; the existing
  `GET /api/admin/profile` uses `hasOwnerAccess` directly, not changed here). `resume` is
  normalized server-side. The published CV is served only as the `/cv` page and to `read`
  MCP tokens, exactly as today; non-published CVs are never public.

### 2. Code quality

- CQ-1 [P1] (9/10) `tests/api/resume-hide-photo.test.ts:40-42` asserts
  `cleanProfileForSave(editorProfile).resume?.hidePhoto` is true. Once the profile body stops
  carrying `resume`, this test must move to the Save CV body (`pruneResume`) and the `Cv`
  round trip. Regression contract in D7.
- CQ-2 [P2] (9/10) `src/components/settings/cleanProfileForSave.ts:141` `pruneResume` is
  private; export it so Save CV prunes exactly as Save profile did. Mechanical.
- CQ-3 [P2] (8/10) `src/components/settings/types.ts:31-41` `CvSectionProps` carries
  `profile`/`setProfile`; S1 moves it to `resume`/`setResume`/`avatar`, and `resume-utils.ts`
  `resumeOf`/`updateResume` go away with it.
- CQ-4 [P2] (7/10) Label rules (uniqueness): answered by D6.
- CQ-5 [P3] (8/10) `src/components/blog-admin/StaleSaveBanner.tsx:10` `subject?: 'post' | 'profile'`;
  add `'cv'`. Mechanical.
- Diagrams: `profile-service.ts`, `profile-data.ts`, `profile-sections.ts` header comments
  describe the resume read; update them in the same commit. `src/lib/cv/cv-service.ts` gets
  its own header diagram (the publish/delete/migrate flow above).

### 3. Tests

Framework: vitest (`tests/unit`, `tests/api` with mongodb-memory-server), Playwright
(`tests/e2e`, prod build). All new paths are GAPs today (nothing exists yet).

```
CODE PATHS                                              USER FLOWS
[+] src/lib/cv/cv-service.ts                            [+] CV tab
  ├── listCvs / ensureMigrated                            ├── [GAP] [→E2E] Create (copy) → edit → Save CV → Publish → /cv shows it
  │   ├── [GAP] empty + legacy resume → "Main CV" copy    ├── [GAP] Switch CV with unsaved edits (D4)
  │   ├── [GAP] empty + no legacy → RESUME_SEED           ├── [GAP] Delete published: button disabled, API 409
  │   ├── [GAP] concurrent first loads → exactly one CV   ├── [GAP] Delete other: confirm → gone, selection moves to published
  │   └── [GAP] non-empty → no write                      ├── [GAP] Rename to a taken label → inline error (D6)
  ├── createCv                                            ├── [GAP] Save profile disabled on CV tab, Save CV shown; floating button follows tab
  │   ├── [GAP] copy of fromId; unknown fromId → 404      └── [GAP] Stale save (two tabs) → StaleSaveBanner subject cv
  │   ├── [GAP] cap reached → 409
  │   └── [GAP] duplicate label → 409 (D6)              [+] Public
  ├── saveCv                                              ├── [GAP] [→E2E] /cv before migration = legacy profile.resume (unchanged)
  │   ├── [GAP] base matches → saved, normalized          └── [GAP] /cv after publish = new CV on the FIRST load (expire: 0)
  │   ├── [GAP] base stale → { stale }
  │   ├── [GAP] published CV saved → revalidateTag expire 0
  │   └── [GAP] non-published saved → no revalidate
  ├── publishCv: [GAP] sets latest; unknown id → 404; revalidates
  └── deleteCv: [GAP] published → refused; other → deleted; unknown → 404; publish/delete race → previous publish wins
[+] src/app/api/admin/cvs/** routes
  └── [GAP] 401 without owner cookie (all 5); 400 malformed JSON; 413 oversize; 404 bad ObjectId
[+] loadPublishedResume / readProfileSection('resume')
  ├── [GAP] published CV wins over legacy
  └── [★★★ TESTED] no CVs → legacy / seed — mcp-operator-tools.test.ts:416,431 (must stay green)
[+] useCvEditor (pure reducer part)
  └── [GAP] select/dirty/discard/after-delete selection
REGRESSION (CRITICAL)
  ├── [★★★ TESTED] POST /api/profile still stores resume if sent — profile-route.test.ts:265 (unchanged)
  ├── [★★  TESTED] hidePhoto round trip — resume-hide-photo.test.ts (moves to the Cv path, CQ-1)
  └── [GAP] profile save body no longer contains resume

COVERAGE: 2/30 paths tested today | all new paths are GAPs until built
```

Approved test files (D7, plus the outside-voice proof items):

- `tests/api/cv-service.test.ts` - every service branch in the diagram, against real mongod,
  plus: publish then save succeeds (OV-1); POST before any GET migrates first and `/cv` never
  renders an unpublished CV (OV-3); a copy starts with `publishedAt: null` and its own
  `labelKey` (OV-3); same-millisecond publish tie resolves by `_id` (OV-3); the delete/publish
  race returns 409 `published` (D10); `saveCv` always revalidates with `{ expire: 0 }` (D10);
  cap and 256 KB bounds (D8); migration of the legacy block, of the seed, and two concurrent
  first loads create one CV WITHOUT a prior `syncIndexes()` (OV-2).
- `tests/api/cv-indexes.test.ts` - the `labelKey` unique and `publishedAt` indexes are
  actually built (pattern: `tests/api/retention.test.ts`).
- `tests/api/cv-routes.test.ts` - 401 on all five without the owner cookie; 400 malformed;
  413 oversize; 404 bad ObjectId and unknown id; DTO shape; `base: '*'` overwrite.
- `tests/api/resume-hide-photo.test.ts` - rewritten onto `pruneResumeForCv` + `CvModel` +
  `loadPublishedResume` (CQ-1).
- `tests/api/mcp-operator-tools.test.ts` - add "a published CV is what get_me and get_profile
  resume return"; add `CvModel.deleteMany({})` to `afterEach`; cases at :416 and :431
  unmodified (OV-10).
- `tests/unit/cv-editor-state.test.ts` - select, snapshot dirty, auto-fit notice, discard,
  after-delete selection, upload lock (D4, D9, OV-6).
- `tests/unit/clean-profile-for-save.test.ts` - the profile body has no `resume` even when
  the input carries one; `pruneResumeForCv` never returns undefined (OV-8).
- `tests/e2e/cv-publish.spec.ts` - load `/cv` first; create a copy with a per-run label,
  change the name, Save CV, Publish, full-load `/cv` shows the new name; Delete on the
  published CV is disabled and the API returns 409; cleanup publishes the original back and
  deletes the test CV (OV-11).

### 4. Performance

- Perf-1 [P3] (8/10) `GET /api/admin/cvs` returns every CV with its resume so switching is
  instant. A resume is roughly 10-20 KB, so a cap keeps the payload bounded: MAX_CVS = 20
  (~400 KB worst case, one indexed query). Cap bound in D8.
- Perf-2 [P3] (8/10) `/cv` becomes two small indexed reads (published CV + profile avatar)
  instead of one, inside the same `unstable_cache` entry, so one extra round trip per cache
  miss (at most once a minute). Accepted, no change.

### Outside voice

Codex preflight: `model_unusable` (gpt-6-astra is not available on this ChatGPT-account
Codex login). Fallback: a fresh-context Claude `Plan` subagent, run in the foreground (this
host has no TaskOutput tool for the bounded background wait). Same harness, so this is not
outside-model coverage. Its claims were spot-checked against the code before recording.

Corrections adopted as necessary implementation of already-approved decisions (no new
behavior, no question needed):

- OV-1 [P1] (9/10) Publish must not bump `updatedAt`, or the next Save CV 409s as stale.
  `publishCv` updates with `{ timestamps: false }`; rename returns the new `updatedAt` and the
  client updates `base` without touching the draft. Test: publish, then save, succeeds.
- OV-2 [P1] (9/10) Migration concurrency (D5 mechanism): the `legacy` partial index plus a
  `labelKey` unique index can collide on the wrong index (no upsert retry), and autoIndex
  builds asynchronously (`reactStrictMode: true`, `next.config.js:3`, fires the mount GET
  twice in dev). Replace with a fixed constant `_id` (`LEGACY_CV_ID`, a fixed ObjectId) for the
  migrated CV, `await CvModel.init()` before the first write, and catch `11000` then re-read
  (the repo pattern, `post-service.ts`, `run-tool.ts`). Add an index-built test like
  `tests/api/retention.test.ts`. The `legacy` field and its index are dropped.
- OV-3 [P1] (9/10) One `findPublished()` shared by `listCvs().publishedId`, `/cv` and MCP:
  filter `publishedAt: { $ne: null }`, sort `{ publishedAt: -1, _id: -1 }`. Publish sets the
  date with `$currentDate` (database clock, not the serverless instance clock). New CVs are
  built from explicit fields (`label`, `labelKey`, `resume`, `publishedAt: null`), never a
  spread of the source. Every mutating service call runs `ensureMigrated()` first, so a POST
  before any GET cannot leave `/cv` rendering an unpublished CV.
- OV-4 [P1] (9/10) `useCvEditor` lives in `SettingEditor`, not `CvTabSections` (which
  unmounts on tab switch, `settings/page.tsx:403-411`), so the draft survives tab switches and
  `PreviewRail`/`CvTabPreview` can read it. The CV tab gets its own loading and error states
  (the page can open directly on the CV tab, `readStoredTab`).
- OV-5 [P2] (8/10) CV stale banner: Reload refetches the CV list and resets the draft to the
  server copy (it must NOT call `refetchProfile`, which unmounts the editor); Overwrite sends
  `base: '*'` like the profile route. `StaleSaveBanner` gets `subject="cv"`, its own test id,
  and copy that does not blame an agent.
- OV-6 [P2] (8/10) While `uploading.cvPhoto` is set, the picker, New, Delete and Publish are
  disabled, so a finishing upload cannot land in another CV. Save CV gates only on
  `uploading.cvPhoto`, not on avatar or project uploads from other tabs.
- OV-8 [P1] (9/10) Save CV never uses the "omit when empty" rule: export
  `pruneResumeForCv(resume): Resume` (always returns a Resume) next to `pruneResume`;
  `Cv.resume` is required and PATCH `resume` is validated as present when sent. The profile
  body deletes `resume` explicitly, because `cleanProfileForSave` spreads `...profile`
  (`cleanProfileForSave.ts:248`) and `/api/admin/profile` still returns the legacy field.
- OV-10 [P2] (9/10) Regression refs corrected to `mcp-operator-tools.test.ts:416` (avatar
  fallback) and `:431` (seed). Adding the "published CV wins" case there needs
  `CvModel.deleteMany({})` in its `afterEach`; the two existing cases stay unmodified.
- OV-11 [P2] (8/10) e2e: load `/cv` once before publishing (as `taxonomy-revalidate.spec.ts`
  does), use a per-run unique label, and clean up (publish the original back, delete the test
  CV) so repeated runs do not fill `MAX_CVS` or leave a test CV live.
- OV-12 [P3] (7/10) `revalidateTag(tag, { expire: 0 })` does expire the `/cv` ISR entry
  (`unstable_cache` adds its tags to the page). The browser router cache can still hold a
  prefetched `/cv` from `<Link>` (`HeroSection.tsx:231`); the promise is "fresh on a full
  load", and the e2e asserts that.
- OV-14 [P3] `labelKey` is set explicitly in the service (no `pre('save')` on
  `findOneAndUpdate`); `$set: { resume }`; route `params` is awaited before the ObjectId
  check; `FloatingSaveButton` is wired to whichever toolbar button is primary on the tab.
  A pre-deploy tab that saves the profile after migration writes the ignored legacy field;
  accepted (one-time, owner-only).

Choices raised by the outside voice: OV-7 (D9), OV-9 (D10), OV-13 with Perf-1 (D8).

## Decision ledger

### S1: Complexity gate - file arrangement

Finding: S-1, P2, confidence 9/10, ~35 touched files and 2 new server modules. Reviewer: plan-eng-review.
Plan baseline: original proposal.
Runtime evidence: 8 files take `profile`/`setProfile` only to reach `profile.resume` and `profile.avatar` (`resume-utils.ts:7-17`, `useCvPageBreakFit.tsx:50`, `CvTabPreview.tsx:54`, `ResumeMastheadSection.tsx:49`).
Comparison grid:

| Choice             | Current            | A Original               | B Smaller                          |
| ------------------ | ------------------ | ------------------------ | ---------------------------------- |
| Feature list R1-R5 | pending            | same                     | same                               |
| CV card props      | profile/setProfile | resume/setResume/avatar  | unchanged behind an adapter setter |
| Publish route      | n/a                | separate `/[id]/publish` | `PATCH { publish: true }`          |
| Label dialog       | n/a                | own component            | inline in CvPicker                 |

Question D1: File arrangement for multi-CV (complexity gate). Recommendation: A, explicit props beat an adapter that silently drops writes.
Header: Arrangement
Options:
A) Original arrangement (recommended)
CV cards move to resume/setResume/avatar props; separate publish route; dedicated CvLabelDialog. ~35 files.
B) Smaller arrangement
CV cards untouched behind an adapter; publish folded into PATCH; dialog inline. ~22 files.

State: approved
Actual answer: A) Original arrangement (D1, 2026-09-25)
Accepted scope: feature answers: R1-R5 as given, no cuts; structure: A (D1); accepted scope: Original arrangement; pending remedies: D4-D8
History: -

### A1: Storage

Finding: Arch-1, P1, 9/10, `src/models/Profile.ts:222`, `src/lib/profile-service.ts:83`. Reviewer: plan-eng-review.
Plan baseline: separate collection proposed.
Runtime evidence: one profile document, whole-document save guarded by one `updatedAt`.
Comparison grid:

| Choice                  | Current          | A Collection          | B Embedded                    |
| ----------------------- | ---------------- | --------------------- | ----------------------------- |
| Where CVs live          | `profile.resume` | `cvs` collection      | `profile.resumes[]` + pointer |
| Save CV vs Save profile | n/a              | independent documents | shared stale guard            |

Question D2: Where do the CVs live? Recommendation: A.
Header: CV storage
Options:
A) Separate cvs collection (recommended)
New CvModel, published = latest publishedAt, own routes, legacy field kept as migration source.
B) Array inside profile doc
profile.resumes[] + publishedResumeId in the singleton.

State: approved
Actual answer: A) Separate cvs collection (D2, 2026-09-25)
Accepted scope: `cvs` collection and `CvModel` as designed above, published = greatest `publishedAt`, `resumeSchema` shared from `src/models/resume-schema.ts`, legacy `profile.resume` kept.
History: -

### P1: New CV start

Finding: product gap in R1. Reviewer: plan-eng-review.
Plan baseline: unspecified.
Runtime evidence: n/a.
Comparison grid:

| Choice         | Current | A Copy                        | B Seed        | C Choose        |
| -------------- | ------- | ----------------------------- | ------------- | --------------- |
| New CV content | n/a     | saved copy of the selected CV | `RESUME_SEED` | radio in dialog |

Question D3: What does a new CV start from? Recommendation: A.
Header: New CV start
Options:
A) Copy of selected CV (recommended)
Label prompt; content = saved version of the CV currently open.
B) Seed template
C) Choose in dialog

State: approved
Actual answer: A) Copy of selected CV (D3, 2026-09-25)
Accepted scope: `createCv({ label, fromId })` copies the saved resume of `fromId` (the selected CV); the New dialog asks only for a label.
History: -

### D4: Switching CVs with unsaved changes

Finding: UX gap in R4, P2, 8/10. The draft lives only in memory; the dropdown would otherwise drop it silently. Reviewer: plan-eng-review.
Plan baseline: unspecified.
Runtime evidence: today the CV tab shares `profile` state, so tab switches keep edits (`settings/page.tsx:333-335`).
Comparison grid:

| Choice                  | Current | A Confirm discard                                   | B Keep per-CV drafts                                                                  |
| ----------------------- | ------- | --------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Switch with dirty draft | n/a     | ConfirmDialog "Discard unsaved changes to <label>?" | switch freely; each CV keeps its draft in memory, dot marks dirty CVs in the dropdown |
| Save CV saves           | n/a     | the one draft                                       | only the selected CV's draft                                                          |

Header: Unsaved switch
Options:
A) Confirm and discard (recommended)
B) Keep a draft per CV
State: approved
Actual answer: A) Confirm and discard (D4, 2026-09-25)
Accepted scope: Switching with a dirty draft opens ConfirmDialog 'Discard unsaved changes to <label>?'; cancel keeps the current CV; one draft at a time.
History: -

### D5: Migrating the existing CV

Finding: Arch-4, P2, 8/10. Reviewer: plan-eng-review.
Plan baseline: lazy migration on first `GET /api/admin/cvs`.
Runtime evidence: `/cv` today reads `profile.resume` or the seed (`profile-data.ts:93-101`).
Comparison grid:

| Choice                    | Current | A Lazy on first admin load                        | B One-off script                                              |
| ------------------------- | ------- | ------------------------------------------------- | ------------------------------------------------------------- |
| When "Main CV" is created | n/a     | first CV tab open after deploy, idempotent upsert | when the owner runs `bun scripts/migrate-cvs.ts` against prod |
| /cv before migration      | legacy  | legacy fallback                                   | legacy fallback until script runs                             |
| Legacy field              | kept    | kept                                              | kept                                                          |

Header: Migration
Options:
A) Lazy, idempotent (recommended)
B) One-off script
State: approved
Actual answer: A) Lazy, idempotent (D5, 2026-09-25)
Accepted scope: `ensureMigrated()` inside `listCvs()` upserts 'Main CV' (`legacy: true`, unique partial index) from `deriveResume(profile)` when the collection is empty, published immediately; `profile.resume` untouched; public reads never migrate and fall back to the legacy block.
History: -

### D6: Label rules

Finding: CQ-4, P2, 7/10. Reviewer: plan-eng-review.
Plan baseline: unique (case-insensitive), 1-60 chars.
Runtime evidence: n/a.
Comparison grid:

| Choice                      | Current | A Unique                  | B Duplicates allowed         |
| --------------------------- | ------- | ------------------------- | ---------------------------- |
| Two CVs labelled "Frontend" | n/a     | refused 409, inline error | allowed; dropdown shows both |
| Length                      | n/a     | 1-60                      | 1-60                         |

Header: Label rules
Options:
A) Unique labels (recommended)
B) Allow duplicates
State: approved
Actual answer: A) Unique labels (D6, 2026-09-25)
Accepted scope: Labels trimmed, 1-60 chars, case-insensitive unique via `labelKey` unique index; create/rename to a taken label returns 409 and the dialog shows the error inline.
History: -

### D7: Test depth and regression contract

Finding: Test review, CQ-1. Reviewer: plan-eng-review.
Plan baseline: test files listed under "3. Tests".
Runtime evidence: `resume-hide-photo.test.ts:40-42` depends on `cleanProfileForSave` sending `resume`; `profile-route.test.ts:265` pins POST storing it; `mcp-operator-tools.test.ts:416,431` pin the no-CV fallback.
Regression contract (both options): keep `profile-route.test.ts` and the two MCP fallback tests unmodified and green; move the hidePhoto round trip to the Cv path; `/cv` before migration renders exactly the legacy block.
Comparison grid:

| Choice                       | Current | A Full | B No e2e |
| ---------------------------- | ------- | ------ | -------- |
| api (service + routes + MCP) | none    | yes    | yes      |
| unit (reducer, profile body) | none    | yes    | yes      |
| e2e `cv-publish.spec.ts`     | none    | yes    | no       |

Header: Test depth
Options:
A) api + unit + e2e (recommended)
B) api + unit only
State: approved
Actual answer: A) api + unit + e2e (D7, 2026-09-25)
Accepted scope: All test files listed under '3. Tests', including `tests/e2e/cv-publish.spec.ts`, plus the regression contract: profile-route.test.ts and mcp-operator-tools.test.ts:416,431 unmodified and green; hidePhoto round trip moved to the Cv path; /cv before migration renders the legacy block.
History: -

### D8: Size bounds

Finding: Perf-1 + OV-13, P2, 8/10, `src/lib/upload-limits.ts:3` `MAX_PROFILE_JSON_BYTES = 4 * 1024 * 1024`. Reviewer: plan-eng-review + outside voice (Claude subagent).
Plan baseline: MAX_CVS 20, body cap 4 MiB per CV (proposal).
Runtime evidence: a resume is ~10-20 KB; GET returns every CV.
Comparison grid:

| Choice              | Current | A Apply | B Keep | C Investigate | D Defer |
| ------------------- | ------- | ------- | ------ | ------------- | ------- |
| CV count cap        | none    | 20      | 20     | measure first | none    |
| PATCH/POST body cap | n/a     | 256 KB  | 4 MiB  | measure first | 4 MiB   |

Header: Size bounds
Options:
A) Apply 20 CVs / 256 KB (recommended)
B) Keep 20 CVs / 4 MiB
C) Investigate before choosing
D) Defer this change
State: approved
Actual answer: A) Apply 20 CVs / 256 KB (D8, 2026-09-25)
Accepted scope: `MAX_CVS = 20` (create beyond it: 409 `cap`, 'Delete a CV first'); `MAX_CV_JSON_BYTES = 256 * 1024` on POST/PATCH bodies (413); both in `src/lib/upload-limits.ts`; service + route tests.
History: -

### D9: Page-break auto-fit on selecting a CV

Finding: OV-7, P2, 8/10, `src/components/settings/useCvPageBreakFit.tsx:81` writes `pageBreak` into the draft; `CvTabSections.tsx:63-65` runs it on every mount. Reviewer: outside voice (Claude subagent).
Plan baseline: re-run `requestFit({ onlyIfClipped: true })` on switch; `dirty` unspecified.
Runtime evidence: saved CVs are fitted on every reorder, so clipped-on-open is rare (mainly the migrated legacy CV).
Comparison grid:

| Choice             | Current     | A Apply                                                                                           | B Keep                     | C Investigate | D Defer     |
| ------------------ | ----------- | ------------------------------------------------------------------------------------------------- | -------------------------- | ------------- | ----------- |
| dirty              | unspecified | deep compare vs saved snapshot                                                                    | flag on any setResume      | -             | unspecified |
| auto-fit on select | planned     | runs; if it changes the break, the CV shows "Page break re-fitted - Save CV to keep" and is dirty | runs, marks dirty silently | -             | as planned  |

Header: Auto-fit dirty
Options:
A) Apply snapshot dirty + notice (recommended)
B) Keep current plan
C) Investigate before choosing
D) Defer this change
State: approved
Actual answer: A) Apply snapshot dirty + notice (D9, 2026-09-25)
Accepted scope: `dirty` = deep difference between draft and last-saved snapshot; when the on-open auto-fit changes the page break, show 'Page break re-fitted - Save CV to keep it'; unit tests in cv-editor-state.
History: -

### D10: Delete/publish race and save revalidation

Finding: OV-9 / Arch-5, P2, 7/10. Reviewer: outside voice (Claude subagent).
Plan baseline: read published id, then `deleteOne({ _id })`; `saveCv` revalidates only when the saved CV is the published one.
Runtime evidence: n/a (new code).
Comparison grid:

| Choice            | Current           | A Apply                                                                                         | B Keep            | C Investigate | D Defer           |
| ----------------- | ----------------- | ----------------------------------------------------------------------------------------------- | ----------------- | ------------- | ----------------- |
| delete filter     | `{ _id }`         | `{ _id, $or: [{ publishedAt: null }, { publishedAt: { $lt: top.publishedAt } }] }`, miss -> 409 | `{ _id }`         | -             | `{ _id }`         |
| saveCv revalidate | only if published | always `{ expire: 0 }`                                                                          | only if published | -             | only if published |

Header: Race + revalidate
Options:
A) Apply conditional delete (recommended)
B) Keep current plan
C) Investigate before choosing
D) Defer this change
State: approved
Actual answer: A) Apply conditional delete (D10, 2026-09-25)
Accepted scope: `deleteOne` filtered to not-the-latest-published (miss with doc present: 409 `published`); `saveCv` always `revalidateTag(PUBLIC_PROFILE_CACHE_TAG, { expire: 0 })`; service tests for the race and the revalidate call.
History: -

### T1: TODO - remove the legacy `profile.resume` field

Finding: Legacy field kept by D5. Reviewer: plan-eng-review.
Plan baseline: not in scope.
Header: Legacy TODO
Options:
A) Add to TODOS.md (recommended)
B) Skip
C) Build it now
State: approved
Actual answer: A) Add to TODOS.md (T1, 2026-09-25)
Accepted scope: Add the 'remove legacy profile.resume' item to TODOS.md with trigger 'multi-CV live and Main CV migrated in prod'. No code in this change.
History: -

Approval readiness: PASS - S1 (D1), A1 (D2), P1 (D3), D4, D5, D6, D7, D8, D9, D10, T1, each approved by its own answer on 2026-09-25. Outside-voice corrections OV-1..6, OV-8, OV-10..12, OV-14 are necessary implementation of those approved decisions (recorded above); OV-7, OV-9 and OV-13 were decided as D9, D10 and D8.

## Failure modes

| New path         | Realistic production failure                                          | Covered by                                                                                      | User sees                                   |
| ---------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `ensureMigrated` | two first loads (strict-mode double effect) race before indexes build | fixed `_id` + catch 11000 + `CvModel.init()`; cv-service concurrency test without `syncIndexes` | one "Main CV", no error                     |
| `publishCv`      | publish bumps `updatedAt`, next Save CV 409s                          | `timestamps: false`; publish-then-save test                                                     | nothing (prevented)                         |
| `/cv` resolver   | cvs empty (never migrated)                                            | legacy fallback; existing MCP tests :416/:431                                                   | today's CV, unchanged                       |
| `/cv` freshness  | stale ISR after publish                                               | `revalidateTag(..., { expire: 0 })`; e2e full-load check                                        | new CV on the next full load                |
| `saveCv`         | two tabs save the same CV                                             | `updatedAt` guard -> 409 `stale`; route test                                                    | StaleSaveBanner with Reload / Overwrite     |
| `deleteCv`       | delete races a publish of the same CV                                 | conditional `deleteOne` (D10); service test                                                     | 409 "published" message                     |
| `createCv`       | 21st CV, or taken label                                               | 409 `cap` / `labelTaken`; service + route tests                                                 | inline dialog error                         |
| Save CV body     | draft cleared to empty                                                | `pruneResumeForCv` always returns a Resume; unit test                                           | empty CV saved as asked, not a silent no-op |
| CV photo upload  | upload finishes after switching CV                                    | picker locked during `uploading.cvPhoto`; unit test                                             | picker disabled until upload ends           |
| Profile save     | legacy `resume` still sent via `...profile` spread                    | explicit delete; unit test                                                                      | nothing (prevented)                         |

Critical gaps (no test AND no handling AND silent): none.

## Worktree parallelization strategy

| Step                                                                                                   | Modules touched                                                                                                           | Depends on          |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| A. Server: schema split, Cv model, cv-service, routes, read resolver, MCP read, limits                 | `src/models/`, `src/lib/cv/`, `src/lib/profile-*`, `src/app/api/admin/cvs/`, `src/app/(me)/cv/`, `tests/api/`             | -                   |
| B. CV card prop refactor (resume/setResume/avatar)                                                     | `src/components/settings/Resume*`, `src/components/settings/preview/`, `useCvPageBreakFit`                                | -                   |
| C. useCvEditor, cv-editor-state, CvPicker, CvLabelDialog, toolbar/floating split, profile-body cleanup | `src/components/settings/`, `src/app/(admin)/admin/settings/`, `src/components/blog-admin/StaleSaveBanner`, `tests/unit/` | A (API contract), B |
| D. e2e                                                                                                 | `tests/e2e/`                                                                                                              | A, C                |

Lane A: step A (server). Lane B: step B (client props). Launch A + B in parallel worktrees,
merge both, then C, then D. Conflict flag: B and C both touch `src/components/settings/`, so
C starts only after B merges.

## Implementation Tasks

Synthesized from this review's findings. Each task derives from a specific finding above.
Task ids are `IT*` so they do not collide with TODO `T1`.

- [ ] **IT1 (P1, human: ~2h / CC: ~10min)** - models - move `resumeSchema` to `src/models/resume-schema.ts`; add `src/models/Cv.ts` (required resume, `labelKey` unique, `{ publishedAt: -1, _id: -1 }`, timestamps, `LEGACY_CV_ID`); `MAX_CVS`, `MAX_CV_JSON_BYTES` in `upload-limits.ts`
  - Surfaced by: A1, D6, D8, OV-2, OV-8
  - Files: `src/models/Profile.ts`, `src/models/resume-schema.ts`, `src/models/Cv.ts`, `src/lib/upload-limits.ts`
  - Verify: `bun run typecheck`; `bunx vitest run tests/api/cv-indexes.test.ts`
- [ ] **IT2 (P1, human: ~1 day / CC: ~20min)** - cv-service - `findPublished`, `ensureMigrated`, `listCvs`, `createCv`, `saveCv`, `publishCv`, `deleteCv` exactly as in "Service", with header diagram
  - Surfaced by: Arch-1..5, P1, D5, D6, D8, D10, OV-1, OV-2, OV-3
  - Files: `src/lib/cv/cv-service.ts`, `tests/api/cv-service.test.ts`, `tests/api/cv-indexes.test.ts`
  - Verify: `bunx vitest run tests/api/cv-service.test.ts tests/api/cv-indexes.test.ts`
- [ ] **IT3 (P1, human: ~4h / CC: ~15min)** - routes - `/api/admin/cvs` GET/POST, `/[id]` PATCH/DELETE, `/[id]/publish` POST with `requireOwner`, `readJsonBody` (256 KB), awaited params, ObjectId 404
  - Surfaced by: Security note, D8, OV-5 (`base: '*'`), OV-14
  - Files: `src/app/api/admin/cvs/route.ts`, `src/app/api/admin/cvs/[id]/route.ts`, `src/app/api/admin/cvs/[id]/publish/route.ts`, `tests/api/cv-routes.test.ts`
  - Verify: `bunx vitest run tests/api/cv-routes.test.ts`
- [ ] **IT4 (P1, human: ~3h / CC: ~10min)** - read paths - `loadPublishedResume` (replaces `loadPublicResume`), `/cv` page, `readProfileSection('resume')`, MCP descriptions; update the three header comments
  - Surfaced by: Arch-2, Arch-3, OV-3, OV-10, OV-12
  - Files: `src/lib/profile-data.ts`, `src/app/(me)/cv/page.tsx`, `src/lib/profile-sections.ts`, `src/lib/mcp/tools/me.ts`, `tests/api/mcp-operator-tools.test.ts`, `tests/api/resume-hide-photo.test.ts`
  - Verify: `bun run test:api`
- [ ] **IT5 (P1, human: ~4h / CC: ~15min)** - CV cards - `CvSectionProps` to `resume`/`setResume`/`avatar`; remove `resumeOf`/`updateResume`; narrow `useCvPageBreakFit`, `CvTabPreview`, `PreviewRail`
  - Surfaced by: S1, CQ-3
  - Files: `src/components/settings/types.ts`, `resume-utils.ts`, `Resume*Section.tsx` (6), `useCvPageBreakFit.tsx`, `CvTabSections.tsx`, `preview/CvTabPreview.tsx`, `preview/PreviewRail.tsx`
  - Verify: `bun run typecheck && bun run lint`
- [ ] **IT6 (P1, human: ~1 day / CC: ~25min)** - editor - `cv-editor-state.ts` (pure), `useCvEditor` in `SettingEditor`, `CvPicker`, `CvLabelDialog`, discard/delete `ConfirmDialog`s, upload lock, auto-fit notice, CV stale banner (Reload/Overwrite), loading/error states
  - Surfaced by: R4, D4, D9, OV-4, OV-5, OV-6, CQ-5
  - Files: `src/components/settings/cv-editor-state.ts`, `useCvEditor.ts`, `CvPicker.tsx`, `CvLabelDialog.tsx`, `src/app/(admin)/admin/settings/page.tsx`, `src/components/blog-admin/StaleSaveBanner.tsx`, `tests/unit/cv-editor-state.test.ts`
  - Verify: `bunx vitest run tests/unit/cv-editor-state.test.ts`; manual walk in `bun run dev`
- [ ] **IT7 (P1, human: ~2h / CC: ~10min)** - save buttons + profile body - Save CV / disabled Save profile in `SettingToolbar`, `FloatingSaveButton` follows the primary; `cleanProfileForSave` deletes `resume`; `pruneResumeForCv`; `SettingEditor` stops seeding `resume`
  - Surfaced by: R5, CQ-1, CQ-2, OV-8, OV-14
  - Files: `src/components/settings/SettingToolbar.tsx`, `FloatingSaveButton.tsx`, `cleanProfileForSave.ts`, `src/app/(admin)/admin/settings/page.tsx`, `tests/unit/clean-profile-for-save.test.ts`
  - Verify: `bunx vitest run tests/unit/clean-profile-for-save.test.ts tests/api/profile-route.test.ts`
- [ ] **IT8 (P2, human: ~3h / CC: ~10min)** - e2e - `tests/e2e/cv-publish.spec.ts` with pre-load, per-run label, cleanup
  - Surfaced by: D7, OV-11
  - Files: `tests/e2e/cv-publish.spec.ts`
  - Verify: `bun run test:e2e:local -- tests/e2e/cv-publish.spec.ts`
- [ ] **IT9 (P2, human: ~15min / CC: ~2min)** - final gate - `bun run format:check && bun run lint && bun run typecheck && bun run test && bun run build`
  - Surfaced by: testing-quality rules
  - Files: -
  - Verify: all green

Effort ratios assumed: features ~30x, tests ~50x, scaffolding ~100x.

## Unresolved decisions

None. Every choice in this review has an answer (D1-D10, T1).

## Completion summary

- Step 0: Scope Challenge - scope accepted as-is (Original arrangement, D1)
- Architecture Review: 5 issues found
- Code Quality Review: 5 issues found
- Test Review: diagram produced, 28 gaps identified (all new paths) + 1 critical regression (CQ-1)
- Performance Review: 2 issues found
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 1 item proposed to user (T1, added)
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review
- Outside voice: codex model_unusable; fresh-context Claude Plan subagent completed (same harness, not outside coverage), 14 findings, all resolved (11 corrections, 3 decisions)
- Parallelization: 2 lanes, 2 parallel / 2 sequential
- Lake Score: 1/1 (D7 chose the complete option; other choices differ in kind)

## Suppressed findings

- (4/10) The client router cache could serve a prefetched `/cv` after publish in the same
  browser session (OV-12). Not reproduced; the plan promises full-load freshness only.

## GSTACK REVIEW REPORT

| Review         | Trigger                                                 | Why                             | Runs | Status                                   | Findings                   |
| -------------- | ------------------------------------------------------- | ------------------------------- | ---- | ---------------------------------------- | -------------------------- |
| CEO Review     | `/plan-ceo-review`                                      | Scope & strategy                | 0    | -                                        | -                          |
| Outside Review | codex (model_unusable) -> Claude Plan subagent fallback | Independent 2nd opinion         | 2    | unavailable (in-host fallback completed) | 14 findings, all resolved  |
| Eng Review     | `/plan-eng-review`                                      | Architecture & tests (required) | 2    | issues_open                              | 40 issues, 0 critical gaps |
| Design Review  | `/plan-design-review`                                   | UI/UX gaps                      | 0    | -                                        | -                          |
| DX Review      | `/plan-devex-review`                                    | Developer experience gaps       | 0    | -                                        | -                          |

- **OUTSIDE COVERAGE:** codex, plan-review phase, unavailable (the gstack default model is not supported on this ChatGPT-account Codex login). A native Claude Plan subagent completed instead; it is not outside-model coverage.
- **VERDICT:** No review CLEAR for this plan: Eng Review is issues_open because it mapped 40 issues into approved work (IT1-IT9), not because anything is undecided. eng review required.

NO UNRESOLVED DECISIONS
