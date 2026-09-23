import { describe, expect, it } from 'vitest'

import {
  BoardLoadError,
  readBoardStream,
} from '@/components/whiteboard/board-loader'
import {
  absoluteOrigin,
  resolveMembership,
  type Placeable,
} from '@/components/whiteboard/frame-geometry'
import { MEANING_STYLE } from '@/components/whiteboard/meaning-style'
import { newObjectId } from '@/components/whiteboard/object-id'
import {
  TOOL_KEYS,
  escapeTarget,
  shortcutFor,
} from '@/components/whiteboard/shortcuts'
import { MEANINGS } from '@/lib/whiteboard/limits'
import type { BoardLine } from '@/lib/whiteboard/types'

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

  it('still lets Escape and Cmd/Ctrl+E through from an input', () => {
    expect(shortcutFor({ key: 'Escape', target: input as never })).toEqual({
      type: 'escape',
    })
    expect(
      shortcutFor({ key: 'e', metaKey: true, target: input as never })
    ).toEqual({ type: 'export' })
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
