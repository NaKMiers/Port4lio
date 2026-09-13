import type { Config } from 'tailwindcss'

/**
 * A `pp-*` token that survives an opacity modifier.
 *
 * These colours are CSS variables, and a bare `var(--pp-blue)` is opaque to Tailwind's
 * colour parser: `withAlphaValue` fails to parse it and the utility is dropped entirely,
 * so `bg-pp-blue/10` used to compile to *nothing at all* rather than to a translucent
 * blue. Roughly forty such classes were written across the app and every one of them was
 * silently dead - tinted chips with no tint, rings with no ring.
 *
 * Returning a function lets Tailwind hand us the alpha it wants. Numeric alphas become a
 * `color-mix`, which works regardless of what the variable holds (`#3398ff`, but also
 * `rgba(255, 255, 255, 0.78)` for `--pp-panel`). Anything non-numeric - Tailwind passes
 * `var(--tw-bg-opacity, 1)` for the un-modified utility - falls back to the plain
 * variable, which is what that case wants anyway.
 */
const ppColor = (token: string): string => {
  const resolve = ({
    opacityValue,
  }: { opacityValue?: string | number } = {}): string => {
    const base = `var(--pp-${token})`
    const alpha = Number(opacityValue)
    if (opacityValue === undefined || !Number.isFinite(alpha) || alpha >= 1) {
      return base
    }
    return `color-mix(in srgb, ${base} ${alpha * 100}%, transparent)`
  }
  // Tailwind takes a resolver here at runtime; its v3 `Config` type only admits strings.
  return resolve as unknown as string
}

/**
 * One content glob, because there is one source root.
 *
 * The three that used to sit above it - `./app`, `./pages`, `./components` - came from
 * `create-next-app`'s template and pointed at directories this project has never had.
 * Tailwind stats every glob on every rebuild, so they were pure cost for zero coverage.
 */
const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    container: {
      padding: {
        DEFAULT: '15px',
      },
    },
    /**
     * A full override, not an extension - so Tailwind's default `2xl` (1536px) does not
     * exist here. Deliberate, and verified: nothing in `src/` uses a `2xl:` prefix, and a
     * `2xl:` class under this config would silently do nothing.
     */
    screens: {
      sm: '640px',
      md: '768px',
      lg: '960px',
      xl: '1200px',
    },
    extend: {
      colors: {
        /** Dark admin chrome (`SiteChrome` and the nav/header inside it). */
        primary: '#111',
        secondary: '#393A47',
        accent: '#00bfff',
        /** Editorial one-page (tokens also live as CSS vars on `.portfolio-public-root`) */
        pp: {
          bg: ppColor('bg'),
          panel: ppColor('panel'),
          'panel-strong': ppColor('panel-strong'),
          text: ppColor('text'),
          muted: ppColor('muted'),
          line: ppColor('line'),
          blue: ppColor('blue'),
          green: ppColor('green'),
          violet: ppColor('violet'),
          pink: ppColor('pink'),
          orange: ppColor('orange'),
        },
      },
      /**
       * Each of these must have a matching `--font-*` variable set by `next/font` in the
       * root layout. `poppins` used to be listed here and had none: the font was dropped
       * from the layout at some point, so `font-poppins` resolved to an empty variable and
       * fell through to `sans-serif`. Nothing used it, and it would have failed silently if
       * anything had.
       */
      fontFamily: {
        sora: [`var(--font-sora)`, 'sans-serif'],
        display: [`var(--font-montserrat)`, 'Montserrat', 'system-ui', 'sans-serif'],
        editorial: [`var(--font-source-sans-3)`, 'Source Sans 3', 'system-ui', 'sans-serif'],
      },
      maxWidth: {
        editorial: 'var(--pp-max)',
      },
      spacing: {
        section: 'var(--pp-section-y)',
        'section-sm': 'var(--pp-section-y-sm)',
        gutter: 'var(--pp-gutter)',
      },
      borderRadius: {
        panel: 'var(--pp-radius-panel)',
      },
      boxShadow: {
        panel: 'var(--pp-shadow)',
      },
    },
  },
  plugins: [],
}
export default config
