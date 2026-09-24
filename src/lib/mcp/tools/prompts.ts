import 'server-only'

import { z } from 'zod'

import { buildWritingBrief } from '@/lib/blog/writing-brief'
import type { PromptDefinition } from '@/lib/mcp/server'

/**
 * The MCP prompts. In Claude Code they appear as slash commands (`/mcp__port4lio__write-post`).
 * Each is rendered per request from the token's tool list (C6), so "call publish_post" only
 * appears for a token that has it. Clients without prompt support get the same text from
 * `get_writing_brief`.
 */

export const writePostPrompt: PromptDefinition = {
  name: 'write-post',
  title: 'Write a post in my voice',
  description:
    "Draft a blog post in the owner's voice: the brief (method, shape, evidence law, sentence rules, markdown contract, a structure), then the loop - lint_draft, create_draft, illustrate_post, get_post, and publish_post when your token has it.",
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

export const PROMPTS: PromptDefinition[] = [writePostPrompt]
