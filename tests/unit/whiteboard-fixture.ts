import type { ContextItem, ContextLink } from '@/lib/whiteboard/context'

/**
 * A FICTIONAL 15-item board, shaped like the design doc's Assignment: 5 dreams or goals,
 * 5 failures, 5 drafts or to-dos. Nothing here is anyone's real life - the Assignment file
 * with real items stays outside the repo on purpose (docs/designs/whiteboard.md).
 *
 * Ids are fixed 24-hex strings so assertions can name them.
 */

export const id = (n: number) => n.toString(16).padStart(24, '0')

const at = (iso: string) => new Date(iso)

export function item(
  n: number,
  overrides: Partial<ContextItem> = {}
): ContextItem {
  return {
    id: id(n),
    form: 'text',
    meaning: null,
    status: null,
    title: `Item ${n}`,
    body: '',
    todos: [],
    shape: null,
    inkBBox: null,
    parentId: null,
    x: 0,
    y: 0,
    width: 240,
    height: 120,
    tags: [],
    when: null,
    targetBy: null,
    createdAt: at('2025-06-01T03:00:00.000Z'),
    updatedAt: at(`2025-06-${String(n).padStart(2, '0')}T03:00:00.000Z`),
    ...overrides,
  }
}

export const FRAME_ORBIT = id(100)
export const FRAME_GARDEN = id(101)

export const frames: ContextItem[] = [
  item(100, {
    form: 'frame',
    title: 'Orbit 2030',
    x: 0,
    y: 0,
    width: 800,
    height: 600,
  }),
  item(101, {
    form: 'frame',
    title: 'Garden',
    x: 1000,
    y: 0,
    width: 600,
    height: 400,
  }),
]

export const items: ContextItem[] = [
  // Dreams and goals
  item(1, {
    meaning: 'goal',
    status: 'active',
    title: 'Ship the lighthouse app',
    body: 'Release a small offline map for sailors.',
    parentId: FRAME_ORBIT,
    x: 20,
    y: 40,
    when: at('2025-03-01T00:00:00.000Z'),
    targetBy: at('2026-06-30T00:00:00.000Z'),
    tags: ['apps', 'sea'],
  }),
  item(2, {
    meaning: 'goal',
    status: 'someday',
    title: 'Learn to juggle five balls',
    parentId: FRAME_ORBIT,
    x: 300,
    y: 40,
  }),
  item(3, {
    meaning: 'dream',
    status: 'active',
    title: 'A cabin with a telescope',
    body: 'Dark skies, a desk, a kettle.',
    x: 2000,
    y: 1000,
  }),
  item(4, {
    meaning: 'dream',
    status: 'done',
    title: 'Row across the lake',
    parentId: FRAME_GARDEN,
    x: 20,
    y: 20,
  }),
  item(5, {
    meaning: 'goal',
    status: 'active',
    title: 'Grow tomatoes from seed',
    parentId: FRAME_GARDEN,
    x: 300,
    y: 20,
  }),
  // Failures
  item(6, {
    meaning: 'failure',
    title: 'The kite shop closed',
    body: 'Nobody flies kites in winter.\n# not a heading',
    parentId: FRAME_ORBIT,
    x: 20,
    y: 300,
    when: at('2024-11-15T00:00:00.000Z'),
  }),
  item(7, { meaning: 'failure', title: 'Missed the marathon', x: 2400, y: 0 }),
  item(8, {
    meaning: 'failure',
    title: 'Burnt the sourdough',
    x: 2400,
    y: 200,
  }),
  item(9, {
    meaning: 'failure',
    title: 'Lost the chess club vote',
    x: 2400,
    y: 400,
  }),
  item(10, {
    meaning: 'failure',
    title: 'Overwatered the basil',
    parentId: FRAME_GARDEN,
    x: 20,
    y: 200,
  }),
  // Drafts and to-dos
  item(11, { meaning: 'draft', title: 'Letter to the harbour master' }),
  item(12, {
    form: 'todo',
    meaning: 'goal',
    status: 'active',
    title: 'Lighthouse launch list',
    parentId: FRAME_ORBIT,
    x: 300,
    y: 300,
    todos: [
      { id: 'a', text: 'Draw the icons', done: true },
      { id: 'b', text: 'Test offline tiles', done: false },
    ],
  }),
  item(13, { form: 'todo', title: '', todos: [] }),
  item(14, { meaning: 'note', title: 'Tide tables are public', x: 3000 }),
  item(15, {
    form: 'ink',
    title: '',
    x: 2400,
    y: 600,
    inkBBox: { minX: 0, minY: 0, maxX: 100, maxY: 50 },
  }),
]

export const links: ContextLink[] = [
  { id: id(201), from: id(6), to: id(1), label: 'learned from' },
  { id: id(202), from: id(12), to: id(1), label: 'part of' },
  { id: id(203), from: id(3), to: id(1), label: 'because' },
  { id: id(204), from: id(10), to: id(5), label: 'blocks' },
]

export const board = { items, frames, links }
