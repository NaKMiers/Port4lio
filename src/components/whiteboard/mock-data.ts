import type { Form, Meaning, Shape, Status } from '@/lib/whiteboard/limits'

/**
 * A board's worth of sample content: "Add sample data" (D33).
 *
 * ```
 *   ┌ 2026 ─────────────────────────┐
 *   │ dream · goal · goal(done)     │   a frame with four cards inside it
 *   │ to-do                         │
 *   └───────────────────────────────┘
 *     failure ──because──▶ goal          links carry the reasoning, which is the point
 *     draft   ──about────▶ failure
 *     note (hidden from AI)              one card the agents cannot read, so the badge shows
 * ```
 *
 * ## Why this exists
 *
 * An empty canvas does not show what the board is for. Meanings, frames, labelled links and
 * the privacy badge only make sense together, and typing fifteen cards to see them together
 * is a tax on every new board, every demo and every test of the rendering. It is also the
 * quickest way to have something real on screen while working on the canvas itself.
 *
 * ## Why it is a pure function
 *
 * No ids, no dates, no randomness: positions are relative to a point the caller picks and
 * the ids are minted by the board action, so the same seed can be dropped on any board at
 * any zoom, and `tests/unit` can check the shape of it (every link end exists, every child
 * is inside its frame) without a canvas or a database.
 */

export interface MockItem {
  /** Referenced by `MockLink`, and by a child's `parent`. Not an id - the action mints those. */
  key: string
  form: Form
  title: string
  body?: string
  meaning?: Meaning
  status?: Status
  shape?: Shape
  todos?: { text: string; done: boolean }[]
  tags?: string[]
  when?: string
  targetBy?: string
  includeInAi?: boolean
  /**
   * Top-left. Relative to the frame for a card with a `parent` (which is how the model
   * stores a child), relative to the dropped point for everything else.
   */
  x: number
  y: number
  width: number
  height: number
  parent?: string
}

export interface MockLink {
  from: string
  to: string
  label: string
}

export interface MockBoard {
  items: MockItem[]
  links: MockLink[]
}

/**
 * `year` only ever fills in the sample dates, so the cards read as this year's rather than
 * as something from whenever this file was written.
 */
export function mockBoard(year = new Date().getFullYear()): MockBoard {
  const items: MockItem[] = [
    {
      key: 'frame',
      form: 'frame',
      title: `${year}`,
      x: -320,
      y: -260,
      width: 560,
      height: 380,
    },
    {
      key: 'dream',
      form: 'text',
      parent: 'frame',
      meaning: 'dream',
      status: 'active',
      title: 'Build something people keep using',
      body: 'Not a launch. Something that is still open in a tab in six months.',
      tags: ['north-star'],
      x: 32,
      y: 64,
      width: 240,
      height: 120,
    },
    {
      key: 'goal',
      form: 'text',
      parent: 'frame',
      meaning: 'goal',
      status: 'active',
      title: 'Ship the whiteboard',
      body: 'Canvas, agent reads, backup. Done when I use it without thinking about it.',
      targetBy: `${year}-12-31`,
      x: 296,
      y: 64,
      width: 240,
      height: 120,
    },
    {
      key: 'done',
      form: 'text',
      parent: 'frame',
      meaning: 'goal',
      status: 'done',
      title: 'Write the design doc first',
      body: 'Seven passes before a line of code. It caught the privacy rule.',
      when: `${year}-03-14`,
      x: 296,
      y: 216,
      width: 240,
      height: 120,
    },
    {
      key: 'todo',
      form: 'todo',
      parent: 'frame',
      title: 'This week',
      todos: [
        { text: 'Read back last month of notes', done: true },
        { text: 'One card per idea, no essays', done: false },
        { text: 'Link the failures to what they taught', done: false },
      ],
      x: 32,
      y: 216,
      width: 240,
      height: 140,
    },
    {
      key: 'failure',
      form: 'text',
      meaning: 'failure',
      title: 'Rewrote it twice before asking anyone',
      body: 'Two weekends. The first person I showed it to used it in a way I had not built.',
      when: `${year}-01-22`,
      tags: ['learned'],
      x: -320,
      y: 180,
      width: 240,
      height: 130,
    },
    {
      key: 'draft',
      form: 'text',
      meaning: 'draft',
      title: 'Post: what the save queue taught me',
      body: 'Ordering, retries, and the rule that a deleted card never comes back.',
      x: -40,
      y: 180,
      width: 240,
      height: 130,
    },
    {
      key: 'private',
      form: 'text',
      meaning: 'note',
      title: 'Not for the agents',
      body: 'A card with the AI toggle off. Nothing here reaches an export or an MCP call.',
      includeInAi: false,
      x: 240,
      y: 180,
      width: 240,
      height: 130,
    },
    {
      key: 'shape',
      form: 'shape',
      shape: 'diamond',
      title: 'Worth it?',
      x: -40,
      y: 356,
      width: 180,
      height: 140,
    },
    {
      key: 'note',
      form: 'text',
      meaning: 'note',
      title: 'Drag a card into the frame to file it',
      body: 'A frame holds what is inside it, and hiding the frame hides all of it.',
      x: 240,
      y: 356,
      width: 240,
      height: 120,
    },
  ]

  const links: MockLink[] = [
    { from: 'failure', to: 'goal', label: 'because' },
    { from: 'draft', to: 'failure', label: 'about' },
    { from: 'goal', to: 'dream', label: 'serves' },
    { from: 'done', to: 'goal', label: 'led to' },
    { from: 'shape', to: 'draft', label: 'decides' },
  ]

  return { items, links }
}
