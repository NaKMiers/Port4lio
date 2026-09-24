# Port4lio - agent instructions

Root entry point for **Codex** (`AGENTS.md`) and **Claude Code** (`CLAUDE.md`,
which is just `@AGENTS.md`), so the two never drift.

## Project rules

These rules are my house style, distilled from my prior projects (DeewasExpo is
the newest and strongest signal, then Deewas web, then AnphaShop guardrails).
When rules conflict, prefer: (1) intentional repo-local code already here,
(2) the newer convention.

Consult the focused rule file under `.agents/rules/` before changing the
matching area:

- `.agents/rules/project-style.md` - universal TypeScript, naming, formatting,
  file organization, comments, and dependency preferences.
- `.agents/rules/nextjs-app-router.md` - App Router pages, layouts, metadata,
  routing, caching, and server/client component boundaries.
- `.agents/rules/api-security.md` - route handlers, auth, admin routes, secrets,
  validation, email, uploads, AI calls, and external services.
- `.agents/rules/data-and-state.md` - persistence, models, request helpers,
  client stores, local storage, and sync rules.
- `.agents/rules/frontend-ui.md` - components, Tailwind/CSS tokens, responsive
  behavior, copy, icons, loading states, and UI polish.
- `.agents/rules/testing-quality.md` - formatting, test placement, verification
  commands, lint/build expectations, and quality bars.

