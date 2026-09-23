'use client'

import '@xyflow/react/dist/base.css'
import '@/components/whiteboard/whiteboard.css'

import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  MarkerType,
  ReactFlow,
  SelectionMode,
  useReactFlow,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeMouseHandler,
  type OnConnect,
  type OnNodeDrag,
} from '@xyflow/react'
import { useCallback, useEffect, useMemo, useRef } from 'react'

import type { ItemNodeData } from '@/components/whiteboard/board-ui'
import {
  applyEdgeSelection,
  applyNodeTransient,
  type TransientMap,
} from '@/components/whiteboard/canvas-state'
import LabelledEdge, {
  type LinkEdgeData,
} from '@/components/whiteboard/edges/LabelledEdge'
import CardNode from '@/components/whiteboard/nodes/CardNode'
import FrameNode from '@/components/whiteboard/nodes/FrameNode'
import InkNode from '@/components/whiteboard/nodes/InkNode'
import ShapeNode from '@/components/whiteboard/nodes/ShapeNode'
import type { Tool } from '@/components/whiteboard/shortcuts'
import {
  isEffectivelyHidden,
  type Board,
} from '@/components/whiteboard/useBoard'
import type { Tier } from '@/components/whiteboard/useTier'
import type { ClientItem } from '@/lib/whiteboard/types'

/**
 * The React Flow surface. Board state (items, links) is the source of truth; React Flow owns
 * only the transient parts - which node is selected, measured, mid-drag.
 *
 * ```
 *   board.data.items ──memo──▶ base nodes (frames first, D28; cached data objects)
 *                                   │ merged with React Flow's transient state
 *                                   ▼
 *                              <ReactFlow nodes>  ── drag stop ──▶ board.moveItems (one save)
 *                                                 ── connect ────▶ board.connect
 * ```
 *
 * Frames come first in the node list because React Flow needs a parent before its children,
 * which is also why the server streams them first. Each node's `data` object is reused while
 * its item and flags are unchanged, so memoised nodes skip re-rendering when something else
 * on the board changes. `onlyRenderVisibleElements` keeps a large board cheap to pan (D28).
 *
 * React's default Backspace/Delete removal is off: Delete goes through the board's own
 * confirm (R3-7).
 */

const nodeTypes = {
  card: CardNode,
  frame: FrameNode,
  shape: ShapeNode,
  ink: InkNode,
}
const edgeTypes = { link: LabelledEdge }

const CREATE_TOOLS: Partial<Record<Tool, true>> = {
  text: true,
  todo: true,
  rect: true,
  ellipse: true,
  diamond: true,
  frame: true,
}

/**
 * Node `data` objects, reused while an item and its flags are unchanged, so memoised nodes
 * skip re-rendering. Keyed weakly by the item object: an edited item is a new object and
 * simply misses.
 */
const dataCache = new WeakMap<ClientItem, { key: string; data: ItemNodeData }>()

function nodeData(flags: ItemNodeData): ItemNodeData {
  const key = `${flags.hidden}|${flags.hiddenByFrame}|${flags.error}|${flags.childCount}|${flags.pulse}`
  const cached = dataCache.get(flags.item)
  if (cached?.key === key) return cached.data
  dataCache.set(flags.item, { key, data: flags })
  return flags
}

function nodeType(item: ClientItem) {
  if (item.form === 'frame') return 'frame'
  if (item.form === 'shape') return 'shape'
  if (item.form === 'ink') return 'ink'
  return 'card'
}

export interface CanvasProps {
  board: Board
  tool: Tool
  readOnly: boolean
  tier: Tier
  pulse: number
  nodeState: TransientMap
  setNodeState: (update: (prev: TransientMap) => TransientMap) => void
  edgeSelection: ReadonlySet<string>
  setEdgeSelection: (
    update: (prev: ReadonlySet<string>) => ReadonlySet<string>
  ) => void
  onEditItem: (id: string) => void
  onEditEdge: (id: string) => void
  onCreate: (tool: Tool, at: { x: number; y: number }) => void
  onErase: (id: string) => void
  children?: React.ReactNode
}

