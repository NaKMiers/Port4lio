/**
 * Prompts for pictures, written by the model that cannot draw them.
 *
 * ```
 *   the router has no image model
 *            │
 *            ▼
 *   so ask it for the BRIEF instead ──▶ author pastes it into whatever tool they use
 *            │
 *            ├─ at generation time:  one cover prompt + one per ![image](imageN)
 *            └─ on demand:           POST /api/admin/blog/<id>/image-prompt
 * ```
 *
 * ## Why the rules below are a closed list and not "write a good prompt"
 *
 * Asked without them, a model writes prompts in the register of stock photography - "a team
 * of diverse professionals collaborating in a modern office" - which is both the least useful
 * illustration for a post about `revalidatePath` and the most recognisable filler on the
 * internet. Every rule here removes one specific default.
 *
 * The lettering rule is the one that is not taste. Image models garble text: a diagram
 * labelled `revalidatePath` comes back labelled `revaliadtePaht`, and on a technical post
 * that is worse than no diagram, because it looks like the author did not read their own
 * illustration. So prompts describe shapes and scenes, never words to render.
 *
 * ## Why this file is pure and imports nothing but the placeholder helpers
 *
 * Same rule as `generation-fields.ts`. Nothing here touches mongoose, so the prompt text can
 * be unit-tested with no database and no network, which is the only way the rules above stay
 * honest - they are assertions about a string, and a test can read a string.
 */

/**
 * The house rules for a text-to-image prompt, shared by both callers.
 *
 * Both paths must produce prompts in the same register, because they land in the same post:
 * a cover written at generation time and a replacement body image regenerated two days later
 * have to look like they belong to one article. One list, quoted into both system messages.
 */
export const IMAGE_PROMPT_RULES = [
  'No text, lettering, labels, captions, watermarks or UI chrome in the image. Image models garble words, and a diagram with a misspelled API name is worse than no diagram.',
  'No logos and no real brand marks.',
  'Describe a concrete scene or object, not an abstraction. "A single desk lamp lighting a stack of printed server logs" beats "the concept of observability".',
  'Name the medium and the palette: photograph, isometric 3D render, ink illustration, matte painting - then two or three colours.',
  'Name the composition and the lighting: what is in the foreground, what is behind it, where the light comes from.',
  "No people's faces. A hand, a silhouette or a figure from behind is fine; a portrait dates the post and makes it about someone.",
  'One paragraph, under 60 words. A prompt longer than that is a prompt where the model picks which half to follow.',
]

/** Wide, because that is the frame the cover is cropped to on every surface that shows it. */
const COVER_FRAMING =
  'Wide 1200x630 landscape framing, with the subject off-centre and room around it - the sides get cropped on some share cards.'

/** Body images render inside the editorial column, so they are read at about 700px wide. */
const BODY_FRAMING =
  'Landscape 16:9 framing. It renders about 700px wide inside a column of text, so one clear subject rather than a busy scene.'

export type ImagePromptTarget =
  | { kind: 'cover' }
  /** `key` is the `imageN` the prompt belongs to; `context` is the prose around it. */
  | { kind: 'body'; key: string; context: string }

export function buildImagePromptRequest({
  target,
  title,
  excerpt,
  bodyMarkdown,
}: {
  target: ImagePromptTarget
  title: string
  excerpt: string
  bodyMarkdown: string
}): { system: string; user: string } {
  const system = [
    'You write prompts for a text-to-image model. You are given a blog post and asked for one prompt for one picture.',
    '',
    '# Rules',
    ...IMAGE_PROMPT_RULES.map(rule => `- ${rule}`),
    '',
    '# Output',
    'Return ONE JSON object and nothing else: {"prompt": "..."}. No prose around it, no code fence.',
  ].join('\n')

  const user =
    target.kind === 'cover'
      ? [
          '# The post',
          `Title: ${title}`,
          excerpt ? `Excerpt: ${excerpt}` : '',
          '',
          '# The body',
          clip(bodyMarkdown, BODY_CLIP_CHARS),
          '',
          '# The picture',
          "The cover image. It is the share card on LinkedIn and DEV and the thumbnail in the post list, so it has to read at thumbnail size and carry the post's subject rather than its mood.",
          COVER_FRAMING,
          '',
          'Return the JSON object now.',
        ]
          .filter(Boolean)
          .join('\n')
      : [
          '# The post',
          `Title: ${title}`,
          excerpt ? `Excerpt: ${excerpt}` : '',
          '',
          '# Where this picture goes',
          /*
            The surrounding prose rather than the whole post, and this is the difference
            between a useful prompt and a second cover. A body image illustrates the paragraph
            it sits in; handed only the title, the model writes another picture of the
            article's subject, and the post ends up with three images of the same idea.
          */
          `It replaces the placeholder \`${target.key}\`, here:`,
          '',
          target.context,
          '',
          '# The picture',
          BODY_FRAMING,
          'Illustrate the passage above, not the post as a whole.',
          '',
          'Return the JSON object now.',
        ]
          .filter(Boolean)
          .join('\n')

  return { system, user }
}

/** How much of the body the cover prompt is shown. Enough for the subject, not the whole post. */
const BODY_CLIP_CHARS = 4000

/** Characters of prose either side of a placeholder handed to a body-image prompt. */
export const CONTEXT_WINDOW_CHARS = 700

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n...`
}

/**
 * The prose around one placeholder, for the prompt above.
 *
 * Falls back to the head of the post when the key is not in the body - which happens when the
 * author deletes a placeholder and then asks to regenerate its prompt from a card that has
 * not re-rendered yet. A prompt written from the wrong context beats an error dialog for
 * something this recoverable.
 */
export function contextAround(markdown: string, key: string): string {
  const index = markdown.indexOf(`(${key})`)
  if (index === -1) return clip(markdown, CONTEXT_WINDOW_CHARS * 2)

  const start = Math.max(0, index - CONTEXT_WINDOW_CHARS)
  const end = Math.min(markdown.length, index + CONTEXT_WINDOW_CHARS)

  return `${start > 0 ? '...' : ''}${markdown.slice(start, end)}${end < markdown.length ? '...' : ''}`
}

/** Bound on a stored prompt, matching `coverImagePrompt`'s `maxlength` on the schema. */
export const MAX_IMAGE_PROMPT_CHARS = 2000

/**
 * Normalise one prompt from a model, or from an author typing into the textarea.
 *
 * Newlines are collapsed because the field is a two-line textarea whose entire job is to be
 * copied into somebody else's input box, and a prompt with hard line breaks pasted into one
 * of those is a prompt that submits halfway through.
 */
export function normaliseImagePrompt(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.replace(/\s+/g, ' ').trim().slice(0, MAX_IMAGE_PROMPT_CHARS)
}
