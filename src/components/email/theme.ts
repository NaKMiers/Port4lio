/**
 * The site's editorial palette, as literal hex.
 *
 * This duplicates `--pp-*` from `src/styles/globals.css` on purpose, and the duplication
 * is the point: those tokens are CSS custom properties, and `var()` does not resolve in
 * Outlook, older Gmail, or most native mail clients. An email styled with `var(--pp-text)`
 * renders as unstyled black-on-white almost everywhere. Same colours, resolved at author
 * time so they survive the trip.
 *
 * Keep in sync with `.portfolio-public-root` by hand. There is no build step that can do
 * it, so a token change on the site needs the matching edit here.
 */
export const EMAIL_COLOR = {
  /** `--pp-bg` - the paper background. */
  page: '#f7f3ee',
  /** `--pp-panel-strong` - card surfaces. Opaque, because email clients ignore alpha layering. */
  card: '#fffdfa',
  /** `--pp-line` at full opacity; the site's version is 8% black over paper. */
  line: '#e8e4dd',
  /** `--pp-text` */
  text: '#1f1c1a',
  /** `--pp-muted` */
  muted: '#6d6661',
  /** `--pp-violet` */
  violet: '#7b6dff',
  /** `--pp-blue` */
  blue: '#3398ff',
  /** `--pp-green` */
  green: '#39be71',
  /** `--pp-orange` */
  orange: '#ff9f40',
  /** Track behind an axis bar. */
  track: '#eae5de',
} as const

/**
 * Web-safe stacks that name the site's faces first.
 *
 * A `@font-face` in an email is a wasted request in every client that matters, so
 * Montserrat and Source Sans 3 only apply for the minority of recipients who happen to
 * have them installed. The fallbacks are what most people actually see, which is why they
 * are chosen to sit at a similar weight rather than being an afterthought.
 */
export const EMAIL_FONT = {
  display: "Montserrat, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  body: "'Source Sans 3', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
} as const

/** Older clients ignore `max-width` on a div, so the card is a hard pixel width. */
export const EMAIL_CARD_WIDTH = 600
