import { Arimo } from 'next/font/google'

/**
 * The CV body face, shared by the `/cv` route and the settings editor's live preview.
 *
 * Arimo is the face the source PDF embeds - a metric clone of Arial - so the printed
 * line breaks land where the original's did. It lives here rather than in either renderer
 * because `next/font` hashes one stylesheet per loader call: calling it twice would ship
 * two copies of the same font and let the two surfaces drift apart.
 *
 * `--cv-body` is consumed by the `.cv` font stack in `cv-sheet-css.ts`, so whichever
 * element carries `arimo.variable` must also carry the `cv` class.
 */
export const arimo = Arimo({
  subsets: ['latin'],
  weight: ['400', '700'],
  style: ['normal', 'italic'],
  variable: '--cv-body',
  display: 'swap',
})
