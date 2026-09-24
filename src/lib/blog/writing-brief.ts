import {
  markdownContract,
  SENTENCE_RULES,
  STRUCTURE_TEMPLATES,
  structureFor,
  tellsFor,
  THE_EVIDENCE_LAW,
  THE_METHOD,
  THE_SHAPE,
  WORD_TARGETS,
  type BriefLanguage,
} from '@/lib/blog/brief'

/**
 * The owner's voice as one text an agent can follow: the `write-post` MCP prompt and the
 * `get_writing_brief` tool both return this (mcp.md premise 4).
 *
 * ```
 *   brief.ts (THE_METHOD, THE_SHAPE, THE_EVIDENCE_LAW, SENTENCE_RULES, tellsFor,
 *             markdownContract, STRUCTURE_TEMPLATES via structureFor, WORD_TARGETS)
 *        │  the same constants the server-side generator is briefed with
 *        ▼
 *   buildWritingBrief({ language, kind, structure, loop })
 *        └─ + the agent's loop: draft, lint_draft, fix, create_draft, images, publish
 *             (the steps named only when the token has those tools, C6)
 * ```
 *
 * No second copy of any rule: this only assembles. Two things are adapted for an agent that
 * writes into `create_draft` rather than into the generator's JSON: pictures are placeholders
 * plus `imagePrompts` (owner decision D5), and "unsupported" claims are reported to the owner
 * in the reply instead of in a JSON field.
 */

export const STRUCTURE_NAMES = Object.keys(STRUCTURE_TEMPLATES)

export interface BriefLoop {
  /** The token has create_draft (write). */
  canWrite: boolean
  /** The token has publish_post (publish). */
  canPublish: boolean
}

const bullets = (lines: readonly string[]) =>
  lines.map(line => `- ${line}`).join('\n')

export function buildWritingBrief({
  language,
  kind,
  structure,
  topic,
  loop,
}: {
  language: BriefLanguage
  kind?: string
  structure?: string
  topic?: string
  loop: BriefLoop
}): string {
  const resolved = structureFor({
    manual: structure && STRUCTURE_TEMPLATES[structure] ? structure : undefined,
    style: undefined,
    series: undefined,
    isPillar: false,
  })
  const length = kind ? WORD_TARGETS[kind] : undefined

  const steps = [
    'Draft the post in markdown, following everything above.',
    'Call lint_draft with the draft. Fix every finding, or say in your reply why one does not apply.',
    ...(loop.canWrite
      ? [
          'Call create_draft with the title, markdown, excerpt, kind, series (list_taxonomy has them), language, coverImagePrompt and imagePrompts (one prompt per placeholder key). It never publishes.',
          'For the pictures: call illustrate_post, which starts drawing every placeholder that has a prompt and returns at once. Then poll get_post about every 20 seconds until illustration.state is idle and remaining is 0. If it says failed, read lastError. generate_image draws a single image.',
        ]
      : [
          'This token cannot save drafts (no create_draft in your tool list), so give the owner the finished markdown in your reply.',
        ]),
    loop.canPublish
      ? 'Publish only when the owner asked for it: publish_post, which refuses a post with a missing cover or an unfilled placeholder.'
      : 'Publishing is not in your tool list. Tell the owner the draft is ready to publish from /admin/blog.',
  ]

  return [
    "# Writing brief - the owner's voice",
    topic ? `Topic: ${topic}` : '',
    `Language: ${language === 'vi' ? 'Vietnamese' : 'English'}.${length ? ` Length: ${length}.` : ''}`,
    '## The method',
    bullets(THE_METHOD),
    '## The shape',
    bullets(THE_SHAPE),
    '## The evidence law',
    bullets(THE_EVIDENCE_LAW),
    'You are writing into create_draft, which has no `unsupported` field: list anything you could not support at the end of your reply to the owner instead.',
    '## Sentences',
    bullets([...SENTENCE_RULES, ...tellsFor(language)]),
    '## Markdown',
    bullets([
      ...markdownContract(undefined),
      'Pictures are placeholders: write `![alt text](image1)`, `![alt text](image2)` and so on where each picture goes, with real alt text. Give each key a prompt in imagePrompts, and the cover a prompt in coverImagePrompt. The images are drawn later and never invented as URLs.',
    ]),
    `## Structure: ${resolved}`,
    bullets(STRUCTURE_TEMPLATES[resolved] ?? []),
    `Other structures, by name: ${STRUCTURE_NAMES.filter(name => name !== resolved).join(', ')}.`,
    '## The loop',
    steps.map((step, index) => `${index + 1}. ${step}`).join('\n'),
  ]
    .filter(Boolean)
    .join('\n\n')
}
