import { describe, expect, it } from 'vitest'

import {
  BoardLoadError,
  readBoardStream,
} from '@/components/whiteboard/board-loader'
import {
  absoluteOrigin,
  movePatch,
  readableChildren,
  resolveMembership,
  skipsBulkAiOn,
  type Placeable,
} from '@/components/whiteboard/frame-geometry'
import { deletePlan, deletedText } from '@/components/whiteboard/delete-plan'
import {
  ICONS,
  TONE_CLS,
  meaningStyle,
} from '@/components/whiteboard/meaning-style'
import { mockBoard } from '@/components/whiteboard/mock-data'
import { newObjectId } from '@/components/whiteboard/object-id'
import {
  TOOL_KEYS,
  canvasNodeId,
  escapeTarget,
  shortcutFor,
} from '@/components/whiteboard/shortcuts'
import {
  validateBoard,
  validateBoardPatch,
  validateItem,
} from '@/lib/whiteboard/limits'
import type { BoardLine, ClientItem, ClientLink } from '@/lib/whiteboard/types'
import { DEFAULT_VOCAB, VOCAB_ICONS, VOCAB_TONES } from '@/lib/whiteboard/vocab'

describe('frame membership and coordinates', () => {
  const frame: Placeable = {
    id: 'F',
    form: 'frame',
    parentId: null,
    x: 100,
    y: 100,
    width: 400,
    height: 300,
  }
  const card = {
    id: 'C',
    form: 'text',
    parentId: null,
    width: 100,
    height: 50,
  }

  it('joins a frame when the centre lands inside, converting to relative', () => {
    expect(resolveMembership(card, { x: 150, y: 150 }, [frame])).toEqual({
      parentId: 'F',
      x: 50,
      y: 50,
      changed: true,
      left: null,
    })
  })

  it('stays out when only an edge overlaps (centre rule)', () => {
    // Centre at (70, 125): left of the frame.
    expect(resolveMembership(card, { x: 20, y: 100 }, [frame])).toMatchObject({
      parentId: null,
      changed: false,
    })
  })

  it('leaves a frame, converting back to absolute, and names the frame it left', () => {
    expect(
      resolveMembership({ ...card, parentId: 'F' }, { x: 700, y: 700 }, [frame])
    ).toEqual({ parentId: null, x: 700, y: 700, changed: true, left: 'F' })
  })

  it('a frame never joins a frame', () => {
    expect(
      resolveMembership(
        { ...frame, id: 'G', width: 10, height: 10 },
        { x: 150, y: 150 },
        [frame]
      )
    ).toMatchObject({ parentId: null, changed: false })
  })

  it('absoluteOrigin adds the parent offset', () => {
    const frames = new Map([['F', frame]])
    expect(absoluteOrigin({ x: 5, y: 6, parentId: 'F' }, frames)).toEqual({
      x: 105,
      y: 106,
    })
    expect(absoluteOrigin({ x: 5, y: 6, parentId: null }, frames)).toEqual({
      x: 5,
      y: 6,
    })
  })

  it('round-trips: join then leave returns the same absolute position', () => {
    const joined = resolveMembership(card, { x: 222, y: 180 }, [frame])
    const abs = absoluteOrigin(joined, new Map([['F', frame]]))
    expect(abs).toEqual({ x: 222, y: 180 })
  })

  it('a drop out of a hidden frame writes includeInAi: false (rule 8)', () => {
    const left = { x: 5, y: 6, parentId: null, changed: true }
    expect(movePatch(left, true)).toEqual({
      x: 5,
      y: 6,
      parentId: null,
      includeInAi: false,
    })
    // Out of a visible frame the flag is not sent at all (R3-1: only what changed).
    expect(movePatch(left, false)).toEqual({ x: 5, y: 6, parentId: null })
    expect(
      movePatch({ x: 1, y: 2, parentId: 'F', changed: false }, false)
    ).toEqual({ x: 1, y: 2 })
  })
})

