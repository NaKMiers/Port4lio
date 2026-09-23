'use client'

import type { Node, NodeProps } from '@xyflow/react'
import { memo, useMemo } from 'react'

import type { ItemNodeData } from '@/components/whiteboard/board-ui'
import { INK_SIZE, strokePath } from '@/components/whiteboard/ink'
import { ErrorBadge, HiddenBadge } from '@/components/whiteboard/nodes/badges'
import { cn } from '@/lib/utils'

/**
 * A freehand stroke. Its points are local to the node's own x/y; the node is sized to the
 * stroke's bbox and the SVG is offset by bbox.min, so a stroke that went up-left of where it
 * started still renders inside its box.
 *
 * The path is memoised on the points array (D28): perfect-freehand is the expensive part,
 * and a board with many strokes must not recompute every one when an unrelated card moves.
 * Agents never see these points - they read `[Sketch near: ...]` (D27).
 */

type InkNode = Node<ItemNodeData, 'ink'>

function InkNodeView({ id, data, selected }: NodeProps<InkNode>) {
  const { item, hidden, hiddenByFrame, error } = data
  const points = item.ink?.points
  const bbox = item.ink?.bbox ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 }
  const d = useMemo(() => (points ? strokePath(points) : ''), [points])
  const pad = INK_SIZE
  const width = Math.max(bbox.maxX - bbox.minX, 1) + pad * 2
  const height = Math.max(bbox.maxY - bbox.minY, 1) + pad * 2

  return (
    <div
      data-testid="wb-ink"
      data-item-id={id}
      className={cn(
        'relative',
        hiddenByFrame && 'opacity-55',
        selected &&
          'rounded-md ring-2 ring-pp-ink-blue ring-offset-4 ring-offset-pp-bg',
        error &&
          'rounded-md ring-2 ring-pp-ink-rose ring-offset-4 ring-offset-pp-bg'
      )}
      style={{
        width,
        height,
        transform: `translate(${bbox.minX - pad}px, ${bbox.minY - pad}px)`,
      }}
    >
      <svg
        aria-label="Sketch"
        width={width}
        height={height}
        viewBox={`${bbox.minX - pad} ${bbox.minY - pad} ${width} ${height}`}
        className="overflow-visible"
      >
        <path
          d={d}
          className="fill-pp-text"
        />
      </svg>
      {hidden ? <HiddenBadge className="absolute -right-4 -top-4" /> : null}
      {error ? <ErrorBadge message={error} /> : null}
    </div>
  )
}

export default memo(InkNodeView)
