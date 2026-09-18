# Publishing the profile outward

The MongoDB profile document is the single source of truth. This directory holds the
piece that lives outside this repo: the GitHub Actions workflow that applies it.

## What is automated and what is not

| Target | How | Why |
| --- | --- | --- |
| `anhkhoa.info` | Native | It reads the profile directly |
| `/cv` | Native | Reads `profile.resume` |
| GitHub profile README | **Automated** | Contents API, default `GITHUB_TOKEN` |
| GitHub account bio | **Automated** | `PATCH /user`, needs a PAT |
| LinkedIn | **Manual** | No profile-write API exists outside partner access |
| Upwork | **Manual** | GraphQL API is read-oriented; no self-profile mutation |
| Fiverr | **Manual** | No public seller API at all |

The three manual platforms are served by `/publish`, which renders each field already
shaped and length-capped for that platform, with a Copy button and a drift badge. Press
**Mark as pasted** after pasting; the badge goes back to "out of date" the next time the
generated text actually changes.

Automating those three would mean scripting a logged-in browser session - against their
terms, fragile, and it would require storing three more passwords. The copy kit is the
honest answer.

## Setup

### 1. Portfolio side

`PUBLISH_TOKEN` must exist in the deployment environment (already added to local `.env`):

```bash
openssl rand -hex 32
```

Add the same value to Vercel → Project → Settings → Environment Variables.

Optionally set `PUBLISH_GITHUB_USERNAME` if the GitHub account is ever renamed; it
defaults to `NaKMiers`.

### 2. Create the bio token

`PATCH /user` is account-level, so `GITHUB_TOKEN` cannot do it and neither can the
existing `gh` CLI tokens (scopes `gist, read:org, repo, workflow`). Create a new one:

- **Preferred** - a fine-grained PAT with **Account permissions → Profile → Read and
  write** and *zero* repository permissions, 90-day expiry. That token cannot touch a
  single repo.
- **Fallback** - a classic PAT with only the `user` scope. This is a real downgrade:
  `user` also grants read/write on your email addresses and following list. Try
  fine-grained first.

### 3. Secrets on `NaKMiers/NaKMiers`

| Name | Value |
| --- | --- |
| `PORTFOLIO_MANIFEST_URL` | `https://anhkhoa.info/api/publish/manifest` |
| `PORTFOLIO_PUBLISH_TOKEN` | the `PUBLISH_TOKEN` value from step 1 |
| `GH_PROFILE_TOKEN` | the PAT from step 2 |

The URL is a secret rather than a variable so it is masked in the logs of a public repo.

### 4. Install the workflow

```bash
gh repo clone NaKMiers/NaKMiers /tmp/profile-repo
```

Copy `publish-profile.yml` to `.github/workflows/publish-profile.yml` there, commit, push.

### 5. First run - with the bio disabled

```bash
gh workflow run publish-profile -R NaKMiers/NaKMiers -f skip_bio=true
```

Read the README diff by eye before letting it touch the account bio. Then run it again
immediately: the second run must report `unchanged` and create no commit. Once that is
confirmed, run without `skip_bio`.

## Design notes

**The app renders, the workflow only writes.** `GET /api/publish/manifest` returns
finished artifacts - the README arrives as a complete markdown string. The alternative
(the workflow checking out this repo and running a render script) would require
`MONGODB_URI`, your production database credential, to live in Actions secrets reachable
by any third-party action in the job. A leaked `PUBLISH_TOKEN` exposes a JSON blob of
already-public marketing copy instead.

**Version hashes are taken over rendered output, not source fields.** `POST /api/profile`
writes with `$set: { ...parsed }`, which rewrites the document, and BSON preserves
insertion order - so hashing the raw document would report phantom drift whenever key
order shifted. Hashing the artifact also means editing `backgroundImage` does not mark
LinkedIn stale, and improving a renderer correctly does.

**Nothing turns green by itself.** A target reads as in sync only because the workflow
reported a push or you pressed Mark as pasted. If the workflow stops running - GitHub
disables scheduled workflows after 60 days of repository inactivity, and a profile repo
receiving only bot commits can trip that - the badge drifts on its own. That is the
signal. Do not add a keepalive commit; that is noise pretending to be health.

## Known gaps

- **Masthead pipe spacing is hand-measured.** The gaps around the vertical bars in the CV
  contact row are tuned to the exact strings on either side. Changing the email, phone or
  location requires checking `/cv` by eye - `tests/e2e/cv-pagination.spec.ts` only
  measures height.
- **The CV is nearly full.** Sheet 1 has about 9 mm of headroom and sheet 2 about 6 mm.
  Adding more than a line or two means moving the page break.
- **`profile.cv` can still hold a stale PDF.** The field takes a manually uploaded
  Cloudinary file and feeds the site's "view my CV" links. It goes out of date the moment
  the CV is edited in the admin. Leave it empty: `cvUrl` then falls back to `/cv`, which
  is always current and prints to PDF on demand.
