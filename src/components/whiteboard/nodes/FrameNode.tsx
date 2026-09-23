'use client'

import { NodeResizer, type Node, type NodeProps } from '@xyflow/react'
import { EyeOff } from 'lucide-react'
import { memo } from 'react'

import { useBoardUi, type ItemNodeData } from '@/components/whiteboard/board-ui'
import NodeHandles from '@/components/whiteboard/nodes/NodeHandles'
import { ErrorBadge } from '@/components/whiteboard/nodes/badges'
import { focusSoon } from '@/components/whiteboard/nodes/focus-soon'
import { cn } from '@/lib/utils'
import { LIMITS } from '@/lib/whiteboard/limits'

/**
 * A frame: an area of the board ("Career 2027", "Private") that groups the cards inside it.
 *
 * A HIDDEN frame is dashed, hatched at 135deg, and says "Hidden from AI" in its tab with an
 * EyeOff icon - hiding a frame hides everything in it from agents, so the state has to be
 * obvious from across the canvas and never carried by colour alone (DR9). Its children render
 * at 55% with their own EyeOff badge.
 *
 * The title is edited by double-clicking the tab (DR10).
 */

type FrameNode = Node<ItemNodeData, 'frame'>

function FrameNodeView({ id, data, selected }: NodeProps<FrameNode>) {
  const { item, error, childCount } = data
  const hidden = !item.includeInAi
  const ui = useBoardUi()
  const editing = ui.editingId === id

  return (
    <div
      data-testid="wb-frame"
      data-item-id={id}
      data-hidden={hidden || undefined}
      className={cn(
        'wb-frame relative h-full w-full rounded-[18px] border-[1.5px] border-pp-text/15 bg-white/30',
        hidden &&
          'border-dashed border-pp-text/30 bg-[repeating-linear-gradient(135deg,rgba(31,28,26,0.035)_0_10px,transparent_10px_20px)]',
        selected && 'ring-2 ring-pp-ink-blue ring-offset-2 ring-offset-pp-bg',
        error && 'ring-2 ring-pp-ink-rose ring-offset-2 ring-offset-pp-bg',
        data.pulse && hidden && 'wb-pulse'
      )}
    >
      <NodeHandles />
      {selected && !ui.readOnly ? (
        <NodeResizer
          minWidth={220}
          minHeight={140}
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
      {error ? <ErrorBadge message={error} /> : null}

      <div
        className="absolute -top-[13px] left-3.5 flex max-w-[calc(100%-28px)] items-center gap-1.5 rounded-full border border-pp-text/15 bg-pp-bg px-2.5 py-[3px] font-display text-[12px] font-semibold text-pp-text"
        onDoubleClick={event => {
          if (ui.readOnly) return
          event.stopPropagation()
          ui.setEditingId(id)
        }}
      >
        {hidden ? (
          <EyeOff
            aria-hidden
            size={13}
            className="shrink-0 text-pp-muted"
          />
        ) : null}
        {editing ? (
          <input
            ref={focusSoon}
            aria-label="Frame title"
            defaultValue={item.title}
            maxLength={LIMITS.title}
            onFocus={event => event.currentTarget.select()}
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
            className="nodrag w-40 bg-transparent outline-none"
          />
        ) : (
          <span className="truncate">{item.title || 'Untitled frame'}</span>
        )}
        <span className="shrink-0 text-[11px] font-medium text-pp-muted">
          {childCount}
        </span>
        {hidden ? (
          <span className="shrink-0 text-[10px] uppercase tracking-[0.12em] text-pp-muted">
            Hidden from AI
          </span>
        ) : null}
      </div>
    </div>
  )
}

export default memo(FrameNodeView)
