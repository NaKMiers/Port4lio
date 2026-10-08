import 'server-only'

import { z } from 'zod'

import { buildWritingBrief } from '@/lib/blog/writing-brief'
import type { PromptDefinition } from '@/lib/mcp/server'

/**
 * The MCP prompts: write-post, weekly-briefing, tailor-cv and build-whiteboard. In Claude Code they appear as
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

/**
 * Tailoring writes a COPY, never the live CV (multi-cv-plan.md Phase 2): `/cv` is a fixed A4
 * sheet that clips text running long, only a browser can measure that, and the owner checks
 * it in `/admin/settings`. A token without `create_cv` gets the old markdown answer instead.
 */
export const tailorCvPrompt: PromptDefinition = {
  name: 'tailor-cv',
  title: 'Tailor my CV to a job posting',
  description:
    "Tailor the owner's CV to a job posting: copy the published CV (create_cv) and tailor the copy (update_cv), or, without write access, return the tailored CV as markdown. It never publishes unless the owner asks; the owner checks the page fit in /admin/settings.",
  scopes: ['read'],
  args: z.object({ job_posting: z.string() }),
  render(args, tools) {
    const posting = [
      "Tailor the owner's CV to this job posting:",
      '```',
      args.job_posting ?? '(the owner will paste it)',
      '```',
    ]
    const tailoring =
      'Lead with the experience and projects that match the posting, reword bullets toward its language where the facts support it, and drop what does not help.'
    const inventNothing =
      'Invent nothing: every role, date, number and skill must come from what get_me, get_cv or get_profile returned. If the posting asks for something the owner does not have, say so in a short note to the owner instead of adding it.'

    if (!tools.has('create_cv') || !tools.has('update_cv'))
      return [
        ...posting,
        "Call get_me first (its cv field is the owner's real CV, contact details included), and get_profile career or work when you need more detail on a project or role.",
        `Then return the tailored CV as markdown, in the same sections the CV already has. ${tailoring}`,
        inventNothing,
        'Do not call update_profile, even if it is in your tool list. This token cannot write CVs, so the owner pastes what they keep into a CV in /admin/settings; a token with the write scope would let you save it as a new CV directly.',
      ].join('\n')

    return [
      ...posting,
      [
        '1. Read. Call get_me (cv is the published CV, cvs names every CV), then get_profile career or work when you need more detail on a project or role.',
        '2. Copy. Call create_cv with a label naming the posting (for example "Acme - Senior TypeScript") and a clientRef. Leave fromId out: it copies the published CV. Never edit the published CV itself.',
        "3. Read the copy. Call get_cv with the new id: it returns the CV exactly as stored, and its version. Keep photo '' as it is - that means the masthead follows the owner's avatar.",
        `4. Tailor. Call update_cv once with the id, the version and the WHOLE resume with your edits, in the sections it already has. ${tailoring} Keep it to what fits two A4 pages: shorten rather than add.`,
        '5. Report. Tell the owner the label of the new CV, what you changed and why, and that it is not published: they should open it in /admin/settings to check the page fit (the page is fixed A4 and clips text that runs long), then Save CV.',
      ].join('\n'),
      inventNothing,
      'Do not call publish_cv unless the owner asks you to publish it. Do not call update_profile.',
    ].join('\n\n')
  },
}

/**
 * Composition, not geometry: the server lays the board out (`whiteboard_compose`), so what
 * this prompt teaches is what makes a board worth reading - a shape the topic actually has,
 * few sections, short cards, meaning as the colour, and arrows only where they say something.
 */
export const buildWhiteboardPrompt: PromptDefinition = {
  name: 'build-whiteboard',
  title: 'Build a whiteboard',
  description:
    'Plan and compose a complete, laid-out whiteboard on a topic with whiteboard_compose: pick a layout, outline 3-8 sections of short cards with meanings, link what depends on what, then check the result and tidy it with whiteboard_arrange.',
  scopes: ['read'],
  args: z.object({
    topic: z.string(),
    layout: z.string().optional(),
  }),
  render(args, tools) {
    const layout =
      args.layout === 'columns' ||
      args.layout === 'grid' ||
      args.layout === 'timeline' ||
      args.layout === 'mindmap'
        ? args.layout
        : null
    if (!tools.has('whiteboard_compose'))
      return [
        `The owner wants a whiteboard about: ${args.topic ?? '(the topic they give you)'}`,
        'This token cannot write to the whiteboard (whiteboard_compose is not in your tool list). Write the outline as markdown instead - sections as headings, cards as bullets with their meaning in brackets - so the owner can build it, and say that a write token would let you build it directly.',
      ].join('\n\n')

    return [
      `Build a whiteboard about: ${args.topic ?? '(the topic the owner gives you)'}`,
      [
        '1. Read first. Call whiteboard_overview: it lists the boards you can write to, the meanings and statuses (the only keys cards take), and what already exists. whiteboard_search the topic, so you link to cards the owner already has instead of duplicating them.',
        `2. Pick the layout the topic has${layout ? ` - the owner asked for '${layout}'` : ''}: 'timeline' for phases or a plan over time, 'columns' for stages or categories read left to right, 'mindmap' for one idea and its facets, 'grid' for many peer groups.`,
        '3. Outline before calling. 3-8 sections, each a frame with a 1-4 word title. 2-8 cards per section. A card title is the point itself in under 60 characters ("Ship the API by March", not "API"); the body adds at most 4 short lines of why or how. A checklist is one todo card, not many text cards. Use a shape card for a callout, a decision or a question.',
        '4. Colour with meaning. Every card that is a goal, dream, failure, draft or note gets that meaning, and a status where the meaning tracks one - meaning is the only colour the board has. Do not give every card the same one.',
        "5. Link sparingly. Only arrows that say something - serves, blocks, leads to, depends on - with that label. Refs you choose (e.g. goals.ship-api) let you link cards before they have ids; link to the owner's existing cards by id. Timeline and mindmap draw their own structural arrows.",
        '6. Compose once. One whiteboard_compose call with a clientRef, and a heading that names the board. Use newBoard for a new topic the owner has no board for; otherwise boardId. Over 150 items: two calls, the second on the returned boardId.',
        '7. Check and tidy. Read the result: bounds and the ref -> id map. whiteboard_get_item a couple of the ids if you want to confirm. Fix a misplaced or unwanted item with whiteboard_arrange; never try to change cards the owner wrote.',
        '8. Report. Tell the owner the board path from the result, the sections you made, and anything you left out.',
      ].join('\n'),
      'Invent no facts about the owner: what you put on the board about them comes from get_me, whiteboard_search or what they told you. General knowledge about the topic is fine, written as such.',
    ].join('\n\n')
  },
}

export const PROMPTS: PromptDefinition[] = [
  writePostPrompt,
  weeklyBriefingPrompt,
  tailorCvPrompt,
  buildWhiteboardPrompt,
]
