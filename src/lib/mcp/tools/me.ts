import 'server-only'

import { z } from 'zod'

import { listPosts } from '@/lib/blog/post-service'
import { listCvSummaries } from '@/lib/cv/cv-service'
import { defineTool, ok, refuse } from '@/lib/mcp/run-tool'
import {
  PROFILE_SECTION_KEYS,
  readProfileSection,
  type ProfileSection,
} from '@/lib/profile-sections'
import { patchProfileSection } from '@/lib/profile-service'
import { loadAgentVisible } from '@/lib/whiteboard/data'

/**
 * "Me" tools: the owner's profile and CV, read as whole sections with a version hash, and
 * `get_me`, the one-call summary for "load who I am".
 *
 * ```
 *   get_profile(section) ──▶ profile-sections: one findById, projected ──▶ { section, version, value }
 *   update_profile(section, version, value) ──▶ profile-service.patchProfileSection
 *                            resume refused: CVs have their own tools (tools/cv.ts, update_cv)
 *                            · stale version refused (R6) · revalidateTag
 *   get_me ──▶ identity + about (clipped) + resume   (profile-sections: the PUBLISHED CV)
 *            + cvs: [{ id, label, published }]      (cv-service.listCvSummaries, never migrates)
 *            + active dreams and goals              (loadAgentVisible overview: visible only)
 *            + 5 latest published posts             (post-service listPosts)
 * ```
 *
 * The resume carries the owner's own contact details on purpose (premise 5: `/cv` already
 * publishes them). These two tools are the one token-gated machine-readable exception, which
 * the `loadPublishedResume` comment in `profile-data.ts` records (C7). The owner keeps many
 * CVs; `cv` here is the published one - the one `/cv` prints - and `cvs` names the rest, which
 * `get_cv` reads in full.
 */

export const getProfileTool = defineTool({
  name: 'get_profile',
  title: 'Get one profile section',
  description: [
    "One section of the owner's portfolio profile, returned whole as JSON with a `version` hash.",
    'Sections: identity (name, job titles, description, avatar, location, socials), about (headings, stats, about me),',
    'career (skills, experience, education, certificates), offering (services), work (projects),',
    "cvFile (the public CV file link), resume (the published CV: the printable /cv sheet, including the owner's own contact details).",
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
    "One call for 'who am I': the owner's public profile summary, their published CV (cv: the printable /cv sheet, including their own contact details), the names of all their CVs (cvs: id, label, published), their active goals and dreams from the whiteboard (titles only), and their 5 most recent published posts (titles only). Use get_profile for a whole section, get_cv for one CV, whiteboard_get_item or get_post for detail.",
  scopes: ['read'],
  input: z.object({}),
  annotations: { readOnlyHint: true, openWorldHint: false },
  async run() {
    const [identity, about, resume, cvs, overview, posts] = await Promise.all([
      readProfileSection('identity'),
      readProfileSection('about'),
      readProfileSection('resume'),
      listCvSummaries(),
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
          cvs,
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

export const updateProfileTool = defineTool({
  name: 'update_profile',
  title: 'Edit one profile section',
  description:
    "Replace one section of the owner's public portfolio profile - identity, about, career, offering, work or cvFile - with the version get_profile gave you. Send the WHOLE section value (every field get_profile returned, with your edits); a stale version is refused, so re-read and retry. The resume (the /cv sheet) cannot be written here: CVs have their own tools - get_cv, create_cv, update_cv. Changes the public site immediately.",
  scopes: ['publish'],
  audited: true,
  input: z.object({
    section: z.enum(
      PROFILE_SECTION_KEYS as [ProfileSection, ...ProfileSection[]]
    ),
    version: z.string().min(1).max(32),
    value: z.record(z.string(), z.unknown()),
  }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  async run({ section, version, value }, { setTarget }) {
    setTarget({ kind: 'profile', id: section })
    const result = await patchProfileSection(section, value, version)
    if (!result.ok) return refuse(result.error, result.reason)
    return ok(
      JSON.stringify(
        { section, version: result.version, value: result.value },
        null,
        2
      )
    )
  },
})