describe('the D24 un-hide count', () => {
  it('counts the children whose own flag is on, nothing else', () => {
    const items = [
      { parentId: 'H', includeInAi: true },
      { parentId: 'H', includeInAi: true },
      { parentId: 'H', includeInAi: false }, // stays hidden after the un-hide
      { parentId: 'V', includeInAi: true }, // another frame
      { parentId: null, includeInAi: true },
    ]
    expect(readableChildren('H', items)).toBe(2)
    expect(readableChildren('none', items)).toBe(0)
  })
})

describe('Delete on a selection (R3-7, R3-19)', () => {
  const item = (id: string, extra: Partial<ClientItem> = {}) =>
    ({
      _id: id,
      form: 'text',
      parentId: null,
      includeInAi: true,
      ...extra,
    }) as ClientItem
  const link = (id: string, from: string, to: string) =>
    ({ _id: id, from, to, label: '' }) as ClientLink
  const data = {
    items: {
      F: item('F', { form: 'frame', includeInAi: false }),
      C1: item('C1', { parentId: 'F' }),
      C2: item('C2', { parentId: 'F' }),
      A: item('A'),
      B: item('B'),
    },
    links: {
      L1: link('L1', 'A', 'B'),
      L2: link('L2', 'C1', 'B'),
      L3: link('L3', 'B', 'B2'),
    },
  }

  it('deletes a links-only selection on its own', () => {
    expect(deletePlan({ nodes: [], edges: ['L1', 'L3'] }, data)).toEqual({
      kind: 'links',
      ids: ['L1', 'L3'],
    })
    expect(deletePlan({ nodes: [], edges: [] }, data)).toBeNull()
  })

  it('counts the links an item selection takes along', () => {
    expect(deletePlan({ nodes: ['A'], edges: ['L3'] }, data)).toEqual({
      kind: 'items',
      items: ['A'],
      links: 2, // L1 goes with A, L3 was selected
      frameChildren: 0,
      hiddenFrame: false,
    })
  })

  it('says how many children a hidden frame leaves behind (they stay private)', () => {
    expect(deletePlan({ nodes: ['F', 'C2'], edges: [] }, data)).toEqual({
      kind: 'items',
      items: ['F', 'C2'],
      links: 0,
      frameChildren: 1, // C1 stays; C2 is being deleted too
      hiddenFrame: true,
    })
  })

  // The toast is the only account of a delete now that nothing asks first, so it has to
  // carry what the confirm used to say: the counts, and that a frame's cards stay.
  it('reports what went and what stayed', () => {
    expect(deletedText(deletePlan({ nodes: [], edges: ['L1'] }, data)!)).toBe(
      '1 link deleted'
    )
    expect(
      deletedText(deletePlan({ nodes: ['A'], edges: ['L3'] }, data)!)
    ).toBe('1 item and 2 links deleted')
    expect(deletedText(deletePlan({ nodes: ['F'], edges: [] }, data)!)).toBe(
      '1 item deleted - 2 items stay on the board, and stay private'
    )
  })
})

describe('bulk "Include in AI: on" (DR11, D24)', () => {
  const items = {
    H: { includeInAi: false },
    V: { includeInAi: true },
  }

  it('skips a hidden frame: un-hiding one goes through the D24 confirm only', () => {
    expect(
      skipsBulkAiOn(
        { form: 'frame', parentId: null, includeInAi: false },
        items
      )
    ).toBe(true)
    expect(
      skipsBulkAiOn({ form: 'frame', parentId: null, includeInAi: true }, items)
    ).toBe(false)
  })

  it('skips children of a hidden or missing frame, not of a visible one', () => {
    const child = (parentId: string) => ({
      form: 'text',
      parentId,
      includeInAi: false,
    })
    expect(skipsBulkAiOn(child('H'), items)).toBe(true)
    expect(skipsBulkAiOn(child('gone'), items)).toBe(true)
    expect(skipsBulkAiOn(child('V'), items)).toBe(false)
    expect(
      skipsBulkAiOn({ form: 'text', parentId: null, includeInAi: false }, items)
    ).toBe(false)
  })
})

