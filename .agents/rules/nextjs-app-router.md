# Next.js App Router Rules

This repo uses Next.js App Router under `src/app`. Before changing Next.js
APIs, routing behavior, metadata, caching, route handlers, or server/client
boundaries, read the relevant guide in `node_modules/next/dist/docs/` because
this project explicitly tracks current Next.js behavior.

## Routing

- Keep App Router files in `src/app`.
- Use route groups like `(home)`, `(auth)`, `(admin)`, or `(dashboard)` when a
  layout boundary should not appear in the URL.
- Use `page.tsx`, `layout.tsx`, `loading.tsx`, `error.tsx`, and `not-found.tsx`
  according to App Router conventions.
- API endpoints live under `src/app/api/**/route.ts`.
- A route segment must not have both `page.tsx` and `route.ts` at the same
  level.
- Use `notFound()` for page-level missing resources when the route expects a
  404 state.
- Use `NextResponse.json(...)` or `Response.json(...)` consistently inside
  route handlers and keep status codes explicit.

## Server And Client Boundaries

- Components are server components by default.
- Add `'use client'` only when the file uses hooks, event handlers, browser
  APIs, client stores, local state, or client auth/session hooks.
- Keep database access, secrets, email sending, file uploads, AI provider keys,
  and privileged business logic out of client components.
- Client components should call request helpers from `src/requests` or route
  handlers; they must not import server-only modules.
- Guard browser APIs such as `localStorage`, `window`, and `document` with
  runtime checks when needed.

## Fetching And Cache

- Do not cache user-specific, admin, auth, account, payment, AI, or mutable data
  unless the product decision is explicit.
- Use `{ cache: 'no-store' }` for admin/user-changing reads and request helpers
  that must stay fresh.
- Be deliberate with `next: { revalidate: ... }`, route `dynamic`, and
  `use cache`; document why cached data is safe.
- Keep absolute URLs centralized in constants such as `APP_URL` or `API_URL`.

## Metadata And SEO

- Do not leave create-next-app metadata in production-facing pages.
- Keep metadata, Open Graph, manifest, icons, and structured data in sync with
  product-facing copy.
- If a page's title, canonical URL, image, language, or visibility changes,
  update metadata in the same change.

## Layouts And Providers

- Keep root layouts mostly server-side.
- Put client-only providers in a dedicated `src/components/providers` component
  and import that provider from the layout.
- Keep font setup centralized in the root layout and map font variables through
  CSS/Tailwind tokens.
