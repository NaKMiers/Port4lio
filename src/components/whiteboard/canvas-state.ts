import type { EdgeChange, NodeChange, XYPosition } from '@xyflow/react'

/**
 * React Flow's transient per-node state - selected, measured, mid-drag, mid-resize - kept
 * apart from the board's items so the canvas can be derived during render.
 *
 * Items are the source of truth for position and size; this map only overrides them while a
 * gesture is in progress (a drag's live position, a resize's live box), and carries the
 * selection and the measured size React Flow needs back on every render.
 */

export interface NodeTransient {
  selected?: boolean
  measured?: { width?: number; height?: number }
  dragging?: boolean
  position?: XYPosition
  resizing?: boolean
  width?: number
  height?: number
}

export type TransientMap = Record<string, NodeTransient>

export function applyNodeTransient(
  prev: TransientMap,
  changes: NodeChange[]
): TransientMap {
  let next: TransientMap | null = null
  const edit = (id: string, patch: NodeTransient) => {
    next ??= { ...prev }
    next[id] = { ...next[id], ...patch }
  }

  for (const change of changes)
    switch (change.type) {
      case 'select':
        if (Boolean(prev[change.id]?.selected) !== change.selected)
          edit(change.id, { selected: change.selected })
        break
      case 'dimensions':
        edit(change.id, {
          ...(change.dimensions
            ? {
                measured: change.dimensions,
                ...(change.setAttributes
                  ? {
                      width: change.dimensions.width,
                      height: change.dimensions.height,
                    }
                  : {}),
              }
            : {}),
          ...(change.resizing !== undefined
            ? { resizing: change.resizing }
            : {}),
        })
        break
      case 'position':
        edit(change.id, {
          ...(change.position ? { position: change.position } : {}),
          dragging: Boolean(change.dragging),
        })
        break
      default:
        break
    }

  return next ?? prev
}

export function applyEdgeSelection(
  prev: ReadonlySet<string>,
  changes: EdgeChange[]
): ReadonlySet<string> {
  let next: Set<string> | null = null
  for (const change of changes) {
    if (change.type !== 'select') continue
    if (prev.has(change.id) === change.selected) continue
    next ??= new Set(prev)
    if (change.selected) next.add(change.id)
    else next.delete(change.id)
  }
  return next ?? prev
}

/** Select exactly `ids` (a new card, "... more", a search hit). */
export function selectOnly(
  prev: TransientMap,
  ids: Iterable<string>
): TransientMap {
  const wanted = new Set(ids)
  const next: TransientMap = {}
  for (const [id, state] of Object.entries(prev))
    next[id] = { ...state, selected: wanted.has(id) }
  for (const id of wanted) next[id] = { ...next[id], selected: true }
  return next
}