describe('shortcut guard (DR9)', () => {
  const input = { tagName: 'INPUT', getAttribute: () => null }
  const textarea = { tagName: 'TEXTAREA', getAttribute: () => null }
  const editable = {
    tagName: 'DIV',
    isContentEditable: true,
    getAttribute: () => null,
  }
  const combobox = { tagName: 'BUTTON', getAttribute: () => 'combobox' }
  const canvas = { tagName: 'DIV', getAttribute: () => null }

  it('maps every tool letter', () => {
    for (const [key, tool] of Object.entries(TOOL_KEYS))
      expect(shortcutFor({ key, target: canvas as never })).toEqual({
        type: 'tool',
        tool,
      })
  })

  it.each([
    ['input', input],
    ['textarea', textarea],
    ['contenteditable', editable],
    ['combobox', combobox],
  ])(
    'does nothing for tool keys, Delete or ? while typing in %s',
    (_n, target) => {
      for (const key of ['t', 'p', 'Delete', 'Backspace', '?'])
        expect(shortcutFor({ key, target: target as never })).toBeNull()
    }
  )

  it('Escape in a field only leaves the field; Cmd/Ctrl+E still exports', () => {
    expect(shortcutFor({ key: 'Escape', target: input as never })).toEqual({
      type: 'leaveField',
    })
    expect(shortcutFor({ key: 'Escape', target: canvas as never })).toEqual({
      type: 'escape',
    })
    expect(
      shortcutFor({ key: 'e', metaKey: true, target: input as never })
    ).toEqual({ type: 'export' })
  })

  it('ignores a key a control already handled (a dropdown closing on Escape)', () => {
    expect(
      shortcutFor({
        key: 'Escape',
        defaultPrevented: true,
        target: canvas as never,
      })
    ).toBeNull()
  })

  it('sends nothing to the canvas while a dialog is open', () => {
    for (const key of ['ArrowLeft', 'p', 'Delete', 'Escape', '?', 'Enter'])
      expect(
        shortcutFor({ key, target: canvas as never }, { modalOpen: true })
      ).toBeNull()
    expect(
      shortcutFor(
        { key: 'e', ctrlKey: true, target: canvas as never },
        { modalOpen: true }
      )
    ).toBeNull()
  })

  it('arrows nudge 10px, 50px with Shift; not while typing', () => {
    expect(shortcutFor({ key: 'ArrowLeft', target: canvas as never })).toEqual({
      type: 'nudge',
      dx: -10,
      dy: 0,
    })
    expect(
      shortcutFor({ key: 'ArrowDown', shiftKey: true, target: canvas as never })
    ).toEqual({ type: 'nudge', dx: 0, dy: 50 })
    expect(
      shortcutFor({ key: 'ArrowLeft', target: textarea as never })
    ).toBeNull()
  })

  it('Enter on a focused canvas node edits that node', () => {
    const node = {
      tagName: 'DIV',
      classList: { contains: (c: string) => c === 'react-flow__node' },
      getAttribute: (name: string) => (name === 'data-id' ? 'N1' : null),
    }
    expect(canvasNodeId(node as never)).toBe('N1')
    expect(canvasNodeId(canvas as never)).toBeNull()
    expect(shortcutFor({ key: 'Enter', target: node as never })).toEqual({
      type: 'edit',
      id: 'N1',
    })
    expect(shortcutFor({ key: 'Enter', target: canvas as never })).toBeNull()
  })

  it('ignores letters typed with a modifier (Ctrl+T is the browser)', () => {
    expect(
      shortcutFor({ key: 't', ctrlKey: true, target: canvas as never })
    ).toBeNull()
  })

  it('Delete and ? on the canvas', () => {
    expect(shortcutFor({ key: 'Delete', target: canvas as never })).toEqual({
      type: 'delete',
    })
    expect(shortcutFor({ key: '?', target: canvas as never })).toEqual({
      type: 'help',
    })
  })

  // Both modes, and inside a field: it has to beat the browser's own Save dialog.
  it('Cmd/Ctrl+S is save, typing or not', () => {
    expect(
      shortcutFor({ key: 's', metaKey: true, target: canvas as never })
    ).toEqual({ type: 'save' })
    expect(
      shortcutFor({ key: 'S', ctrlKey: true, target: textarea as never })
    ).toEqual({ type: 'save' })
  })

  it('Cmd/Ctrl+Z undoes, with Shift or Ctrl+Y for redo', () => {
    expect(
      shortcutFor({ key: 'z', metaKey: true, target: canvas as never })
    ).toEqual({ type: 'undo' })
    expect(
      shortcutFor({
        key: 'z',
        ctrlKey: true,
        shiftKey: true,
        target: canvas as never,
      })
    ).toEqual({ type: 'redo' })
    expect(
      shortcutFor({ key: 'y', ctrlKey: true, target: canvas as never })
    ).toEqual({ type: 'redo' })
  })

  // The one chord that a field keeps: inside a title Cmd+Z undoes the characters typed,
  // which is not the same thing as undoing the whole edit.
  it('leaves Cmd+Z to the field while typing', () => {
    expect(
      shortcutFor({ key: 'z', metaKey: true, target: input as never })
    ).toBeNull()
    expect(
      shortcutFor(
        { key: 'z', metaKey: true, target: canvas as never },
        { modalOpen: true }
      )
    ).toBeNull()
  })

  it('Esc order: tool, then surface, then selection', () => {
    expect(
      escapeTarget({ tool: 'pen', surfaceOpen: true, hasSelection: true })
    ).toBe('tool')
    expect(
      escapeTarget({ tool: 'select', surfaceOpen: true, hasSelection: true })
    ).toBe('surface')
    expect(
      escapeTarget({ tool: 'select', surfaceOpen: false, hasSelection: true })
    ).toBe('selection')
    expect(
      escapeTarget({ tool: 'select', surfaceOpen: false, hasSelection: false })
    ).toBeNull()
  })
})

