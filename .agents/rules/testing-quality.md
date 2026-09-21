# Testing And Quality Rules

Use the smallest verification set that gives confidence for the touched area,
and broaden it when changes affect auth, data, routing, billing, AI, or shared
UI.

## Commands

- Preferred package manager/runtime is Bun because this repo has `bun.lock`.
- Common checks:
  - `bun run lint`
  - `bun run format:check`
  - `bun run build`
  - `bun test` when tests exist
- Do not run destructive cleanup scripts such as `clean` unless the user asks.

## Test Placement

- Put unit tests next to source as `*.test.ts` or `*.test.tsx`.
- Prefer focused tests for utilities, validation, query parsing, time/number
  formatting, storage merge logic, and request-independent business rules.
- For route handlers, extract validation and pure decision logic so it can be
  tested without a full database/auth environment.

## Verification Expectations

- Formatting changes should pass Prettier.
- TypeScript/React changes should pass lint.
- App Router, metadata, or build-sensitive changes should pass `bun run build`
  when practical.
- UI changes should be checked in browser when there is a local URL and the
  affected behavior is visual or interactive.
- API/security changes should verify both success and unhappy paths.

## Code Quality

- Keep changes scoped to the requested behavior.
- Prefer existing helpers and components before adding new abstractions.
- Do not hide errors with empty catches.
- Return useful API messages and surface useful client feedback.
- Never weaken lint/type rules just to land code quickly; fix the code or add a
  narrow, justified exception.
