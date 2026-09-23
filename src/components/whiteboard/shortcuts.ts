/**
 * The keyboard map and its guard (DR9), as pure functions so they can be tested alone.
 *
 * ```
 *   keydown ──▶ already handled (defaultPrevented)? ──▶ ignore   a dropdown's own Esc
 *           ──▶ a modal is open? ──────────────────────▶ ignore   it owns the keyboard
 *           ──▶ Cmd/Ctrl+E ────────────────────────────▶ export   (a chord is never a typo)
 *           ──▶ Cmd/Ctrl+S ────────────────────────────▶ save now (D31)
 *           ──▶ Escape in a field ─────────────────────▶ leave the field, nothing else
 *           ──▶ in a field ────────────────────────────▶ ignore   letters are letters
 *           ──▶ Cmd/Ctrl+Z / +Shift+Z / +Y ────────────▶ undo / redo
 *           ──▶ Escape / Delete / ? / arrows / Enter on a node / tool letter
 * ```
 *
 * Undo is the one chord that is NOT taken while typing: inside a field Cmd+Z belongs to the
 * field, where it undoes the characters just typed. Taking it there would undo the whole
 * edit instead, which is never what a half-typed title wants.
 *
 * The guard is the whole point: a tool key typed into the title field must type a letter,
 * not switch to the pen, and Delete in a textarea must delete a character, not open "Delete 3
 * items?". Escape in a field only leaves the field: it used to fall through to "peel a layer",
 * so closing the Meaning dropdown or backing out of the title also cleared the selection or
 * closed the export sheet. And while a dialog is open, nothing reaches the canvas: arrow keys
 * used to move the selected cards behind the delete confirm.
 */

export type Tool =
  | 'select'
  | 'text'
  | 'todo'
  | 'rect'
  | 'ellipse'
  | 'diamond'
  | 'frame'
  | 'arrow'
  | 'pen'
  | 'eraser'

export const TOOL_KEYS: Record<string, Tool> = {
  v: 'select',
  t: 'text',
  l: 'todo',
  r: 'rect',
  o: 'ellipse',
  d: 'diamond',
  f: 'frame',
  a: 'arrow',
  p: 'pen',
  e: 'eraser',
}

export type ShortcutAction =
  | { type: 'tool'; tool: Tool }
  | { type: 'delete' }
  | { type: 'save' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'help' }
  | { type: 'export' }
  | { type: 'escape' }
  | { type: 'leaveField' }
  /** Enter on a focused canvas node: select it and edit it in place (DR10). */
  | { type: 'edit'; id: string }
  /** Arrow keys: move the selection 10px, 50px with Shift (DR9). */
  | { type: 'nudge'; dx: number; dy: number }

interface KeyLike {
  key: string
  metaKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
  defaultPrevented?: boolean
  target?: EventTarget | null
}

const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
}

/** The React Flow node a key event came from, if focus is on one (not inside it). */
export function canvasNodeId(
  target: EventTarget | null | undefined
): string | null {
  const el = target as {
    classList?: { contains: (name: string) => boolean }
    getAttribute?: (name: string) => string | null
  } | null
  if (!el?.classList?.contains('react-flow__node')) return null
  return el.getAttribute?.('data-id') ?? null
}

export function isTypingTarget(target: EventTarget | null | undefined) {
  if (!target || typeof target !== 'object') return false
  const el = target as {
    tagName?: string
    isContentEditable?: boolean
    getAttribute?: (name: string) => string | null
  }
  const tag = el.tagName?.toLowerCase()
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true
  if (el.isContentEditable) return true
  const role = el.getAttribute?.('role')
  return role === 'textbox' || role === 'combobox'
}

export function shortcutFor(
  event: KeyLike,
  { modalOpen = false }: { modalOpen?: boolean } = {}
): ShortcutAction | null {
  if (event.defaultPrevented || modalOpen) return null
  const chord = Boolean(event.metaKey || event.ctrlKey)
  if (chord && event.key.toLowerCase() === 'e') return { type: 'export' }
  // Also while typing: the browser's Save dialog must not open over a half-typed card.
  if (chord && event.key.toLowerCase() === 's') return { type: 'save' }

  const typing = isTypingTarget(event.target)
  if (event.key === 'Escape')
    return typing ? { type: 'leaveField' } : { type: 'escape' }
  if (typing) return null

  if (chord && !event.altKey) {
    const key = event.key.toLowerCase()
    if (key === 'z') return { type: event.shiftKey ? 'redo' : 'undo' }
    // Ctrl+Y is redo on Windows keyboards, where Ctrl+Shift+Z is awkward.
    if (key === 'y') return { type: 'redo' }
  }
  if (chord || event.altKey) return null

  if (event.key === 'Delete' || event.key === 'Backspace')
    return { type: 'delete' }
  if (event.key === '?') return { type: 'help' }

  const arrow = ARROWS[event.key]
  if (arrow) {
    const step = event.shiftKey ? 50 : 10
    return { type: 'nudge', dx: arrow[0] * step, dy: arrow[1] * step }
  }
  if (event.key === 'Enter') {
    const id = canvasNodeId(event.target)
    return id ? { type: 'edit', id } : null
  }

  const tool = TOOL_KEYS[event.key.toLowerCase()]
  return tool ? { type: 'tool', tool } : null
}

/**
 * Esc peels one layer at a time: the active tool, then an open sheet or popover, then the
 * selection. Returns which layer to close.
 */
export function escapeTarget(state: {
  tool: Tool
  surfaceOpen: boolean
  hasSelection: boolean
}): 'tool' | 'surface' | 'selection' | null {
  if (state.tool !== 'select') return 'tool'
  if (state.surfaceOpen) return 'surface'
  if (state.hasSelection) return 'selection'
  return null
}
