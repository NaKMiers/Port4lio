/**
 * Platform-side field limits.
 *
 * These are not verifiable from code and the platforms change them without notice. If a
 * paste is rejected for length, correct the number here first - renderers truncate to
 * these values, so a wrong number here is the likeliest cause.
 */
export const PLATFORM_LIMITS = {
  githubName: 255,
  githubBio: 160,
  githubBlog: 255,
  githubLocation: 80,
  githubCompany: 100,

  linkedinHeadline: 220,
  linkedinAbout: 2600,
  /** Max skills LinkedIn accepts on a profile. */
  linkedinSkills: 50,

  upworkTitle: 70,
  upworkOverview: 5000,

  fiverrDescription: 600,
} as const
