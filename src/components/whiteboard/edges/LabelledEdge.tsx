'use client'

import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  useInternalNode,
  type Edge,
  type EdgeProps,
} from '@xyflow/react'
import { TriangleAlert } from 'lucide-react'
import { memo, useState } from 'react'

import { useBoardUi } from '@/components/whiteboard/board-ui'
import { floatingEdgeParams } from '@/components/whiteboard/edges/floating'
import { cn } from '@/lib/utils'
import { LIMITS } from '@/lib/whiteboard/limits'

/**
 * A link: 1.6px muted bezier with an arrowhead, and its label as a small pill at the
 * midpoint ("because", "blocks", "learned from"). It floats between the two cards' borders
 * (see floating.ts) rather than sticking to the handle it was drawn from.
 *
 * Double-click the edge or its pill to type or fix the label in place (D19). Enter or a click
 * away commits through the save queue's debounced PATCH, Escape reverts. The link keeps its
 * id either way, so an id an agent cited earlier still resolves.
 */

export type LinkEdgeData = { label: string; error: string | null }
type LinkEdge = Edge<LinkEdgeData, 'link'>

function LabelledEdgeView({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  selected,
  data,
}: EdgeProps<LinkEdge>) {
  const ui = useBoardUi()
  const sourceNode = useInternalNode(source)
  const targetNode = useInternalNode(target)
  const floating =
    sourceNode?.measured.width && targetNode?.measured.width
      ? floatingEdgeParams(sourceNode, targetNode)
      : null
  const [path, labelX, labelY] = getBezierPath(
    floating
      ? {
          sourceX: floating.sx,
          sourceY: floating.sy,
          sourcePosition: floating.sourcePos,
          targetX: floating.tx,
          targetY: floating.ty,
          targetPosition: floating.targetPos,
        }
      : {
          sourceX,
          sourceY,
          sourcePosition,
          targetX,
          targetY,
          targetPosition,
        }
  )
  const label = data?.label ?? ''
  const error = data?.error ?? null
  const editing = ui.editingEdgeId === id

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        interactionWidth={18}
        className={cn(
          'wb-edge',
          selected && 'wb-edge-selected',
          error && 'wb-edge-error'
        )}
      />
      {label || editing || selected || error ? (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-auto absolute"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
            onDoubleClick={event => {
              if (ui.readOnly) return
              event.stopPropagation()
              ui.setEditingEdgeId(id)
            }}
          >
            {editing ? (
              <LabelEditor
                initial={label}
                onCommit={value => {
                  ui.actions.updateLinkLabel(id, value)
                  ui.setEditingEdgeId(null)
                }}
                onCancel={() => ui.setEditingEdgeId(null)}
              />
            ) : (
              <span
                data-testid="wb-edge-label"
                className={cn(
                  'flex items-center gap-1 rounded-full border border-pp-text/15 bg-pp-panel-strong px-2.5 py-[3px] font-display text-[10.5px] font-semibold tracking-[0.04em] text-pp-text',
                  !label && 'text-pp-muted',
                  selected && 'border-pp-ink-blue',
                  error && 'border-pp-ink-rose text-pp-ink-rose'
                )}
                title={error ?? undefined}
              >
                {error ? (
                  <TriangleAlert
                    aria-label={`Not saved: ${error}`}
                    size={11}
                  />
                ) : null}
                {label || 'Double-click to label'}
              </span>
            )}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  )
}

/** Mounted when editing starts, so its draft starts from the current label. */
function LabelEditor({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string
  onCommit: (value: string) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState(initial)
  return (
    <input
      autoFocus
      aria-label="Link label"
      value={draft}
      maxLength={LIMITS.linkLabel}
      placeholder="because, blocks, led to..."
      onChange={event => setDraft(event.target.value.replace(/[\r\n]+/g, ' '))}
      onBlur={() => onCommit(draft.trim())}
      onKeyDown={event => {
        if (event.key === 'Enter') {
          event.preventDefault()
          onCommit(draft.trim())
        }
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          onCancel()
        }
      }}
      className="w-44 rounded-full border border-pp-ink-blue bg-pp-panel-strong px-2.5 py-[3px] text-center font-display text-[10.5px] font-semibold tracking-[0.04em] text-pp-text outline-none"
    />
  )
}

export default memo(LabelledEdgeView)
