# Rule Index

These rules are distilled from DeewasExpo, Deewas, and AnphaShop. They are
intended to be reusable in future projects, with DeewasExpo treated as the
newest and strongest style signal.

Read the focused rule file before changing matching code:

- `project-style.md` - global TypeScript, naming, formatting, comments, and
  organization.
- `nextjs-app-router.md` - Next.js App Router structure, metadata, caching, and
  server/client boundaries.
- `api-security.md` - route handlers, auth, validation, secrets, AI/external
  services, and response shapes.
- `data-and-state.md` - persistence, request helpers, models, local storage,
  stores, and sync.
- `frontend-ui.md` - Tailwind/CSS tokens, components, responsive UI, copy,
  loading states, and icons.
- `testing-quality.md` - checks, tests, verification, and code quality.

Priority order when rules conflict:

1. Current repo-local code that is already intentional.
2. DeewasExpo conventions.
3. Deewas web conventions.
4. AnphaShop mature guardrails.
