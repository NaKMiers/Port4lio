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

/**
 * How a type tends to work, and the kinds of role that tend to suit it.
 *
 * Hand-written per type rather than composed, because this is the one section where
 * generic text is worse than no text: "nghề nghiệp phù hợp với ENTJ" is a high-intent
 * query, and a list that could belong to any of the sixteen types is exactly what Google's
 * helpful-content system is built to demote.
 *
 * Framed as tendency, never prescription. A type does not determine a career, and the page
 * says so - see `careersCaveat` in the UI strings.
 */
export type CareerContent = {
  /** One or two sentences on how this type operates at work. */
  workStyle: string
  /** Concrete roles, weighted toward what actually exists in the Vietnamese job market. */
  roles: string[]
  /** The conditions that bring out their best. */
  thrivesIn: string
  /** What reliably wears them down. The honest half, and the more useful one. */
  drainedBy: string
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
