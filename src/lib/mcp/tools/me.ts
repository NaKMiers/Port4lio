import 'server-only'

import { z } from 'zod'

import { listPosts } from '@/lib/blog/post-service'
import { defineTool, ok } from '@/lib/mcp/run-tool'
import {
  PROFILE_SECTION_KEYS,
  readProfileSection,
} from '@/lib/profile-sections'
import { loadAgentVisible } from '@/lib/whiteboard/data'

/**
 * "Me" tools: the owner's profile and CV, read as whole sections with a version hash, and
 * `get_me`, the one-call summary for "load who I am".
 *
 * ```
 *   get_profile(section) ──▶ profile-sections: one findById, projected ──▶ { section, version, value }
 *   get_me ──▶ identity + about (clipped) + resume   (profile-sections)
 *            + active dreams and goals              (loadAgentVisible overview: visible only)
 *            + 5 latest published posts             (post-service listPosts)
 * ```
 *
 * The resume carries the owner's own contact details on purpose (premise 5: `/cv` already
 * publishes them). These two tools are the one token-gated machine-readable exception, which
 * the `loadPublicResume` comment in `profile-data.ts` records (C7).
 */

export const getProfileTool = defineTool({
  name: 'get_profile',
  title: 'Get one profile section',
  description: [
    "One section of the owner's portfolio profile, returned whole as JSON with a `version` hash.",
    'Sections: identity (name, job titles, description, avatar, location, socials), about (headings, stats, about me),',
    'career (skills, experience, education, certificates), offering (services), work (projects),',
    "cvFile (the public CV file link), resume (the printable /cv sheet, including the owner's own contact details).",
    'Keep the version: editing a section later requires the version you read.',
  ].join(' '),
  scopes: ['read'],
  input: z.object({
    section: z.enum(PROFILE_SECTION_KEYS as [string, ...string[]]),
  }),
  annotations: { readOnlyHint: true, openWorldHint: false },
  async run({ section }) {
    const { value, version } = await readProfileSection(
      section as (typeof PROFILE_SECTION_KEYS)[number]
    )
    return ok(JSON.stringify({ section, version, value }, null, 2))
  },
})

const ABOUT_CLIP = 1_500

/**
 * `get_me`: scene 3 in one call (C4: it needed `post-service`, so it ships in phase 2).
 * Capped by construction (C10): goals and posts are titles only, at most 5 posts.
 */
export const getMeTool = defineTool({
  name: 'get_me',
  title: 'Who the owner is',
  description:
    "One call for 'who am I': the owner's public profile summary, their CV (the printable /cv sheet, including their own contact details), their active goals and dreams from the whiteboard (titles only), and their 5 most recent published posts (titles only). Use get_profile for a whole section, whiteboard_get_item or get_post for detail.",
  scopes: ['read'],
  input: z.object({}),
  annotations: { readOnlyHint: true, openWorldHint: false },
  async run() {
    const [identity, about, resume, overview, posts] = await Promise.all([
      readProfileSection('identity'),
      readProfileSection('about'),
      readProfileSection('resume'),
      loadAgentVisible({ kind: 'overview' }),
      listPosts({ status: ['published'], sort: 'publishedAt', limit: 5 }),
    ])
    const aboutMe = String(about.value.aboutMe ?? '')
    return ok(
      JSON.stringify(
        {
          profile: {
            ...identity.value,
            profileHeading: about.value.profileHeading,
            aboutMe:
              aboutMe.length > ABOUT_CLIP
                ? `${aboutMe.slice(0, ABOUT_CLIP)} [clipped - get_profile about has the rest]`
                : aboutMe,
          },
          cv: resume.value.resume,
          activeGoalsAndDreams: overview.active.map(item => ({
            id: item.id,
            title: item.title,
            meaning: item.meaning,
            targetBy: item.targetBy
              ? item.targetBy.toISOString().slice(0, 10)
              : null,
          })),
          recentPosts: posts.items.map(post => ({
            id: post.id,
            slug: post.slug,
            title: post.title,
            publishedAt: post.publishedAt,
          })),
        },
        null,
        2
      )
    )
  },
})
