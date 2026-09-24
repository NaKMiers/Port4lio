import 'server-only'

import { z } from 'zod'

import { buildWritingBrief } from '@/lib/blog/writing-brief'
import type { PromptDefinition } from '@/lib/mcp/server'

/**
 * The MCP prompts: write-post, weekly-briefing and tailor-cv. In Claude Code they appear as
 * slash commands (`/mcp__port4lio__write-post`).
 * Each is rendered per request from the token's tool list (C6), so "call publish_post" only
 * appears for a token that has it. Clients without prompt support get the same text from
 * `get_writing_brief`.
 */

export const writePostPrompt: PromptDefinition = {
  name: 'write-post',
  title: 'Write a post in my voice',
  description:
    "Draft a blog post in the owner's voice: the brief (method, shape, evidence law, sentence rules, markdown contract, a structure), then the loop - lint_draft, create_draft, illustrate_post, get_post, and publish_post if it is in your tool list.",
  scopes: ['read'],
  args: z.object({
    topic: z.string(),
    language: z.string().optional(),
    kind: z.string().optional(),
  }),
  render(args, tools) {
    return [
      `Write a blog post about: ${args.topic ?? '(the topic the owner gives you)'}`,
      'Before drafting, read what the owner already has on it: get_me, then whiteboard_search for the topic, then whiteboard_get_item for the cards that matter. Cite only what those return - the evidence law below is not a style rule.',
      buildWritingBrief({
        language: args.language === 'en' ? 'en' : 'vi',
        kind: args.kind,
        loop: {
          canWrite: tools.has('create_draft'),
          canPublish: tools.has('publish_post'),
        },
      }),
    ].join('\n\n')
  },
}

export const weeklyBriefingPrompt: PromptDefinition = {
  name: 'weekly-briefing',
  title: 'How did the week go?',
  description:
    'Call get_briefing and write a short review of the period against the one before: blog, subscribers, orders and revenue, the test funnel.',
  scopes: ['read'],
  args: z.object({ period: z.string().optional() }),
  render(args, tools) {
    const period =
      args.period === 'month' || args.period === 'quarter'
        ? args.period
        : 'week'
    return [
      `Call get_briefing with period "${period}". Then write the owner a short review of this ${period} against the one before, in plain sentences:`,
      '- what moved, by how much, and the one or two changes that matter most;',
      '- the top posts, and whether new subscribers or paid orders followed them;',
      '- conversion (paid divided by paywall-seen) per product, only where the section is included.',
      'Report only numbers get_briefing returned. If a section is left out, give its reason in one line instead of estimating it.',
      tools.has('whiteboard_add_item')
        ? 'Then record it: whiteboard_add_item a dated note card titled "Briefing <date>" with the three most important numbers, and whiteboard_link it to any goal card whose numbers moved (whiteboard_search to find them).'
        : '',
    ]
      .filter(Boolean)
      .join('\n')
  },
}

export const tailorCvPrompt: PromptDefinition = {
  name: 'tailor-cv',
  title: 'Tailor my CV to a job posting',
  description:
    "Read the owner's CV and profile with get_me, then return a CV tailored to the posting, as markdown. It never writes the profile: the /cv sheet is edited only in /admin/settings.",
  scopes: ['read'],
  args: z.object({ job_posting: z.string() }),
  render(args) {
    return [
      "Tailor the owner's CV to this job posting:",
      '```',
      args.job_posting ?? '(the owner will paste it)',
      '```',
      "Call get_me first (its cv field is the owner's real CV, contact details included), and get_profile career or work when you need more detail on a project or role.",
      'Then return the tailored CV as markdown, in the same sections the CV already has: lead with the experience and projects that match the posting, reword bullets toward its language where the facts support it, and drop what does not help.',
      'Invent nothing: every role, date, number and skill must come from what get_me or get_profile returned. If the posting asks for something the owner does not have, say so in a short note after the CV instead of adding it.',
      'Do not call update_profile, even if it is in your tool list. The /cv page is a fixed A4 sheet edited only in /admin/settings; the owner pastes what they keep there.',
    ].join('\n')
  },
}

export const PROMPTS: PromptDefinition[] = [
  writePostPrompt,
  weeklyBriefingPrompt,
  tailorCvPrompt,
]
