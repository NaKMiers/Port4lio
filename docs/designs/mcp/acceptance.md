# MCP acceptance - scripted checks

The manual, scripted check for each scene of the site-wide MCP (`mcp.md` "Problem Statement", "Success Criteria"). Each row is one line from `first-week-asks.md`, typed verbatim into a fresh Claude Code session connected to `/api/mcp`, with the observable result it must produce.

Automated tool behaviour is covered by `tests/api` and `tests/e2e`. This file covers what those cannot: that a natural-language ask ends in the right tool calls and the right visible result.

## Setup, per run

1. `bun run dev` (or a deployed preview).
2. In `/admin/agents`, create one token per scope set below. The plaintext is shown once.
3. `export PORT4LIO_MCP_TOKEN=p4_...` in the shell, then once:

   ```bash
   claude mcp add --scope user --transport http port4lio http://localhost:3000/api/mcp \
     --header 'Authorization: Bearer ${PORT4LIO_MCP_TOKEN}'
   ```

4. Start a fresh `claude` session per scene. Swap the token between scenes by changing the env var.

| Scene                     | Token scopes                                 |
| ------------------------- | -------------------------------------------- |
| 1. Idea to published post | read, write, publish                         |
| 2. Weekly briefing        | read                                         |
| 3. Me as context          | read                                         |
| 4. Site operator          | read, write, publish (plus `pii` for ask 10) |

After each run, open `/admin/agents` and check the AgentAction feed: one row per write-tool call and per `find_order`, refusals included.

## The asks

### 1. Write a post

> Write a post about what I learned shipping the whiteboard, in my voice, with a cover image and inline images, and leave it as a draft.

- **Scene:** 1 (idea to published post). Phase 2.
- **Tools:** `get_me` (voice context, recent posts), `whiteboard_overview` / `whiteboard_search` / `whiteboard_get_item` (the shipping notes), `get_writing_brief` or the `write-post` prompt, `list_taxonomy` (kind and series), `lint_draft`, `create_draft`, `generate_image` (cover, attach mode), `illustrate_post`, `get_post` (poll).
- **Observable result:**
  - A new post in `/admin/blog` with status `draft`, a cover image, and every inline image placeholder filled (`get_post` shows `illustration.state: idle`, `remaining: 0`, no unresolved placeholders).
  - The body cites real whiteboard cards, not invented ones.
  - `lint_draft` was called before `create_draft`, and its findings were fixed or explained.
  - `/blog/<slug>` answers 404. The post is not in `/blog` or `/blog/rss.xml`.
  - The feed shows `create_draft`, `generate_image` and `illustrate_post` rows, all `ok`.

### 2. Publish that draft

> Publish that draft.

- **Scene:** 1. Phase 2.
- **Tools:** `list_posts` or `get_post` (find the draft from ask 1), `publish_post`.
- **Observable result:**
  - The post's status is `published` with a `publishedAt`.
  - `/blog/<slug>` answers 200 on the first load after the call, with the current title and images (no stale ISR shell).
  - The post appears in `/blog` and `/blog/rss.xml`.
  - With a token WITHOUT `publish`: `publish_post` is not in the tool list, the agent says it cannot publish, and nothing changes.

### 3. Weekly briefing

> How did this week go? Blog views, top posts, new subscribers, MBTI/IQ sales, revenue and conversion, compared with last week.

- **Scene:** 2 (weekly briefing). Phase 3.
- **Tools:** `get_briefing` (period `week`), or the `weekly-briefing` prompt.
- **Observable result:**
  - Every figure is given for this week and the previous week: blog views and shares, top posts (at most 10), new subscribers and unsubscribes, paid MBTI and IQ orders, revenue, and conversion (paid divided by paywall-seen).
  - The numbers match `/admin/metrics` and the blog board for the same window.
  - No customer email or certificate name appears anywhere in the answer.
  - Asked again for a month: the test funnel and conversion section is left out with a one-line reason (the 21-day attempt TTL), never computed over expired data.

### 4. Load who I am

> Load who I am: my profile, CV, active goals and dreams, and my recent posts.