export default function Canvas({
  board,
  tool,
  readOnly,
  tier,
  pulse,
  nodeState,
  setNodeState,
  edgeSelection,
  setEdgeSelection,
  onEditItem,
  onEditEdge,
  onCreate,
  onErase,
  children,
}: CanvasProps) {
  const flow = useReactFlow()
  const { data, errors, actions } = board

  // MARK: Derived nodes and edges

  const baseNodes = useMemo(() => {
    const items = data.items
    const childCount = new Map<string, number>()
    for (const item of Object.values(items))
      if (item.parentId)
        childCount.set(item.parentId, (childCount.get(item.parentId) ?? 0) + 1)

    const all = Object.values(items)
    const ordered = [
      ...all
        .filter(i => i.form === 'frame')
        .sort((a, b) => a.z - b.z || a._id.localeCompare(b._id)),
      ...all
        .filter(i => i.form !== 'frame')
        .sort((a, b) => a.z - b.z || a._id.localeCompare(b._id)),
    ]
    return ordered.map(item => {
      const parent = item.parentId ? items[item.parentId] : undefined
      const data = nodeData({
        item,
        hidden: isEffectivelyHidden(item, items),
        hiddenByFrame:
          Boolean(item.parentId) && (!parent || !parent.includeInAi),
        error: errors[item._id] ?? null,
        childCount: childCount.get(item._id) ?? 0,
        pulse,
      })

      const fixedHeight = item.form !== 'text' && item.form !== 'todo'
      const node: Node<ItemNodeData> = {
        id: item._id,
        type: nodeType(item),
        position: { x: item.x, y: item.y },
        // A parentId pointing at a frame that is not on the canvas renders at its raw
        // coordinates rather than crashing React Flow; it reads as hidden (rule 7).
        parentId: parent ? item.parentId! : undefined,
        data,
        width: item.form === 'ink' ? Math.max(item.width, 1) : item.width,
        height: fixedHeight ? item.height : undefined,
        zIndex: item.form === 'frame' ? 0 : 1,
        draggable: !readOnly && tool === 'select',
        selectable:
          !readOnly &&
          (tool === 'select' || tool === 'arrow' || tool === 'eraser'),
        connectable: !readOnly,
        ariaLabel: `${item.form} ${item.title || 'untitled'}`,
      }
      return node
    })
  }, [data.items, errors, pulse, readOnly, tool])

  const baseEdges = useMemo(
    () =>
      Object.values(data.links)
        .filter(link => data.items[link.from] && data.items[link.to])
        .map((link): Edge<LinkEdgeData> => ({
          id: link._id,
          type: 'link',
          source: link.from,
          target: link.to,
          sourceHandle: link.fromHandle ?? undefined,
          targetHandle: link.toHandle ?? undefined,
          data: { label: link.label, error: errors[link._id] ?? null },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: errors[link._id] ? '#b83280' : '#6d6661',
            width: 16,
            height: 16,
          },
          selectable: !readOnly,
        })),
    [data.items, data.links, errors, readOnly]
  )

  // Derived during render: board items, overlaid with React Flow's gesture state.
  const nodes = useMemo(
    () =>
      baseNodes.map(base => {
        const t = nodeState[base.id]
        if (!t) return base
        const live = t.dragging || t.resizing
        return {
          ...base,
          selected: Boolean(t.selected),
          measured: t.measured,
          dragging: t.dragging,
          position: live && t.position ? t.position : base.position,
          width: t.resizing && t.width ? t.width : base.width,
          height: t.resizing && t.height ? t.height : base.height,
        }
      }),
    [baseNodes, nodeState]
  )

  const edges = useMemo(
    () =>
      baseEdges.map(edge =>
        edgeSelection.has(edge.id) ? { ...edge, selected: true } : edge
      ),
    [baseEdges, edgeSelection]
  )

  const onNodesChange = useCallback(
    (changes: NodeChange<Node<ItemNodeData>>[]) =>
      // Removal never comes from React Flow (deleteKeyCode is null) and is ignored anyway:
      // the board's confirm is the only way to delete.
      setNodeState(prev => applyNodeTransient(prev, changes as NodeChange[])),
    [setNodeState]
  )

  const onEdgesChange = useCallback(
    (changes: EdgeChange<Edge<LinkEdgeData>>[]) =>
      setEdgeSelection(prev =>
        applyEdgeSelection(prev, changes as EdgeChange[])
      ),
    [setEdgeSelection]
  )

  const onNodeDragStop: OnNodeDrag<Node<ItemNodeData>> = useCallback(
    (_event, _node, dragged) => {
      const moves = dragged
        .map(node => {
          const internal = flow.getInternalNode(node.id)
          if (!internal) return null
          return {
            id: node.id,
            absolute: {
              x: Math.round(internal.internals.positionAbsolute.x),
              y: Math.round(internal.internals.positionAbsolute.y),
            },
            size: internal.measured.width
              ? {
                  width: internal.measured.width,
                  height: internal.measured.height ?? 0,
                }
              : undefined,
          }
        })
        .filter((move): move is NonNullable<typeof move> => move !== null)
      if (moves.length) actions.moveItems(moves)
    },
    [actions, flow]
  )

  const onConnect: OnConnect = useCallback(
    connection => {
      if (!connection.source || !connection.target) return
      const id = actions.connect(
        connection.source,
        connection.target,
        connection.sourceHandle ?? null,
        connection.targetHandle ?? null
      )
      if (id) onEditEdge(id)
    },
    [actions, onEditEdge]
  )

  const createAt = useCallback(
    (event: React.MouseEvent) => {
      if (readOnly || !CREATE_TOOLS[tool]) return false
      const at = flow.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      })
      onCreate(tool, at)
      return true
    },
    [flow, onCreate, readOnly, tool]
  )

  const onNodeClick: NodeMouseHandler = useCallback(
    (event, node) => {
      if (createAt(event)) return
      if (tool === 'eraser' && !readOnly)
        // The eraser removes ink strokes and nothing else (D27).
        if (data.items[node.id]?.form === 'ink') onErase(node.id)
    },
    [createAt, data.items, onErase, readOnly, tool]
  )

  const onNodeDoubleClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      if (readOnly || tool !== 'select') return
      const form = data.items[node.id]?.form
      if (form === 'text' || form === 'todo' || form === 'shape')
        onEditItem(node.id)
    },
    [data.items, onEditItem, readOnly, tool]
  )

  // MARK: View

  const fitted = useRef(false)
  useEffect(() => {
    if (board.load.phase !== 'ready' || fitted.current) return
    fitted.current = true
    requestAnimationFrame(() =>
      flow.fitView({ padding: 0.15, maxZoom: 1, duration: 0 })
    )
  }, [board.load.phase, flow])

  const touch = tier === 'sm'

  return (
    <ReactFlow
      className="wb-flow"
      data-tool={tool}
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeDragStop={onNodeDragStop}
      onConnect={onConnect}
      onPaneClick={event => {
        if (createAt(event)) return
      }}
      onNodeClick={onNodeClick}
      onNodeDoubleClick={onNodeDoubleClick}
      onEdgeDoubleClick={(_event, edge) => {
        if (!readOnly) onEditEdge(edge.id)
      }}
      connectionMode={ConnectionMode.Loose}
      deleteKeyCode={null}
      disableKeyboardA11y
      onlyRenderVisibleElements
      selectionOnDrag={!touch && tool === 'select'}
      selectionMode={SelectionMode.Partial}
      panOnDrag={touch || tool !== 'select' ? true : [1, 2]}
      panActivationKeyCode="Space"
      panOnScroll={!touch}
      zoomOnPinch
      zoomOnScroll={false}
      zoomOnDoubleClick={false}
      minZoom={0.1}
      maxZoom={2.5}
      elementsSelectable={!readOnly}
      nodesConnectable={!readOnly}
      nodesDraggable={!readOnly && tool === 'select'}
    >
      <Background
        variant={BackgroundVariant.Dots}
        gap={22}
        size={1.2}
        color="rgba(31,28,26,0.16)"
      />
      {children}
    </ReactFlow>
  )
}
