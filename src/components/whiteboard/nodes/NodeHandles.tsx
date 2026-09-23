'use client'

import { Handle, Position } from '@xyflow/react'
import { memo } from 'react'

/**
 * Four connection points, each usable as a source or a target (`ConnectionMode.Loose` on the
 * canvas). Styled in whiteboard.css: faint on hover, prominent with the arrow tool.
 */
const SIDES = [
  ['t', Position.Top],
  ['r', Position.Right],
  ['b', Position.Bottom],
  ['l', Position.Left],
] as const

function NodeHandles() {
  return (
    <>
      {SIDES.map(([id, position]) => (
        <Handle
          key={id}
          id={id}
          type="source"
          position={position}
          className="wb-handle"
        />
      ))}
    </>
  )
}

export default memo(NodeHandles)
