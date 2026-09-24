import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  LIMITS,
  deriveInkBBox,
  isSingleLine,
  parseDay,
  validateBackupFile,
  validateBoardPatch,
  validateBulkUpdates,
  validateItem,
  validateItemPatch,
  validateLink,
  validateLinkPatch,
  validateSlug,
} from '@/lib/whiteboard/limits'
import { DEFAULT_VOCAB, normalizeStatus } from '@/lib/whiteboard/vocab'

/**
 * The caps the inspector, the routes and the restore pre-check all share. If one of these
 * verdicts changes, it changes for all three at once - which is the point of the module.
 */

const ID = 'aaaaaaaaaaaaaaaaaaaaaaaa'
const OTHER = 'bbbbbbbbbbbbbbbbbbbbbbbb'

describe('the module stays client-safe', () => {
  it('imports nothing server-side', () => {
    const source = readFileSync(
      path.resolve(__dirname, '../../src/lib/whiteboard/limits.ts'),
      'utf8'
    )
    expect(source).not.toMatch(/from ['"](mongoose|server-only|next\/)/)
    expect(source).not.toMatch(/^import /m)
  })
})

describe('single-line rule', () => {
  it.each(['a\nb', 'a\rb', 'a\u2028b'])('rejects %j', value => {
    expect(isSingleLine(value)).toBe(false)
    const result = validateItem({ _id: ID, form: 'text', title: value })
    expect(result.ok).toBe(false)
  })

  it('applies to todo rows, tags and link labels', () => {
    expect(
      validateItem({
        _id: ID,
        form: 'todo',
        todos: [{ id: 'a', text: 'x\ny', done: false }],
      }).ok
    ).toBe(false)
    expect(validateItem({ _id: ID, form: 'text', tags: ['a\nb'] }).ok).toBe(
      false
    )
    expect(
      validateLink({
        _id: ID,
        from: ID.replace(/a/g, 'c'),
        to: OTHER,
        label: 'a\nb',
      }).ok
    ).toBe(false)
  })
})

describe('caps', () => {
  const base = { _id: ID, form: 'text' }

  it.each([
    ['title', 'x'.repeat(LIMITS.title), 'x'.repeat(LIMITS.title + 1)],
    ['body', 'x'.repeat(LIMITS.body), 'x'.repeat(LIMITS.body + 1)],
  ])('%s: accepts the cap, rejects one over', (key, atCap, over) => {
    expect(validateItem({ ...base, [key]: atCap }).ok).toBe(true)
    expect(validateItem({ ...base, [key]: over })).toMatchObject({
      ok: false,
      status: 400,
    })
  })

  it('caps todo rows and their text', () => {
    const row = (i: number, text = 'x') => ({ id: `r${i}`, text, done: false })
    const todo = { _id: ID, form: 'todo' }
    expect(
      validateItem({
        ...todo,
        todos: Array.from({ length: 100 }, (_, i) => row(i)),
      }).ok
    ).toBe(true)
    expect(
      validateItem({
        ...todo,
        todos: Array.from({ length: 101 }, (_, i) => row(i)),
      }).ok
    ).toBe(false)
    expect(validateItem({ ...todo, todos: [row(0, 'x'.repeat(500))] }).ok).toBe(
      true
    )
    expect(validateItem({ ...todo, todos: [row(0, 'x'.repeat(501))] }).ok).toBe(
      false
    )
  })

  it('caps tags: 20 of <= 40 chars', () => {
    expect(
      validateItem({
        ...base,
        tags: Array.from({ length: 20 }, (_, i) => `t${i}`),
      }).ok
    ).toBe(true)
    expect(
      validateItem({
        ...base,
        tags: Array.from({ length: 21 }, (_, i) => `t${i}`),
      }).ok
    ).toBe(false)
    expect(validateItem({ ...base, tags: ['x'.repeat(41)] }).ok).toBe(false)
  })

  it('caps link labels at 80', () => {
    const link = { _id: ID, from: OTHER, to: 'cccccccccccccccccccccccc' }
    expect(validateLink({ ...link, label: 'x'.repeat(80) }).ok).toBe(true)
    expect(validateLink({ ...link, label: 'x'.repeat(81) }).ok).toBe(false)
    expect(validateLinkPatch({ label: 'x'.repeat(81) }).ok).toBe(false)
  })

  it('rejects ink over 2,000 points with 413', () => {
    const points = (n: number) =>
      Array.from({ length: n }, (_, i) => [i, i, 0.5])
    const ink = { _id: ID, form: 'ink' }
    expect(validateItem({ ...ink, ink: { points: points(2_000) } }).ok).toBe(
      true
    )
    expect(
      validateItem({ ...ink, ink: { points: points(2_001) } })
    ).toMatchObject({
      ok: false,
      status: 413,
    })
  })

  it('caps bulk updates at 500', () => {
    const entry = (i: number) => ({
      id: i.toString(16).padStart(24, '0'),
      x: 0,
      y: 0,
      parentId: null,
    })
    expect(
      validateBulkUpdates({
        updates: Array.from({ length: 500 }, (_, i) => entry(i)),
      }).ok
    ).toBe(true)
    expect(
      validateBulkUpdates({
        updates: Array.from({ length: 501 }, (_, i) => entry(i)),
      }).ok
    ).toBe(false)
  })
})

describe('item shape rules', () => {
  it('requires an ObjectId and a known form', () => {
    expect(validateItem({ _id: 'nope', form: 'text' }).ok).toBe(false)
    expect(validateItem({ _id: ID, form: 'sticker' }).ok).toBe(false)
  })

  it('forbids a frame inside a frame', () => {
    expect(
      validateItem({ _id: ID, form: 'frame', parentId: OTHER })
    ).toMatchObject({
      ok: false,
      error: 'A frame cannot be inside another frame.',
    })
  })

  it('needs a shape on a shape and ink on an ink', () => {
    expect(validateItem({ _id: ID, form: 'shape' }).ok).toBe(false)
    expect(validateItem({ _id: ID, form: 'shape', shape: 'ellipse' }).ok).toBe(
      true
    )
    expect(validateItem({ _id: ID, form: 'ink' }).ok).toBe(false)
  })

  it('checks a meaning and status for shape only; the list decides the rest (vocab.ts)', () => {
    // Any well-formed key passes here - whether it exists is data.ts's question.
    const custom = validateItem({
      _id: ID,
      form: 'text',
      meaning: 'side-project',
      status: 'blocked',
    })
    expect(custom.ok && custom.value).toMatchObject({
      meaning: 'side-project',
      status: 'blocked',
    })
    for (const meaning of ['Goal', '1goal', 'a b', 'x'.repeat(33), 7])
      expect(
        validateItem({ _id: ID, form: 'text', meaning }).ok,
        String(meaning)
      ).toBe(false)
    // Status next to a meaning without one is dropped - by the list's rule.
    expect(normalizeStatus(DEFAULT_VOCAB, 'note', 'active')).toBeNull()
    expect(normalizeStatus(DEFAULT_VOCAB, 'goal', 'active')).toBe('active')
  })

  it('defaults includeInAi to true', () => {
    const result = validateItem({ _id: ID, form: 'text' })
    expect(result.ok && result.value.includeInAi).toBe(true)
  })

  it('drops a client-sent ink bbox (D27: the server derives it)', () => {
    const result = validateItem({
      _id: ID,
      form: 'ink',
      ink: {
        points: [
          [0, 0],
          [10, 5],
        ],
        bbox: { minX: -999, minY: 0, maxX: 0, maxY: 0 },
      },
    })
    expect(result.ok && result.value.ink).toEqual({
      points: [
        [0, 0, 0.5],
        [10, 5, 0.5],
      ],
    })
  })
})

describe('patch', () => {
  it('keeps only the keys that were sent (R3-1)', () => {
    const result = validateItemPatch({ title: 'New' })
    expect(result).toEqual({ ok: true, value: { title: 'New' } })
  })

  it('refuses to change _id or form', () => {
    expect(validateItemPatch({ form: 'ink' }).ok).toBe(false)
  })

  it('refuses an empty patch', () => {
    expect(validateItemPatch({}).ok).toBe(false)
  })
})

describe('share link (board patch)', () => {
  it('accepts the three share modes and nothing else', () => {
    for (const share of ['off', 'view', 'edit'])
      expect(validateBoardPatch({ share })).toEqual({
        ok: true,
        value: { share },
      })
    for (const share of ['public', '', null, true])
      expect(validateBoardPatch({ share }).ok).toBe(false)
  })

  it('trims and lowercases a slug before checking it', () => {
    expect(validateSlug('  Q3-Plan ')).toEqual({ ok: true, value: 'q3-plan' })
  })

  it('refuses a slug with spaces, stray hyphens, symbols or the wrong length', () => {
    for (const slug of [
      'q3 plan',
      '-plan',
      'plan-',
      'q3--plan',
      'plan/../x',
      'ab',
      'a'.repeat(65),
      'ké-hoạch',
    ])
      expect(validateSlug(slug).ok, slug).toBe(false)
    expect(validateSlug('a'.repeat(64)).ok).toBe(true)
    expect(validateSlug(3).ok).toBe(false)
  })

  it('refuses a slug that looks like a board id, so /whiteboard/<key> means one board', () => {
    expect(validateSlug(ID).ok).toBe(false)
    expect(validateSlug(ID.toUpperCase()).ok).toBe(false)
    // One character off is not an id, so it is a fine name.
    expect(validateSlug(`${ID}a`).ok).toBe(true)
  })

  it('reads null and an empty string as "clear the slug"', () => {
    expect(validateBoardPatch({ slug: null })).toEqual({
      ok: true,
      value: { slug: null },
    })
    expect(validateBoardPatch({ slug: '' })).toEqual({
      ok: true,
      value: { slug: null },
    })
    expect(validateBoardPatch({ slug: '   ' })).toEqual({
      ok: true,
      value: { slug: null },
    })
  })

  it('combines share and slug in one patch, and still refuses an empty one', () => {
    expect(validateBoardPatch({ share: 'view', slug: 'Roadmap' })).toEqual({
      ok: true,
      value: { share: 'view', slug: 'roadmap' },
    })
    expect(validateBoardPatch({}).ok).toBe(false)
  })
})

describe('bulk updates', () => {
  it('names the bad entry', () => {
    const result = validateBulkUpdates({
      updates: [
        { id: ID, x: 1, y: 2, parentId: null },
        { id: OTHER, x: 'nope', y: 2, parentId: null },
      ],
    })
    expect(result).toMatchObject({ ok: false, index: 1, id: OTHER })
  })
})

describe('dates', () => {
  it('stores a day as UTC midnight and rejects impossible days', () => {
    expect(parseDay('2025-03-14')?.toISOString()).toBe(
      '2025-03-14T00:00:00.000Z'
    )
    expect(parseDay('2025-03-14T00:00:00.000Z')?.toISOString()).toBe(
      '2025-03-14T00:00:00.000Z'
    )
    expect(parseDay('2025-02-30')).toBeUndefined()
    expect(parseDay(null)).toBeNull()
  })
})

describe('ink bbox', () => {
  it('derives the bounds from the points', () => {
    expect(
      deriveInkBBox([
        [5, -2, 0.5],
        [-3, 7, 0.5],
        [1, 1, 0.5],
      ])
    ).toEqual({ minX: -3, minY: -2, maxX: 5, maxY: 7 })
  })
})

describe('backup file pre-check', () => {
  const frame = { _id: ID, form: 'frame', title: 'F' }
  const child = { _id: OTHER, form: 'text', parentId: ID }

  it('accepts a well-formed file', () => {
    const result = validateBackupFile({
      version: 1,
      exportedAt: '2026-01-01T00:00:00.000Z',
      items: [frame, child],
      links: [
        { _id: 'cccccccccccccccccccccccc', from: ID, to: OTHER, label: 'x' },
      ],
    })
    expect(result.ok).toBe(true)
  })

  it('names the entry and why', () => {
    const result = validateBackupFile({
      version: 1,
      exportedAt: '',
      items: [frame, { ...child, title: 'a\nb' }],
      links: [],
    })
    expect(result).toEqual({
      ok: false,
      error: 'items[1]: title must be a single line.',
    })
  })

  it('refuses a parent that is not a frame in the file', () => {
    const result = validateBackupFile({
      version: 1,
      exportedAt: '',
      items: [child],
      links: [],
    })
    expect(result.ok).toBe(false)
  })

  it('refuses a wrong version', () => {
    expect(validateBackupFile({ version: 2, items: [], links: [] }).ok).toBe(
      false
    )
  })
})