describe('meaning styles (DR7)', () => {
  it('has classes for every tone and a component for every icon the list may name', () => {
    expect(Object.keys(TONE_CLS).sort()).toEqual([...VOCAB_TONES].sort())
    expect(Object.keys(ICONS).sort()).toEqual([...VOCAB_ICONS].sort())
    for (const cls of Object.values(TONE_CLS)) expect(cls).toMatch(/text-pp-/)
  })

  it('styles every default meaning, none, and a key the list does not have', () => {
    for (const { key, label } of DEFAULT_VOCAB.meanings) {
      const style = meaningStyle(DEFAULT_VOCAB, key)
      expect(style.label).toBe(label)
      expect(style.Icon).not.toBeNull()
    }
    expect(meaningStyle(DEFAULT_VOCAB, null).label).toBe('Unclassified')
    // Never a borrowed colour for a key that is not in the list.
    const gone = meaningStyle(DEFAULT_VOCAB, 'retired')
    expect(gone.label).toBe('retired')
    expect(gone.chipCls).toBe(meaningStyle(DEFAULT_VOCAB, null).chipCls)
  })
})

describe('client ObjectIds', () => {
  it('are 24 hex chars, unique, and start with the timestamp', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newObjectId()))
    expect(ids.size).toBe(1000)
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{24}$/)
    expect(newObjectId(0x5f000000 * 1000).slice(0, 8)).toBe('5f000000')
  })
})

describe('NDJSON board loader (D28, DR4)', () => {
  const encode = (chunks: string[]) =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks)
          controller.enqueue(new TextEncoder().encode(chunk))
        controller.close()
      },
    })

  const lines: BoardLine[] = [
    { t: 'start', items: 1, links: 0 },
    { t: 'item', item: { _id: 'x' } as never },
    { t: 'end', items: 1, links: 0 },
  ]
  const text = lines.map(l => JSON.stringify(l)).join('\n') + '\n'

  it('batches per chunk, across split lines', async () => {
    const batches: BoardLine[][] = []
    const mid = Math.floor(text.length / 2)
    const result = await readBoardStream(
      encode([text.slice(0, mid), text.slice(mid)]),
      batch => batches.push(batch)
    )
    expect(result).toEqual({ items: 1, links: 0 })
    expect(batches.flat()).toEqual(lines)
    expect(batches.length).toBeLessThanOrEqual(2)
  })

  it('a stream without the end line is an error, never a smaller board', async () => {
    const cut = lines
      .slice(0, 2)
      .map(l => JSON.stringify(l))
      .join('\n')
    await expect(
      readBoardStream(encode([cut + '\n']), () => {})
    ).rejects.toThrow(BoardLoadError)
  })

  it('a stream that errors mid-way is an error', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(JSON.stringify(lines[0]) + '\n')
        )
        controller.error(new Error('reset'))
      },
    })
    await expect(readBoardStream(body, () => {})).rejects.toThrow(
      BoardLoadError
    )
  })
})

