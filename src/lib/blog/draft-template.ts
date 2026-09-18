/**
 * Turn a source comment into a filled-in draft.
 *
 * ## What this replaces, and what was refused
 *
 * "Auto-generate posts" was an explicit request, and a topic-to-post generator was **refused**
 * on the merits: the blog's entire job is to make a reader believe the author thinks well, and
 * to the senior-engineer audience that matters, AI-generated prose is a negative credibility
 * signal. A generated blog fails at the only thing it exists to do.
 *
 * The first replacement was also wrong: a miner that scanned `src/**` and ranked doc comments
 * by "post-worthiness". That is a search engine over roughly eight things the author can
 * already name from memory - `docs/blog/authoring.md` lists them by name, with the file each
 * one lives in. Days of work to rank a list that fits on one screen.
 *
 * What "auto-generate" actually meant was *"I do not want to spend four hours per post"*, and
 * four hours is not mostly writing. It is the blank page, remembering the structure, and
 * re-deriving what makes a post good. So this is the 90% of the miner that had value: paste
 * the comment you already wrote, get a draft with the template filled in and the comment
 * parked where it belongs.
 *
 * ## Why the template arrives as prompts rather than prose
 *
 * Every heading below is a question with the answer left blank. Prose would be something to
 * delete before writing, which is worse than an empty page; a question is something to answer.
 * Section 6 - what I rejected - is the one people skip and the one that signals judgement,
 * so it is spelled out rather than left as a heading.
 */

/** The seven-step structure from `docs/blog/authoring.md`. Keep the two in sync. */
export function buildDraftFromSourceComment({
  comment,
  sourceFile,
}: {
  comment: string
  sourceFile?: string
}): string {
  const attribution = sourceFile
    ? `> Lifted from \`${sourceFile}\`. Check the file still says this before publishing.`
    : '> Lifted from a source comment. Add the file path before publishing.'

  return [
    '## Context',
    '',
    '<!-- What were you building, and why did this come up? Two sentences. -->',
    '',
    '## What I measured',
    '',
    '<!-- The thing you actually ran. Include the command or the code. -->',
    '',
    '## What I expected',
    '',
    '<!-- The documented answer, or the obvious one. Quote the docs if they were wrong. -->',
    '',
    '## What happened',
    '',
    '<!-- The number, the output, the error. This is the part nobody else publishes. -->',
    '',
    '## Root cause',
    '',
    '<!-- Why. -->',
    '',
    '## What I rejected, and why',
    '',
    '<!--',
    '  Do not skip this one. Anyone can report a fix; naming the alternatives you turned down',
    '  and what they would have cost is the part that reads as judgement rather than luck.',
    '-->',
    '',
    "## What I'd tell you",
    '',
    '<!-- One line. If you cannot write it, the post does not have a point yet. -->',
    '',
    '---',
    '',
    '### The original note',
    '',
    attribution,
    '',
    '```',
    comment.trim(),
    '```',
    '',
    '<!--',
    '  Title rule: every `article` title contains a number or a named failure.',
    '    "Five things Next.js 16 did that its docs did not say"   yes',
    '    "revalidateTag did not invalidate anything"              yes',
    '    "Some thoughts on Next.js caching"                       no',
    '',
    '  If this is under ~500 words when you are done, set kind to `note` and ship it.',
    '  Eight notes and two articles is the cadence - the notes are what keep it alive.',
    '-->',
    '',
  ].join('\n')
}
