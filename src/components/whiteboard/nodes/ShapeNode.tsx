'use client'

import { NodeResizer, type Node, type NodeProps } from '@xyflow/react'
import { memo } from 'react'

import { useBoardUi, type ItemNodeData } from '@/components/whiteboard/board-ui'
import NodeHandles from '@/components/whiteboard/nodes/NodeHandles'
import { ErrorBadge, HiddenBadge } from '@/components/whiteboard/nodes/badges'
import { focusSoon } from '@/components/whiteboard/nodes/focus-soon'
import { cn } from '@/lib/utils'
import { LIMITS } from '@/lib/whiteboard/limits'

/**
 * A rect, ellipse or diamond with a centred label. Drawn in SVG so the outline follows the
 * shape (a CSS border on a rotated square is not a diamond once it is resized). The label is
 * the item's title and double-clicking edits it in place.
 */

type ShapeNode = Node<ItemNodeData, 'shape'>

function outline(shape: string | null) {
  switch (shape) {
    case 'ellipse':
      return (
        <ellipse
          cx="50"
          cy="50"
          rx="49"
          ry="49"
        />
      )
    case 'diamond':
      return <polygon points="50,1 99,50 50,99 1,50" />
    default:
      return (
        <rect
          x="1"
          y="1"
          width="98"
          height="98"
          rx="8"
        />
      )
  }
}

function ShapeNodeView({ id, data, selected }: NodeProps<ShapeNode>) {
  const { item, hidden, hiddenByFrame, error } = data
  const ui = useBoardUi()
  const editing = ui.editingId === id

  return (
    <div
      data-testid="wb-shape"
      data-item-id={id}
      data-hidden={hidden || undefined}
      className={cn(
        'wb-shape relative grid h-full w-full place-items-center',
        hiddenByFrame && 'opacity-55',
        data.pulse && hidden && 'wb-pulse'
      )}
    >
      <NodeHandles />
      {selected && !ui.readOnly ? (
        <NodeResizer
          minWidth={60}
          minHeight={40}
          lineClassName="wb-resize-line"
          handleClassName="wb-resize-handle"
          onResizeEnd={(_event, params) =>
            ui.actions.updateItem(
              id,
              {
                x: params.x,
                y: params.y,
                width: Math.round(params.width),
                height: Math.round(params.height),
              },
              { delay: 0 }
            )
          }
        />
      ) : null}
      <svg
        aria-hidden
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className={cn(
          'absolute inset-0 h-full w-full overflow-visible fill-pp-panel-strong stroke-pp-text/25 [vector-effect:non-scaling-stroke]',
          selected && 'stroke-pp-ink-blue',
          error && 'stroke-pp-ink-rose'
        )}
        style={{ strokeWidth: selected || error ? 2 : 1.25 }}
      >
        <g style={{ vectorEffect: 'non-scaling-stroke' }}>
          {outline(item.shape)}
        </g>
      </svg>
      {hidden ? <HiddenBadge className="absolute right-1 top-1" /> : null}
      {error ? <ErrorBadge message={error} /> : null}
      {editing ? (
        <input
          ref={focusSoon}
          aria-label="Shape label"
          defaultValue={item.title}
          maxLength={LIMITS.title}
          onChange={event =>
            ui.actions.updateItem(id, {
              title: event.target.value.replace(/[\r\n]+/g, ' '),
            })
          }
          onBlur={() => ui.setEditingId(null)}
          onKeyDown={event => {
            if (event.key === 'Enter' || event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              ui.setEditingId(null)
            }
          }}
          className="nodrag relative w-3/4 bg-transparent text-center font-display text-[14px] font-semibold outline-none"
        />
      ) : (
        <span className="relative max-w-[80%] break-words text-center font-display text-[14px] font-semibold text-pp-text">
          {item.title}
        </span>
      )}
    </div>
  )
}

export default memo(ShapeNodeView)
