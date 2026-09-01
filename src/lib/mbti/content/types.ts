/**
 * Shapes shared by every locale's content file.
 *
 * Kept in its own module so `questions.vi.ts` and `questions.en.ts` do not import each
 * other, and so adding a locale is a new file plus one line in `content/index.ts`.
 */

export type QuestionContent = {
  prompt: string
  /** Scores the FIRST pole of the axis: E, S, T, or J. */
  a: string
  /** Scores the SECOND pole of the axis: I, N, F, or P. */
  b: string
}

export type TypeContent = {
  /** English nickname, e.g. "The Teacher". Kept in every locale - it is part of the type's identity. */
  nickname: string
  /** One sentence that should make someone feel recognised. Shown under the type code. */
  tagline: string
  /** Two to four paragraphs. The substance of the free type page. */
  overview: string[]
  strengths: string[]
  growth: string[]
  /** How this type tends to show up with other people. Sets up the paid pair report. */
  inRelationships: string
}
