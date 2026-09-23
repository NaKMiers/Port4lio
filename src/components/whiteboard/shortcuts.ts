/**
 * The keyboard map and its guard (DR9), as pure functions so they can be tested alone.
 *
 * The guard is the whole point: a tool key typed into the title field must type a letter,
 * not switch to the pen, and Delete in a textarea must delete a character, not open "Delete 3
 * items?". Everything with a single-key shortcut is refused while focus is in an input, a
 * textarea, a select or anything contenteditable. Escape and Cmd/Ctrl+E are not refused:
 * Escape is how you leave the field, and a chord cannot be typed by accident.
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
  | { type: 'help' }
  | { type: 'export' }
  | { type: 'escape' }

interface KeyLike {
  key: string
  metaKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
  target?: EventTarget | null
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

export function shortcutFor(event: KeyLike): ShortcutAction | null {
  const chord = Boolean(event.metaKey || event.ctrlKey)
  if (chord && event.key.toLowerCase() === 'e') return { type: 'export' }
  if (event.key === 'Escape') return { type: 'escape' }

  if (isTypingTarget(event.target)) return null
  if (chord || event.altKey) return null

  if (event.key === 'Delete' || event.key === 'Backspace')
    return { type: 'delete' }
  if (event.key === '?') return { type: 'help' }

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
