/**
 * Empty stand-in for the `server-only` package under vitest.
 *
 * The real package has no runnable default export: its `package.json` maps the default
 * condition to a module whose only statement throws, so that importing it from a client
 * bundle is a build error. That is exactly what it is for, and it means installing it does
 * NOT make `import 'server-only'` work under vitest - the import throws at load and every
 * test in the file dies before it runs. `tsc --noEmit` has a separate complaint (TS2307),
 * which the package fixes and this alias also fixes.
 *
 * Next resolves the `react-server` condition internally, so `next build` and `next dev` need
 * none of this. vitest is the environment that needs a door, and an empty module is the
 * whole door: the import succeeds, contributes nothing, and the guarantee it encodes
 * (this module never reaches a client bundle) is still enforced where it matters, by the
 * real package during the real build.
 */
export {}
