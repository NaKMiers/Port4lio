/**
 * Frame membership and the coordinate conversion that comes with it.
 *
 * ```
 *   child.x/y is RELATIVE to its frame when parentId is set, canvas-absolute otherwise
 *
 *   drop ──▶ absolute centre of the item ──▶ inside a frame's rect?
 *              ├ yes, a different frame ──▶ join:  parentId = frame, x/y -= frame.x/y
 *              ├ no, was in a frame ─────▶ leave: parentId = null,  x/y += frame.x/y
 *              └ unchanged ──────────────▶ just the new position
 * ```
 *
 * Frames are flat - a frame never joins a frame - so there is exactly one level and one
 * offset to add or subtract. Stored the way React Flow uses them, so dragging a frame writes
 * one document and its children follow for free.
 */

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface Placeable extends Rect {
  id: string
  form: string
  parentId: string | null
  z?: number
}

export function absoluteOrigin(
  item: Pick<Placeable, 'x' | 'y' | 'parentId'>,
  framesById: ReadonlyMap<string, Pick<Placeable, 'x' | 'y'>>
): { x: number; y: number } {
  const frame = item.parentId ? framesById.get(item.parentId) : undefined
  return frame
    ? { x: item.x + frame.x, y: item.y + frame.y }
    : { x: item.x, y: item.y }
}

export function centre(rect: Rect) {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
}

export function contains(rect: Rect, point: { x: number; y: number }) {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  )
}

/** The frame whose rect contains the item's centre - the topmost if frames overlap. */
export function frameAt(
  point: { x: number; y: number },
  frames: readonly Placeable[],
  excludeId?: string
): Placeable | null {
  let found: Placeable | null = null
  for (const frame of frames) {
    if (frame.form !== 'frame' || frame.id === excludeId) continue
    if (!contains(frame, point)) continue
    if (!found || (frame.z ?? 0) >= (found.z ?? 0)) found = frame
  }
  return found
}

export interface Membership {
  parentId: string | null
  x: number
  y: number
  /** True when the item joined, left or switched frames. */
  changed: boolean
  /** The frame it left, if any (rule 8 needs to know whether that one was hidden). */
  left: string | null
}

/**
 * Where an item ends up after a drop, given its ABSOLUTE top-left after the drag. Frames
 * are canvas frames here, with absolute x/y (they never have a parent).
 */
export function resolveMembership(
  item: Pick<Placeable, 'id' | 'form' | 'parentId' | 'width' | 'height'>,
  absolute: { x: number; y: number },
  frames: readonly Placeable[]
): Membership {
  if (item.form === 'frame')
    return {
      parentId: null,
      x: absolute.x,
      y: absolute.y,
      changed: false,
      left: null,
    }

  const target = frameAt(
    centre({ ...absolute, width: item.width, height: item.height }),
    frames,
    item.id
  )
  const parentId = target?.id ?? null
  const changed = parentId !== item.parentId
  return {
    parentId,
    x: target ? absolute.x - target.x : absolute.x,
    y: target ? absolute.y - target.y : absolute.y,
    changed,
    left: changed ? item.parentId : null,
  }
}
