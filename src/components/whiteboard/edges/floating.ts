import { Position, type InternalNode } from '@xyflow/react'

/**
 * Floating edge geometry: where the line between two nodes' centres crosses each node's
 * border, and which side that is (for the bezier's control points).
 *
 * Links are drawn this way whatever handle they were started from. A link is a statement
 * ("this failure shaped that goal"), not a wire between two ports, and fixed handles make a
 * board unreadable the moment a card moves: every arrow keeps leaving from the top.
 */

function centreAndHalf(node: InternalNode) {
  const w = node.measured.width ?? 0
  const h = node.measured.height ?? 0
  const { x, y } = node.internals.positionAbsolute
  return { cx: x + w / 2, cy: y + h / 2, hw: w / 2, hh: h / 2 }
}

function intersection(node: InternalNode, other: InternalNode) {
  const a = centreAndHalf(node)
  const b = centreAndHalf(other)
  const dx = b.cx - a.cx
  const dy = b.cy - a.cy
  if ((dx === 0 && dy === 0) || a.hw === 0 || a.hh === 0)
    return { x: a.cx, y: a.cy }
  // Scale the direction vector until it touches the rectangle's edge.
  const scale = 1 / Math.max(Math.abs(dx) / a.hw, Math.abs(dy) / a.hh)
  return { x: a.cx + dx * scale, y: a.cy + dy * scale }
}

function side(node: InternalNode, point: { x: number; y: number }): Position {
  const { cx, cy, hw, hh } = centreAndHalf(node)
  const nx = (point.x - cx) / (hw || 1)
  const ny = (point.y - cy) / (hh || 1)
  if (Math.abs(nx) >= Math.abs(ny))
    return nx > 0 ? Position.Right : Position.Left
  return ny > 0 ? Position.Bottom : Position.Top
}

export function floatingEdgeParams(source: InternalNode, target: InternalNode) {
  const s = intersection(source, target)
  const t = intersection(target, source)
  return {
    sx: s.x,
    sy: s.y,
    tx: t.x,
    ty: t.y,
    sourcePos: side(source, s),
    targetPos: side(target, t),
  }
}
