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
import { deletePlan } from '@/components/whiteboard/delete-plan'
import { MEANING_STYLE } from '@/components/whiteboard/meaning-style'
import { newObjectId } from '@/components/whiteboard/object-id'
import {
  TOOL_KEYS,
  canvasNodeId,
  escapeTarget,
  shortcutFor,
} from '@/components/whiteboard/shortcuts'
import { MEANINGS } from '@/lib/whiteboard/limits'
import type { BoardLine, ClientItem, ClientLink } from '@/lib/whiteboard/types'

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

  it('deletes a links-only selection at once, with no confirm', () => {
    expect(deletePlan({ nodes: [], edges: ['L1', 'L3'] }, data)).toEqual({
      kind: 'links',
      ids: ['L1', 'L3'],
    })
    expect(deletePlan({ nodes: [], edges: [] }, data)).toBeNull()
  })

  it('confirms any selection with an item, counting the links it takes along', () => {
    expect(deletePlan({ nodes: ['A'], edges: ['L3'] }, data)).toEqual({
      kind: 'confirm',
      items: ['A'],
      links: 2, // L1 goes with A, L3 was selected
      frameChildren: 0,
      hiddenFrame: false,
    })
  })

  it('says how many children a hidden frame leaves behind (they stay private)', () => {
    expect(deletePlan({ nodes: ['F', 'C2'], edges: [] }, data)).toEqual({
      kind: 'confirm',
      items: ['F', 'C2'],
      links: 0,
      frameChildren: 1, // C1 stays; C2 is being deleted too
      hiddenFrame: true,
    })
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

describe('MEANING_STYLE (DR7)', () => {
  it('covers every meaning and none, each with a label and chip classes', () => {
    expect(Object.keys(MEANING_STYLE).sort()).toEqual(
      [...MEANINGS, 'none'].sort()
    )
    for (const style of Object.values(MEANING_STYLE)) {
      expect(style.label).toBeTruthy()
      expect(style.chipCls).toMatch(/text-pp-(ink-|muted)/)
    }
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
