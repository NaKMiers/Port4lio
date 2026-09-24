import 'server-only'

import { z } from 'zod'

import { defineTool, ok } from '@/lib/mcp/run-tool'
import {
  PROFILE_SECTION_KEYS,
  readProfileSection,
} from '@/lib/profile-sections'

/**
 * "Me" tools: the owner's profile and CV, read as whole sections with a version hash.
 * `get_me`, the one-call summary, lands with `post-service` in phase 2 (C4).
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
