# Data And State Rules

Use this for persistence, request helpers, models, stores, local storage, and
sync behavior.

## Request Helpers

- Put internal API fetch wrappers under `src/requests`.
- Name helpers by action and resource, ending with `Api`.
- Keep fetch URLs centralized through constants such as `API_URL`.
- For fresh user/admin data, use `{ cache: 'no-store' }`.
- After a failed response, throw `new Error((await res.json()).message)` or a
  safer equivalent that preserves the API message.
- Keep request helper payloads typed with interfaces or inline object types.

## Persistence

- Connect to the database through a shared helper such as `connectDatabase()`.
- Cache database connections safely in development to avoid recompilation or
  reconnect loops.
- Use `.lean()` for read-only Mongoose responses when document methods are not
  needed.
- Re-check ownership, existence, quota, balances, plan state, and server-derived
  values before writes.
- Keep destructive schema or data-shape changes behind a clear migration plan.

## Models

- Keep model files self-contained: schema, exported model, related interfaces,
  and domain unions.
- Use explicit schema defaults, validators, indexes, and timestamps when data
  integrity matters.
- Import related models before `populate(...)` when refs depend on model
  registration.
- Avoid storing derived values that can drift unless performance requires it and
  the update path is clear.

## Client State

- Keep client state small and scoped.
- Use a dedicated store/provider only when props or server state are no longer
  enough.
- Persist to local storage through named storage keys, not scattered string
  literals.
- Guard local storage access for server rendering.
- Keep optimistic UI reversible when a server write can fail.

## Sync And Offline-Like Flows

- Treat the server as authoritative for shared/user data.
- Keep local drafts clearly separated from committed server data.
- When merging local and server state, normalize shape first and keep conflict
  behavior explicit.
