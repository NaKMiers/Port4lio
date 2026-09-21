# API And Security Rules

Treat route handlers, auth, AI calls, uploads, email, payments, and admin
workflows as security-sensitive by default.

## Authentication And Authorization

- Middleware/proxy must protect every protected route family and every
  privileged API family.
- Do not trust client-sent `userId`, role, email ownership, balance, price,
  quota, plan, admin flags, or entitlement state.
- Admin APIs must verify authorization in the route handler or a shared
  server-side helper even when middleware/proxy also protects them.
- Prefer server-derived identity from the session/token over request body
  identity.

## Validation

- Parse a request body once, then validate it before side effects.
- Use `zod` or a typed validation helper for non-trivial payloads.
- Normalize user input at the boundary and pass typed data inward.
- Check unhappy paths: missing auth, invalid payload, forbidden role, missing
  resource, stale ownership, and duplicate actions.

## Responses

- Return JSON errors shaped like `{ message: string }` unless an endpoint
  already has a richer documented contract.
- Use meaningful status codes: `400` invalid input, `401` unauthenticated,
  `403` forbidden, `404` missing resource, `409` conflict, `429` rate limit,
  and `500` unexpected errors.
- Do not return raw database objects with sensitive fields.
- Log enough context for debugging, but never log secrets or private payloads.

## Secrets And Environment

- Never expose server secrets through `NEXT_PUBLIC_*`.
- Keep database URLs, auth secrets, OAuth secrets, AI keys, email credentials,
  storage credentials, payment secrets, and signing keys server-only.
- Do not commit `.env` values, generated secrets, private keys, or account
  credentials.
- Put environment wrappers under `src/constants/environments.ts` or a similar
  central module when env access grows.

## External Services

- Email, upload, payment, push notification, AI, and third-party API logic
  belongs in server utilities under `src/lib` or dedicated server modules.
- Route handlers should validate, authorize, call the service helper, and
  return a clear response.
- Rate-limit or otherwise guard expensive public endpoints and AI endpoints.
- Keep provider-specific code behind a helper so UI and route handlers do not
  spread provider details across the app.