describe('sample data (D33)', () => {
  const seed = mockBoard(2030)

  it('is a board the validators would accept', () => {
    for (const spec of seed.items) {
      const checked = validateItem({
        _id: 'a'.repeat(24),
        form: spec.form,
        meaning: spec.meaning ?? null,
        status: spec.status ?? null,
        title: spec.title,
        body: spec.body ?? '',
        shape: spec.shape ?? null,
        todos: (spec.todos ?? []).map((row, index) => ({
          id: `${index}`,
          ...row,
        })),
        tags: spec.tags ?? [],
        when: spec.when ?? null,
        targetBy: spec.targetBy ?? null,
        parentId: spec.parent ? 'b'.repeat(24) : null,
        x: spec.x,
        y: spec.y,
        width: spec.width,
        height: spec.height,
      })
      expect([spec.key, checked.ok]).toEqual([spec.key, true])
    }
  })

  it('links only what it creates, and never an item to itself', () => {
    const keys = new Set(seed.items.map(item => item.key))
    for (const link of seed.links) {
      expect(keys.has(link.from)).toBe(true)
      expect(keys.has(link.to)).toBe(true)
      expect(link.from).not.toBe(link.to)
    }
  })

  // A child is stored relative to its frame, so "inside" is a claim about these numbers -
  // and a seed whose cards spill out of the frame teaches the wrong thing about frames.
  it('keeps every child inside its frame, and everything else outside it', () => {
    const byKey = new Map(seed.items.map(item => [item.key, item]))
    const frames = seed.items.filter(item => item.form === 'frame')
    expect(frames.length).toBeGreaterThan(0)

    for (const item of seed.items) {
      if (!item.parent) continue
      const frame = byKey.get(item.parent)!
      expect(frame.form).toBe('frame')
      expect(item.x).toBeGreaterThanOrEqual(0)
      expect(item.y).toBeGreaterThanOrEqual(0)
      expect(item.x + item.width).toBeLessThanOrEqual(frame.width)
      expect(item.y + item.height).toBeLessThanOrEqual(frame.height)
    }

    for (const item of seed.items) {
      if (item.parent || item.form === 'frame') continue
      const clear = frames.every(
        frame =>
          item.x >= frame.x + frame.width ||
          item.x + item.width <= frame.x ||
          item.y >= frame.y + frame.height ||
          item.y + item.height <= frame.y
      )
      expect([item.key, clear]).toEqual([item.key, true])
    }
  })

  it('shows what a hidden card looks like', () => {
    expect(seed.items.some(item => item.includeInAi === false)).toBe(true)
    expect(seed.items.some(item => item.meaning === 'failure')).toBe(true)
    expect(seed.items.filter(item => item.form === 'todo')).toHaveLength(1)
  })
})

describe('board validators (D32)', () => {
  it('trims a title, defaults the switch on, and refuses a newline', () => {
    expect(validateBoard({ title: '  Scratch  ' })).toEqual({
      ok: true,
      value: { title: 'Scratch', includeInAi: true },
    })
    expect(validateBoard({ title: 'a\nb' }).ok).toBe(false)
    expect(validateBoard({ title: 'x'.repeat(201) }).ok).toBe(false)
    expect(validateBoard({ includeInAi: false })).toMatchObject({
      ok: true,
      value: { includeInAi: false },
    })
  })

  it('patches only what was sent, and refuses an empty patch', () => {
    expect(validateBoardPatch({ includeInAi: false })).toEqual({
      ok: true,
      value: { includeInAi: false },
    })
    expect(validateBoardPatch({})).toMatchObject({ ok: false })
    expect(validateBoardPatch({ includeInAi: 'no' })).toMatchObject({
      ok: false,
    })
  })
})
