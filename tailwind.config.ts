import type { Config } from 'tailwindcss'

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
          bg: 'var(--pp-bg)',
          panel: 'var(--pp-panel)',
          'panel-strong': 'var(--pp-panel-strong)',
          text: 'var(--pp-text)',
          muted: 'var(--pp-muted)',
          line: 'var(--pp-line)',
          blue: 'var(--pp-blue)',
          green: 'var(--pp-green)',
          violet: 'var(--pp-violet)',
          pink: 'var(--pp-pink)',
          orange: 'var(--pp-orange)',
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
