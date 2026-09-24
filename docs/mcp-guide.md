# Port4lio MCP guide

Port4lio exposes a private [Model Context Protocol (MCP)](https://modelcontextprotocol.io/)
server at `/api/mcp`. It lets Claude Code or Codex read site context and perform
only the actions granted by a token: work on blog drafts, review metrics, manage
whiteboard ideas, update CCA-F progress, and more.

The server is for the site owner. It is not a public API, and it does not use the
browser owner session.

## Create a token

1. Sign in as the owner and open `/admin/agents`.
2. Give the token a recognisable name, such as `claude-laptop` or
   `codex-workstation`.
3. Choose the smallest useful set of scopes, then create the token.
4. Copy the `p4_...` value. You can copy it again later from the token's row
   (**Copy**) while it is not revoked. The site verifies tokens by their hash and
   keeps only an encrypted copy for that button; revoking a token deletes the
   copy. Tokens created before this existed show "Not copyable" - create a new
   one if you need to copy it again.

| Scope     | Grants                                                                       | Use it for                         |
| --------- | ---------------------------------------------------------------------------- | ---------------------------------- |
| `read`    | Profile, CV, posts, metrics, visible whiteboard, CCA-F status, writing tools | Research, drafting, briefings      |
| `write`   | Unpublished-post drafts/images, whiteboard cards/links, CCA-F updates        | Creating drafts and recording work |
| `publish` | Publishing/archiving posts, editing a live post, profile-section edits       | Deliberate public-site changes     |
| `pii`     | A lookup of one order by code                                                | Customer-support checks            |

New tokens default to `read` and `write`. `publish` and `pii` are intentionally
off by default. Make separate, short-lived tokens for high-risk work where
possible.

## Connect an agent

Put the token in your shell profile, for example `~/.zshrc`, then open a new
terminal:

```sh
export PORT4LIO_MCP_TOKEN=p4_replace-with-the-token-you-copied
```

For a local server, add Claude Code with:

```sh
claude mcp add --scope user --transport http port4lio http://localhost:3000/api/mcp \
  --header 'Authorization: Bearer ${PORT4LIO_MCP_TOKEN}'
```

For Codex:

```sh
codex mcp add port4lio --url http://localhost:3000/api/mcp \
  --bearer-token-env-var PORT4LIO_MCP_TOKEN
```

Or add this to `~/.codex/config.toml`:

```toml
[mcp_servers.port4lio]
url = "http://localhost:3000/api/mcp"
bearer_token_env_var = "PORT4LIO_MCP_TOKEN"
```

Replace `http://localhost:3000` with the deployed site's origin when connecting
to production. Use Claude's **user** scope, never project scope: project scope
can create a committed `.mcp.json`. Keep the header single-quoted so Claude
stores the environment-variable reference rather than the secret itself.

Start a fresh agent session and ask: `Load who I am.` The token's row in
`/admin/agents` will show that it has connected after its first request.

## What to ask

The available tools are filtered by the token scopes, so an agent cannot see
tools it was not granted. Three MCP prompts are also available in supporting
clients: `write-post`, `weekly-briefing`, and `tailor-cv`.

| Goal                   | Example request                                                                                                                          | Required scopes   |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| Get personal context   | `Load who I am: my profile, CV, active goals and dreams, and recent posts.`                                                              | `read`            |
| Draft a blog post      | `Write a post about what I learned shipping the whiteboard, in my voice, with a cover image and inline images, and leave it as a draft.` | `read`, `write`   |
| Publish a draft        | `Publish that draft.`                                                                                                                    | `read`, `publish` |
| Review performance     | `How did this week go? Compare blog views, subscribers, test sales, revenue and conversion with last week.`                              | `read`            |
| Tailor a CV            | `Tailor my CV for this job posting: ...`                                                                                                 | `read`            |
| Correct profile copy   | `Fix the typo in my profile headline.`                                                                                                   | `read`, `publish` |
| Archive old posts      | `Archive posts published over a year ago that had no views in the last 180 days.`                                                        | `read`, `publish` |
| Save a whiteboard idea | `Save this idea as a goal on my whiteboard and link it to my "Career 2027" card.`                                                        | `read`, `write`   |
| Log CCA-F practice     | `I got 48 out of 60 on a CCA-F mock. Log it and tell me how ready I am.`                                                                 | `read`, `write`   |
| Check an order         | `Check order ABC123: is it paid, and did the result email send?`                                                                         | `pii`             |

For a post, the expected safe loop is: read the writing brief and relevant
context, lint the draft, create it, generate/attach images, wait for illustration
to complete, inspect the post, then publish only if the token has `publish` and
you actually want it public. Creating a draft never publishes it.

## Important behaviours

- The agent can update post text but cannot change a post's status through an
  ordinary update. Publishing and archiving are separate, `publish`-scoped
  actions.
- A post-illustration request starts work in the background. Ask the agent to
  check the post again until illustration is idle and there are no remaining
  image placeholders before publishing.
- Profile writes use a section version to prevent overwriting a concurrent owner
  edit. If an update is stale, have the agent re-read the section and retry the
  narrow correction.
- Tailoring a CV returns markdown in chat. It never changes the stored CV or
  profile.
- CCA-F mock scores are stored as a raw count out of 60. Give that count rather
  than a scaled score such as 720.
- Whiteboard reads respect each card and frame's AI-visibility settings. An
  agent cannot search or link to hidden content.
- Order lookup returns limited operational details only: it does not reveal a
  customer email, certificate name, or attempt token.

## Audit, revoke, and recover

`/admin/agents` shows the latest agent activity. Writes, order lookups, refused
out-of-scope calls, and errors are recorded there. Review this feed after a
publishing or support session.

Revoke a token from that page when a device is lost, an agent session should no
longer have access, or a token may have been exposed. The next request with a
revoked token returns an authorization error. Create a replacement token - an
old plaintext token cannot be recovered.

If an agent says a tool is unavailable, check the token scopes first. If it
reports an authorization error after a token was just created, verify that the
shell running Claude or Codex has `PORT4LIO_MCP_TOKEN` set and restart the
agent session after changing it.

## Legacy whiteboard connection

Older `wbt_` whiteboard tokens remain usable only for the temporary
`/api/whiteboard/mcp` compatibility endpoint. They are read-only and cannot
access `/api/mcp`. Revoke them from `/admin/agents` and replace them with a
scoped `p4_` token; the compatibility endpoint is scheduled for removal.