- **Scene:** 3 (me as context). Phase 2.
- **Tools:** `get_me` (one call). `get_profile` only for a section the agent needs in full.
- **Observable result:**
  - One `get_me` call returns the public profile summary, the CV (resume, including the owner's own contact details), the active goals and dreams from visible whiteboard cards (titles only), and the 5 most recent posts (titles only).
  - Nothing from a hidden whiteboard frame or item appears.

### 5. Tailor my CV

> Tailor my CV for this job posting: <paste the posting>.

- **Scene:** 3. Phase 4 (the `tailor-cv` prompt).
- **Tools:** `get_me`, then `get_profile` section `resume` if needed. The `tailor-cv` prompt.
- **Observable result:**
  - A tailored CV comes back as markdown in the chat.
  - The stored profile and `/cv` are unchanged (R8). No `update_profile` call is made, and with a read-only token it is not even in the tool list.

### 6. Fix a typo in the headline

> Fix the typo in my profile headline.

- **Scene:** 4 (site operator). Phase 4.
- **Tools:** `get_profile` (the section holding the headline, `about` for `profileHeading` or `identity` for `jobTitle`), then `update_profile` with that section's `version`.
- **Observable result:**
  - Only the typo changes; every other field in the section is byte-identical.
  - `/` shows the fix on the next load (the profile cache tag is revalidated).
  - A stale `version` (edit the section in `/admin/settings` between the read and the write) is refused, and the agent re-reads and retries.
  - The feed shows one `update_profile` row.

### 7. Archive old, unread posts

> Archive posts published over a year ago that had no views in the last 180 days.

- **Scene:** 4. Phase 4.
- **Tools:** `list_posts` (status `published`, a `publishedAt` range ending one year ago, sorted by views, 180-day metrics per row), then `archive_post` for each match.
- **Observable result:**
  - The agent states that "no views" means no views in the last 180 days (the PostEvent window).
  - Exactly the matching posts go to `archived`; each `/blog/<slug>` answers 404 on the next load and drops out of `/blog` and the feed.
  - Posts with any view in the window, or published less than a year ago, are untouched.
  - The feed shows one `archive_post` row per archived post.

### 8. Save an idea as a goal on the whiteboard

> Save this idea as a goal on my whiteboard, and link it to my "Career 2027" card.

- **Scene:** 4. Phase 4.
- **Tools:** `whiteboard_search` (find "Career 2027"), `whiteboard_add_item` (meaning `goal`), `whiteboard_link`.
- **Observable result:**
  - A new card with meaning `goal`, the tag `agent`, and `includeInAi` on, on a board the agent can see.
  - A labelled link from the new card to "Career 2027".
  - Both appear on the board's next load (no live refresh).
  - If "Career 2027" sits in a hidden frame, the agent cannot find it and says so; nothing is created on a hidden board or frame.

### 9. Log a CCA-F mock score

> Log my CCA-F mock exam score of 720 and tell me how ready I am.

- **Scene:** 4. Phase 4.
- **Tools:** `ccaf_update` (log a mock), `ccaf_status`.
- **Observable result:**
  - One new mock row in `/admin/certificates/ccaf` dated today.
  - The answer reports progress, readiness, the estimated scaled score, days to the exam and the weakest domains.
  - The tracker stores a mock as correct answers out of 60, so `ccaf_update` takes `correct` only (decision D3 below). Given "720", the agent asks how many answers were right, then logs that count; `ccaf_status` reports the estimated scaled score back.

### 10. Check an order

> Check order <order code>: is it paid, and did the customer get their result email?

- **Scene:** 4 (support lookup). Phase 3.
- **Tools:** `find_order` (scope `pii`).
- **Observable result:**
  - Product, amount, status, created and paid dates for that one order.
  - Never the buyer's email or the certificate name.
  - A token without `pii` does not list `find_order`, and calling it by name is refused with a `refused` row in the feed.
  - Whether the result email went out, from the new `resultEmailedAt` on the payment (decision D2 below). An order paid before that field existed reports "not recorded".

## Tool coverage

Which asks need which registry tool (the 27-tool starting registry in `mcp.md`). Prompts are listed at the end. The four tools marked **cut** were removed from the registry by decision D1 below.

| Tool                     | Scope   | Needed by asks                     |
| ------------------------ | ------- | ---------------------------------- |
| `get_me`                 | read    | 1, 4, 5                            |
| `get_profile`            | read    | 5, 6                               |
| `update_profile`         | publish | 6                                  |
| `list_posts`             | read    | 2, 7                               |
| `get_post`               | read    | 1, 2                               |
| `list_taxonomy`          | read    | 1                                  |
| `get_writing_brief`      | read    | 1 (in clients without MCP prompts) |
| `lint_draft`             | read    | 1                                  |
| `create_draft`           | write   | 1                                  |
| `update_post`            | write*  | **none**                           |
| `generate_image`         | write*  | 1                                  |
| `illustrate_post`        | write*  | 1                                  |
| `publish_post`           | publish | 2                                  |
| `archive_post`           | publish | 7                                  |
| `delete_post`            | publish | **none - cut**                     |
| `save_taxonomy`          | publish | **none - cut**                     |
| `get_briefing`           | read    | 3                                  |
| `get_test_metrics`       | read    | **none - cut**                     |
| `find_order`             | pii     | 10                                 |
| `whiteboard_overview`    | read    | 1                                  |
| `whiteboard_search`      | read    | 1, 8                               |
| `whiteboard_get_item`    | read    | 1                                  |
| `whiteboard_add_item`    | write   | 8                                  |
| `whiteboard_update_item` | write   | **none - cut**                     |
| `whiteboard_link`        | write   | 8                                  |
| `ccaf_status`            | read    | 9                                  |
| `ccaf_update`            | write   | 9                                  |
| prompt `write-post`      | read    | 1                                  |
| prompt `weekly-briefing` | read    | 3                                  |
| prompt `tailor-cv`       | read    | 5                                  |

## Registry cuts

No ask needs these five tools. Per the Assignment, each was a candidate to cut from the registry before phase 2. The owner accepted the recommendations (D1): four are cut, `update_post` stays. The registry is 23 tools, and a `read`-only token sees 12.

| Tool                     | What cutting it costs                                                                                                                                                                                                                                                    | Recommendation                                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `update_post`            | R6 (find/replace edits), R7 (no placeholders on live posts) and the R9 e2e check ("the editor banner after an MCP `update_post`") are all built on it. Without it an agent cannot fix a typo in a post, or add an image to a live post (R7's generate-then-insert path). | **Keep.** It is the only way to act on a lint finding after `create_draft`, and three approved decisions depend on it.             |
| `delete_post`            | Soft delete only. The owner still deletes from `/admin/blog`.                                                                                                                                                                                                            | **Cut.** Destructive, no ask needs it, and `archive_post` already takes a post off the site.                                       |
| `save_taxonomy`          | The agent can only file posts under existing kinds and series. C8's `revalidatePath('/blog')` still moves into `taxonomy-service`, which the admin routes use.                                                                                                           | **Cut the tool, keep the service extraction.** The service still gets its revalidation and its e2e check through the admin routes. |
| `get_test_metrics`       | No type distribution, IQ score bands or abandonment detail over MCP. `get_briefing` still carries the funnel and conversion for ask 3. `metrics/tests.ts` is still extracted for the admin metrics route.                                                                | **Cut the tool, keep the extraction.**                                                                                             |
| `whiteboard_update_item` | The agent can add and link cards but not change a card's status or body.                                                                                                                                                                                                 | **Cut.** No ask needs it, and it is the one whiteboard write that can change an owner-written card.                                |

## Owner decisions (2026-09-24)

- **D1 (cuts).** Cut `delete_post`, `save_taxonomy`, `get_test_metrics` and `whiteboard_update_item` from the MCP registry; keep `update_post`. The service extractions behind the cut tools (`taxonomy-service`, `metrics/tests.ts`, the soft delete in `post-service`) still happen, because the admin routes use them.
- **D2 (ask 10).** `Payment` and `IqPayment` gain a nullable `resultEmailedAt`, set after a successful `deliver()` in `fulfilMbtiPayment` and `fulfilIqPayment` (outside the atomic claim). `find_order` reports it; orders paid before the field existed report "not recorded".
- **D3 (ask 9).** `ccaf_update` logs a mock as `correct` (0-60) only, exactly as the tracker stores it. Its description tells the agent to ask for the raw count when it is given a scaled score. No conversion is invented.
- **D4 (legacy tokens).** `POST /api/admin/whiteboard/tokens` keeps working until T11, so `whiteboard-agent.test.ts` passes with only its import paths changed. The whiteboard Agents popover becomes a link to `/admin/agents`, so nothing in the UI creates a `wbt_` token any more.
- **D5 (image prompts).** `create_draft` and `update_post` accept `coverImagePrompt` and `imagePrompts: [{ key, prompt }]`, the fields the admin PATCH already takes. The agent writes one prompt per `![alt](imageN)` placeholder; `illustrate_post` draws from them. No server-side prompt writing.
- **D6 (pre-existing failures).** `tests/api/blog-cron-route.test.ts` (3 cases, the `BLOG_CRON_LIMIT` 1-vs-10 mismatch tracked in TODOS) and `tests/api/blog-post-data.test.ts` (1 case, `createdAt` in the public listing projection) already fail on main. They are left untouched; a phase that must keep them green is gated on "exactly these four fail, nothing else".
- **D7 (profile freshness, recorded at /review 2026-09-24).** `update_profile` (`patchProfileSection`) invalidates with `revalidateTag(PUBLIC_PROFILE_CACHE_TAG, { expire: 0 })`, not the `'max'` the design names: ask 6 showed `'max'` serving the typo once more on the next load (fixed in `0b7ed5f`). `POST /api/profile` (`replaceProfile`) keeps `'max'`, as `tests/api/profile-route.test.ts` pins (R10).
- **D8 (a publishing run locks agents out, /review 2026-09-24).** The cron's post is `archived` while it illustrates, so the live-post rule did not cover it, and the R3 patch saves keep edits made meanwhile, so the cron's final publish would have put a `write` token's text on the live site. A run claimed with `publishing: true` (the cron only) now refuses `update_post` and `generate_image` attach until its lease ends; `illustrate_post` runs never set it, so R3's "an update_post during a run survives" still holds. The owner's editor is not refused. See the `illustrate-run.ts` header.
- **D9 (CCA-F writes, /review 2026-09-24).** `ccaf_update` writes only if the document's `updatedAt` is still what it read, and re-reads on a lost race (it also no longer reads through `loadCcafState`, which answers a database blip with the empty plan). Still open, and the owner's call: a tracker tab opened before an agent write and saved later replaces the whole state, as the `PUT /api/ccaf` contract says.
- **D10 (the /review follow-ups, 2026-09-24).** Behaviour the fixes added, beyond what the plan names:
  - `/api/mcp` and the alias answer a JSON-RPC batch (an array body) with 400 / -32600, so no call can skip the R1 audit or share one front-door count.
  - `generate_image` (attach) and the illustrate run re-check the live-post rule at every save; a token without `publish` never writes into a post that went live mid-draw.
  - The illustration lease is fenced on its claim's `startedAt`; its bookkeeping writes no longer move `updatedAt`; `lastError` keeps every failure of a run and the URL of an image it drew but could not save; revoking a token stops its run at the next image.
  - `generate_image` and `ccaf_update` spend their cost units only after their cheap checks pass.
  - The admin PATCH with `baseUpdatedAt`, `publish_post` and the cron's publish write conditionally on the `updatedAt` they checked. The editor adopts a prompt rewrite's `updatedAt` only when the route read the editor's own base, and "Overwrite anyway" resends the status that was pressed.
  - `POST /api/profile` accepts an optional `x-profile-base-updated-at` header (the settings page sends it; `*` means overwrite): a stale tab gets 409 and a Reload / Overwrite banner. No header: unchanged, as R10 pins.
  - `update_profile` caps a section at the 4 MB profile limit and refuses a newly introduced image that is not on this site's Cloudinary, or a link that is not https, http or mailto.
  - The briefing lists only real posts in its top posts, and counts the test funnel in full UTC days ending yesterday.