Where this repo deliberately departs from those rules, see
[Deviations from house style](#deviations-from-house-style) below.

## Dual-tool layout (Codex + Claude - one source of truth)

This project is shared by **Codex** and **Claude Code** with zero duplication.
Everything agent-facing is canonical under `.agents/` and both tools read it:

- `.agents/rules/` - the coding/operating rules above (read the focused file).
- `.agents/_shared/` - durable project memory + reusable systems + assets (optional).
- `.agents/skills/<name>/` - canonical project skills: `SKILL.md` +
  `references/memory.md` (self-improving, single copy) + `agents/openai.yaml`.
- `.claude/skills/<name>/SKILL.md` - thin **delegating wrappers** for Claude
  discovery only; they point back to the canonical `.agents/skills/<name>/SKILL.md`,
  which always wins. (Wrappers, not symlinks, so the repo is git/Windows-safe.)

Edit skill logic and memory **only** under `.agents/skills/`. After
adding/editing/removing a skill, run the **skill-sync** skill to regenerate the
Claude wrappers + Codex metadata. See `.claude/README.md` for the full model.

## Skill routing

When the user's request matches an available skill, invoke that skill first
instead of answering ad hoc or reaching for unrelated tools. Prefer the
project's gstack skills for the workflows they cover.

- Sync Codex ↔ Claude skill config -> use `skill-sync` (manual only)

Key routing rules:

- Product ideas, "is this worth building", brainstorming -> use `/office-hours`
- Bugs, errors, "why is this broken", 500 errors -> use `/investigate`
- Ship, deploy, push, create PR -> use `/ship`
- QA, test the site, find bugs -> use `/qa`
- Code review, check my diff -> use `/review`
- Update docs after shipping -> use `/document-release`
- Weekly retro -> use `/retro`
- Design system, brand -> use `/design-consultation`
- Visual audit, design polish -> use `/design-review`
- Architecture review -> use `/plan-eng-review`
- Save progress, checkpoint, resume -> use `/context-save` / `/context-restore`
- Code quality, health check -> use `/health`

## Web browsing

Use the `/browse` skill from gstack for web browsing tasks in this repository.
Do not use `mcp__claude-in-chrome__*` tools.

---

# Commands

Bun is the package manager (`bun.lock` is committed; `package-lock.json` is
gitignored).

```bash
bun run dev            # next dev (port 3000)
bun run build          # next build
bun run typecheck      # tsc --noEmit
bun run lint           # eslint
bun run lint:fix       # eslint . --fix
bun run format         # prettier . --write
bun run format:check   # prettier . --check
bun run test           # vitest run - tests/unit + tests/api
bun run test:unit      # vitest run tests/unit
bun run test:api       # vitest run tests/api (boots mongodb-memory-server)
bun run test:watch     # vitest
bun run test:e2e       # playwright - builds and starts a prod server on :3100
```

Run a single test file or a single case:

```bash
bunx vitest run tests/unit/blog-markdown.test.ts
bunx vitest run tests/unit/blog-markdown.test.ts -t "drops raw HTML"
bunx playwright test tests/e2e/blog-publish.spec.ts
```

Notes on the test setup, because each of these fails confusingly otherwise:

- `tests/e2e` **refuses to run against a non-disposable database** (see
  `tests/e2e/global-setup.ts`). Use `bun run test:e2e:local`, which points
  `MONGODB_URI` at a throwaway local DB. The suite soft-deletes posts, and a soft
  delete holds its slug forever, so every run permanently consumes slugs in
  whatever database it finds.
- e2e runs `next build && next start`, never `next dev`, on purpose: ISR and
  `revalidatePath` do not behave like production under the dev server, so the
  falsification tests would falsify nothing. First run needs
  `bun run test:e2e:install`.
- `PLAYWRIGHT_USE_EXISTING_SERVER=1` skips the build and targets whatever is on :3100.
- Vitest aliases `server-only` to `tests/stubs/server-only.ts`; without it the blog
  pipeline cannot be imported by a test at all.
- Node 22 is pinned via `engines`.
- Never run `clean` unless explicitly asked.

# Architecture

Next.js 16 App Router, React 19, TypeScript, Tailwind v3, Mongoose/MongoDB.
`@/*` maps to `src/*` and is the only import alias. One deployment hosts four
fairly independent products, split by route group:

| Group          | Routes                                   | What it is                                                            |
| -------------- | ---------------------------------------- | --------------------------------------------------------------------- |
| `(me)`         | `/`                                      | The portfolio. English only, rendered from one Mongo profile document |
| `(blog)`       | `/blog`, `/blog/<slug>`, `/blog/rss.xml` | The blog. Own chrome, own CSP                                         |
| `(choice)`     | `/[lang]/mbti/*`, `/[lang]/iq/*`         | Bilingual (vi/en) paid test products                                  |
| `(admin)`      | `/admin/*`                               | Owner-only surfaces: blog editor, settings, metrics, CCA-F            |
| `(whiteboard)` | `/whiteboard/<slug\|id>`                 | A whiteboard the owner shared by link (view or edit), no owner gate   |

`src/proxy.ts` (Next 16's renamed middleware) 307s bare `/mbti` and `/iq` to a
locale-prefixed URL. Its `matcher` is a deliberate allowlist of static literals;
`tests/unit/proxy-matcher.test.ts` asserts it stays in step with `TEST_PRODUCTS`
in `src/lib/test-kit/nav.ts`.

## Layering

Route handlers and pages stay thin. The real logic lives in `src/lib/<domain>/`,
which is where to look first:

- `src/lib/blog/` - markdown pipeline, post/kind/series data access, SEO, events, revalidation
- `src/lib/iq/`, `src/lib/mbti/` - item banks, scoring, pricing, result emails
- `src/lib/ccaf/` - a private study tracker under `/admin/certificates/ccaf`; `/admin/certificates` is the overview of all certificates
- `src/lib/test-kit/` - shared shell for the two test products (nav, payment copy, effort rules)
- `src/lib/mcp/` - the site MCP: tokens, `runTool`, the tool registry (`tools/*`), prompts, audit
- `src/models/` - Mongoose schemas

## Cross-cutting pieces to reuse rather than re-derive

- **Owner auth**: OTP emailed to the owner, HMAC-signed cookie (`src/lib/auth.ts`).
  Every owner-only handler starts with
  `const denied = requireOwner(request); if (denied) return denied`
  (`src/lib/require-owner.ts`). `REQUIRE_ADMIN=false` bypasses the gate locally and
  is ignored in production by `src/lib/admin-gate.ts` - do not add another env
  escape hatch.
- **Models**: prefer `compileModel(name, schema)` from `src/lib/mongoose-model.ts`
  over `mongoose.models.X ?? mongoose.model(...)`. The plain guard caches across
  dev HMR, so a newly added schema field is silently dropped from every write while
  the request still returns 200. (Half the models predate the helper - see
  Deviations.)
- **API shape**: `jsonError(message, status)` from `src/lib/api-response.ts` for
  every error; `readJsonBody` from `src/lib/read-json-body.ts` for every body
  (bounded, never throws, 400 on malformed JSON); `checkRateLimit` from
  `src/lib/rate-limit.ts` for public write endpoints.
- **Required env**: `getRequiredEnv('NAME')`, so a missing var fails loudly at the
  call site. Secrets never go in `NEXT_PUBLIC_*`.
- **Public profile**: `PUBLIC_PROFILE_FIELDS` in `src/lib/profile-public.ts` is an
  **allowlist** applied as a Mongo projection. Every profile field not listed there
  is private by default, and adding a field to it is the one reviewable act that
  makes it public. Never add contact details or anything from `resume`. Renderers
  take `PublicProfile`, not `Profile`.
- **Class names**: `cn()` from `src/lib/utils.ts` (`twMerge(clsx(...))`). Every
  reusable component takes `className?: string` and merges it with `cn()`.
- **Site MCP**: `/api/mcp` is the one agent front door. It takes scoped `p4_`
  tokens (`read`, `write`, `publish`, `pii`), which are created and revoked in
  `/admin/agents` and verified by `guardAgent` (`src/lib/mcp/token.ts`). It
  never uses the owner cookie, and `REQUIRE_ADMIN` does not affect it.
  - Every tool is a registry entry run through `runTool`
    (`src/lib/mcp/run-tool.ts`). That handles the scope recheck, zod
    validation, the `clientRef` replay, the per-token cost bucket, the response
    budget and the `AgentAction` audit row, so a new tool gets none of these by
    hand.
  - `/api/whiteboard/mcp` is a legacy alias for `wbt_` tokens and is due for
    removal (mcp-plan.md T11).
- **One service per write**: a route handler and an MCP tool that change the same
  data call the same function in `src/lib/<domain>/*-service.ts`. Examples are
  `blog/post-service.ts`, `blog/taxonomy-service.ts`, `profile-service.ts` and
  `ccaf/progress-service.ts`. Never re-implement a write inside a tool.
  Revalidation (`revalidatePublishedPost`, `revalidatePath('/blog')`,
  `revalidateTag`) lives **inside** the service after the write succeeds. A
  second front door that forgot it would still return 200, and the live page
  would stay stale until the ISR window runs out.

## Blog specifics

Markdown is converted to HTML **once, at save time**, never per request
(`src/lib/blog/markdown.ts`). The pipeline order - parse, drop raw HTML at
remark-rehype, `rehype-sanitize`, restrict image hosts, then Shiki - is
load-bearing: highlighting before sanitizing strips every colour Shiki computes.
That pipeline, not the CSP, is the XSS control here.

Freshness is route-segment ISR plus `revalidatePublishedPost(slug)` from every
mutating handler (PATCH and DELETE included, not just publish). Use the
**literal** path form; on this Next version
`revalidatePath('/blog/[blog-slug]', 'page')` was measured as a complete no-op
that fails silently. Do not add `unstable_cache` under the blog read path - one
cache, one invalidation.

Posts have four states (`draft`, `published`, `archived`, `deleted`); public
reads filter on `status: 'published'` only, and delete is soft so a slug can
never be reused. See the header comment in `src/models/Post.ts`. Authoring
guidance lives in `docs/blog/authoring.md`.

## Payments

PayOS, with a webhook and a polling fallback that both funnel into one atomic
`!= paid -> paid` claim in `src/lib/payos-fulfil.ts`. Never split that into
read-then-write. Attempt/payment documents carry `expireAt` with a TTL index
(`expireAfterSeconds: 0`), which is what backs the retention promise on the
public privacy pages - `tests/api/retention.test.ts` verifies the indexes are
actually built against a real mongod.

# Conventions

## Comments explain why, at the point of decision

This codebase's most distinctive habit: non-obvious modules open with a doc
comment carrying an ASCII flow diagram and the reasoning - including the version
that was tried and failed, and what its failure looked like. See
`src/lib/require-owner.ts`, `src/lib/blog/revalidate.ts`, `next.config.js`. When
changing one of these, update its comment; when adding a module with a subtle
invariant, write one. Do not strip an existing "this looks wrong but isn't"
comment.

## UI: dropdowns use `SelectField`, not a native `<select>`

For any new single-choice dropdown, use `SelectField`
(`src/components/settings/SelectField.tsx`) instead of a bare `<select>`. It
renders the same styled, keyboard-navigable listbox as the blog editor's
Kind/Series fields and the "Generate blog" dialog's select fields - see its own
doc comment for the keyboard contract and why the native element isn't just
re-styled.

Exception: a long or dynamic option list (a country list, a year picker, dozens
of entries) on a public, mobile-heavy page. `SelectField` gives up the native
mobile wheel/sheet picker and some built-in keyboard behavior, which is a bad
trade at that size - keep the native `<select>` there. Nothing in the app
currently fits that exception; check before assuming a new field does.

## Prose

Hyphens, not em dashes, in comments and UI copy. Icons (lucide) rather than arrow
glyphs in UI text; ASCII arrows inside code-comment diagrams are fine.

# Deviations from house style

Intentional repo-local code wins over the generic rules. These are the live
exceptions - do not "fix" them without a reason:

- **Tailwind v3 with `tailwind.config.ts`**, not v4 CSS-first. The config carries
  a custom `ppColor()` resolver so `pp-*` CSS-variable tokens survive opacity
  modifiers (`bg-pp-blue/10`); a naive v4 port silently drops ~40 such utilities.
  Tokens are `pp-*` + `primary/secondary/accent`, not the `background/primary/
dark-primary/...` set from the house tokens.
- **Tests live in a top-level `tests/` tree** (`tests/unit`, `tests/api`,
  `tests/e2e`, `tests/stubs`), not co-located `*.test.ts`. The split exists because
  `tests/api` boots a real in-memory mongod and `tests/e2e` needs a production
  build; the repo's own `vitest.config.ts` and `playwright.config.ts` encode that
  and carry long rationale comments.
- **Model compilation is mixed**: 7 models use `compileModel`, 8 still use the raw
  `mongoose.models.X ?? mongoose.model(...)` guard. New models should use
  `compileModel`; converting the rest is an open cleanup, not a drive-by.
- `README.md` describes a Next 14 pages-router app with tsParticles and Swiper.
  That is not this codebase - treat it as historical and prefer the source.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

<!-- END:nextjs-agent-rules -->
