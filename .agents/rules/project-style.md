# Project Style Rules

Use this for all TypeScript, React, and shared code.

## Formatting

- Use Prettier with LF line endings, 2 spaces, single quotes, no semicolons,
  `printWidth: 80`, `trailingComma: "es5"`, and one JSX prop per line when
  wrapping.
- Keep Tailwind classes sorted by `prettier-plugin-tailwindcss`.
- Prefer Bun commands because this repo has `bun.lock`.
- Keep files ASCII unless the product copy or existing file content clearly
  needs non-ASCII text.

## TypeScript

- Keep `strict: true`.
- Do not add `any`. Use `unknown`, generics, typed payloads, or narrow
  external data at the boundary. If a third-party API forces `any`, isolate it
  in the smallest scope and explain it with a targeted disable comment.
- Prefix intentionally unused variables or parameters with `_`.
- Prefer `interface Props` for component props and named `type` unions for
  domain states.
- Keep schema/model interfaces aligned with their persistence fields.

## File Organization

- New application code belongs under `src`.
- Use `src/app` for App Router files.
- Use `src/components` for shared UI, with domain folders such as `home`,
  `admin`, `auth`, `common`, `layout`, `providers`, `ui`, and `loading`.
- Use `src/lib` for framework-agnostic helpers and service utilities.
- Use `src/constants` for reusable settings, regex, environment wrappers,
  colors, copy maps, and time/system constants.
- Use `src/requests` for client/server fetch wrappers around internal APIs.
- Use `src/models` or `src/db` only when the project actually has persistent
  models.
- Use the `@/*` alias for imports from `src`.

## Naming

- Components and files that export components use `PascalCase`.
- Hooks start with `use`.
- Request helpers end with `Api`, for example `getUserApi`, `editUserApi`,
  `deleteUsersApi`.
- Models use a `Model` suffix when using Mongoose-like patterns.
- Constants that represent shared maps use clear exported names such as
  `COLORS`, `ENV`, `API_URL`, `STORAGE_KEYS`, or domain-specific equivalents.
- Keep route segment names lowercase and URL-shaped; use route groups for
  organization without URL changes.

## Code Shape

- Prefer small, composable functions over large inline blocks.
- Prefer minimal control-flow syntax for simple single-statement branches:
  `if (condition) doThing()`. Use braces when a branch has multiple statements,
  nested control flow, declarations that need a block, or when braces make a
  risky condition easier to read.
- Use a shared `cn(...)` helper for conditional class names.
- Prefer existing local helpers/components before adding new abstractions.
- Use `// MARK: Name` comments only to divide meaningful sections inside larger
  files. Avoid comments that restate obvious code.
- Keep route/page files thin when a feature grows: move domain UI to
  components, business logic to `lib`, data calls to `requests`, and constants
  to `constants`.

## Dependencies

- Prefer proven, already-used project stack pieces: Next.js App Router, React,
  Tailwind, `clsx`, `tailwind-merge`, `zod` when validation is needed, and
  `lucide-react` for icons when available.
- Do not introduce a new state, form, animation, chart, date, or validation
  library when an existing project dependency or helper covers the job.
