import { collapseWhitespace, dedupeJobTitles, excerptText, splitAboutParagraphs } from '@/lib/profile-copy'
import type { PublicProfile } from '@/lib/profile-public'

import { PLATFORM_LIMITS } from './limits'
import { displayName, siteUrl } from './shared'
import type { GithubBioArtifact, RenderContext } from './types'

/**
 * Account-level fields for `PATCH /user`.
 *
 * Every value is truncated to GitHub's cap so the PATCH cannot be rejected for length.
 * `company` is intentionally left empty unless the profile states one - GitHub renders it
 * as an affiliation, and guessing wrong there is worse than leaving it blank.
 */
export function renderGithubBio(profile: PublicProfile, ctx: RenderContext): GithubBioArtifact {
  const titles = dedupeJobTitles(profile.jobTitle)
  const description = collapseWhitespace(profile.description)
  const firstParagraph = splitAboutParagraphs(profile.aboutMe)[0] ?? ''

  // Prefer the explicit one-liner; fall back to job titles, then the opening of About.
  const bioSource = description || titles.join(' · ') || firstParagraph

  return {
    kind: 'fields-object',
    name: excerptText(displayName(profile), PLATFORM_LIMITS.githubName),
    bio: excerptText(bioSource, PLATFORM_LIMITS.githubBio),
    blog: siteUrl(ctx).slice(0, PLATFORM_LIMITS.githubBlog),
    location: excerptText(
      collapseWhitespace(profile.publicLocation ?? ''),
      PLATFORM_LIMITS.githubLocation
    ),
    company: '',
  }
}
