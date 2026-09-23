'use client'

import { ReactFlowProvider, useReactFlow } from '@xyflow/react'
import { Pencil } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import ConfirmDialog from '@/components/admin/ConfirmDialog'
import { AgentsButton } from '@/components/whiteboard/AgentsPopover'
import { BackupMenu, RestoreDialog } from '@/components/whiteboard/Backup'
import ExportSheet from '@/components/whiteboard/ExportSheet'
import InkLayer from '@/components/whiteboard/InkLayer'
import {
  BoardLoadFailed,
  EmptyBoard,
} from '@/components/whiteboard/BoardStates'
import { BoardUiContext, type BoardUi } from '@/components/whiteboard/board-ui'
import Canvas from '@/components/whiteboard/Canvas'
import {
  selectOnly as selectOnlyIn,
  type TransientMap,
} from '@/components/whiteboard/canvas-state'
import Inspector from '@/components/whiteboard/Inspector'
import SavePill from '@/components/whiteboard/SavePill'
import ShortcutsHelp from '@/components/whiteboard/ShortcutsHelp'
import { deletePlan } from '@/components/whiteboard/delete-plan'
import {
  canvasNodeId,
  escapeTarget,
  shortcutFor,
  type Tool,
} from '@/components/whiteboard/shortcuts'
import ToolRail from '@/components/whiteboard/ToolRail'
import TopBar from '@/components/whiteboard/TopBar'
import { useBoard } from '@/components/whiteboard/useBoard'
import { useReducedMotion, useTier } from '@/components/whiteboard/useTier'
import ZoomControls from '@/components/whiteboard/ZoomControls'
import { cn } from '@/lib/utils'
import type { Form, Shape } from '@/lib/whiteboard/limits'
import type { ClientItem } from '@/lib/whiteboard/types'

/**
 * `/admin/whiteboard` - the canvas app, client-only (React Flow measures the DOM).
 *
 * ```
 *   ┌ frame (viewport-sized, DR2) ──────────────────────────────────────────────┐
 *   │ TopBar: [grid] Whiteboard (pill)   [N hidden] [Backup] [Agents] [Export]   │
 *   ├────────────────────────────────────────────────────────────┬──────────────┤
 *   │ ToolRail   Canvas (React Flow, dot grid)                   │ Inspector    │
 *   │ Zoom                                    Export sheet (DR3) │ 320px (lg)   │
 *   └────────────────────────────────────────────────────────────┴──────────────┘
 *     md: inspector becomes a bottom sheet    sm: no drawing, view + edit (DR8)
 * ```
 *
 * ## Keyboard (DR9)
 *
 * One window listener, gated by `shortcutFor`, which refuses every single-key shortcut while
 * focus is in a field - a "t" typed into a title must be a letter. Esc peels one layer at a
 * time (tool, then an open surface, then the selection). Delete on a selection that holds
 * any item opens the confirm with counts; a selection of links only is deleted at once
 * (R3-7). Tab onto a card selects it, Enter edits it, and the arrows nudge the selection
 * 10px (Shift 50px) through the debounced PATCH. Nothing reaches the canvas while a dialog
 * is open.
 */

const CREATE_FORM: Partial<Record<Tool, { form: Form; shape?: Shape }>> = {
  text: { form: 'text' },
  todo: { form: 'todo' },
  rect: { form: 'shape', shape: 'rect' },
  ellipse: { form: 'shape', shape: 'ellipse' },
  diamond: { form: 'shape', shape: 'diamond' },
  frame: { form: 'frame' },
}

const HALF: Record<Form, { x: number; y: number }> = {
  text: { x: 120, y: 40 },
  todo: { x: 120, y: 40 },
  shape: { x: 90, y: 55 },
  frame: { x: 260, y: 180 },
  ink: { x: 0, y: 0 },
}

interface PendingDelete {
  items: string[]
  links: number
  frameChildren: number
  hiddenFrame: boolean
}

export default function WhiteboardApp() {
  return (
    <ReactFlowProvider>
      <WhiteboardShell />
    </ReactFlowProvider>
  )
}

function WhiteboardShell() {
  const board = useBoard()
  const { data, load, actions } = board
  const tier = useTier()
  const reducedMotion = useReducedMotion()
  const flow = useReactFlow()

  const [tool, setToolState] = useState<Tool>('select')
  const [nodeState, setNodeState] = useState<TransientMap>({})
  const [edgeSelection, setEdgeSelection] = useState<ReadonlySet<string>>(
    () => new Set()
  )
  const selection = useMemo(
    () => ({
      nodes: Object.keys(nodeState).filter(
        id => nodeState[id].selected && data.items[id]
      ),
      edges: [...edgeSelection].filter(id => data.links[id]),
    }),
    [data.items, data.links, edgeSelection, nodeState]
  )
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingEdgeId, setEditingEdgeId] = useState<string | null>(null)
  const [surface, setSurface] = useState<null | 'export' | 'agents' | 'backup'>(
    null
  )
  const [helpOpen, setHelpOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null)
  const [pulse, setPulse] = useState(0)
  const [exportScope, setExportScope] = useState<'all' | 'selection'>('all')
  const [restoreFile, setRestoreFile] = useState<File | null>(null)
  const [unhide, setUnhide] = useState<{
    frame: ClientItem
    readable: number
  } | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const readOnly = load.phase !== 'ready'
  const empty = load.phase === 'ready' && Object.keys(data.items).length === 0
  const drawingAllowed = tier !== 'sm'

  const setTool = useCallback(
    (next: Tool) =>
      setToolState(drawingAllowed || next === 'select' ? next : 'select'),
    [drawingAllowed]
  )

  const selectOnly = useCallback((ids: string[]) => {
    setNodeState(prev => selectOnlyIn(prev, ids))
    setEdgeSelection(new Set())
  }, [])

  const clearSelection = useCallback(() => selectOnly([]), [selectOnly])

  // MARK: Create

  const create = useCallback(
    (which: Tool, at: { x: number; y: number }) => {
      const spec = CREATE_FORM[which]
      if (!spec || readOnly) return
      const half = HALF[spec.form]
      const topLeft = {
        x: Math.round(at.x - half.x),
        y: Math.round(at.y - half.y),
      }
      const id =
        spec.form === 'shape' && spec.shape
          ? actions.addShape(spec.shape, topLeft)
          : actions.createItem(spec.form, topLeft)
      selectOnly([id])
      setToolState('select')
      setEditingId(id)
    },
    [actions, readOnly, selectOnly]
  )

  const createAtCentre = useCallback(
    (which: Tool) => {
      const bounds = document.querySelector('.wb-flow')?.getBoundingClientRect()
      const centre = bounds
        ? flow.screenToFlowPosition({
            x: bounds.left + bounds.width / 2,
            y: bounds.top + bounds.height / 2,
          })
        : { x: 0, y: 0 }
      create(which, centre)
    },
    [create, flow]
  )

  const openExport = useCallback(
    (scope: 'all' | 'selection') => {
      if (readOnly || empty) return
      setExportScope(scope)
      setSurface('export')
    },
    [empty, readOnly]
  )

  const pickRestoreFile = useCallback(() => fileInputRef.current?.click(), [])

  // MARK: Delete (R3-7, R3-19)

  const requestDelete = useCallback(() => {
    if (readOnly) return
    const plan = deletePlan(selection, data)
    if (plan?.kind === 'links') actions.deleteLinks(plan.ids)
    if (plan?.kind === 'confirm') {
      const { items, links, frameChildren, hiddenFrame } = plan
      setPendingDelete({ items, links, frameChildren, hiddenFrame })
    }
  }, [actions, data, readOnly, selection])

  const confirmDelete = useCallback(() => {
    if (!pendingDelete) return
    const extraLinks = selection.edges.filter(id => data.links[id])
    actions.deleteItems(pendingDelete.items)
    if (extraLinks.length) actions.deleteLinks(extraLinks)
    setPendingDelete(null)
    clearSelection()
  }, [actions, clearSelection, data.links, pendingDelete, selection.edges])

  const erase = useCallback(
    (id: string) => actions.deleteItems([id]),
    [actions]
  )

  // MARK: Keyboard

  const nudge = useCallback(
    (dx: number, dy: number) => {
      const moves = selection.nodes
        .map(id => {
          const abs = actions.absoluteOf(id)
          return abs ? { id, absolute: { x: abs.x + dx, y: abs.y + dy } } : null
        })
        .filter((m): m is NonNullable<typeof m> => m !== null)
      if (moves.length) actions.moveItems(moves, { debounce: true })
    },
    [actions, selection.nodes]
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // A dialog owns the keyboard while it is open, Esc included (its own handler).
      const action = shortcutFor(event, {
        modalOpen: Boolean(pendingDelete || helpOpen || unhide || restoreFile),
      })
      if (!action) return
      switch (action.type) {
        case 'edit':
          if (readOnly) return
          event.preventDefault()
          selectOnly([action.id])
          setEditingId(action.id)
          return
        case 'nudge':
          if (readOnly || !selection.nodes.length) return
          event.preventDefault()
          nudge(action.dx, action.dy)
          return
        case 'tool':
          if (readOnly) return
          event.preventDefault()
          setTool(action.tool)
          return
        case 'delete':
          event.preventDefault()
          requestDelete()
          return
        case 'help':
          event.preventDefault()
          setHelpOpen(true)
          return
        case 'export':
          event.preventDefault()
          openExport(selection.nodes.length > 1 ? 'selection' : 'all')
          return
        case 'leaveField':
          ;(event.target as HTMLElement | null)?.blur?.()
          return
        case 'escape': {
          const layer = escapeTarget({
            tool,
            surfaceOpen: surface !== null,
            hasSelection: selection.nodes.length + selection.edges.length > 0,
          })
          if (layer === 'tool') setToolState('select')
          if (layer === 'surface') setSurface(null)
          if (layer === 'selection') clearSelection()
          return
        }
      }
    }
    // Tab onto a card selects it, so the inspector, Delete and the arrow keys follow the
    // keyboard focus. Only for keyboard focus (:focus-visible): a click selects on its own.
    const onFocusIn = (event: FocusEvent) => {
      const id = canvasNodeId(event.target)
      const el = event.target as HTMLElement
      if (!id || readOnly || !el.matches?.(':focus-visible')) return
      if (selection.nodes.length === 1 && selection.nodes[0] === id) return
      selectOnly([id])
    }
    window.addEventListener('focusin', onFocusIn)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('focusin', onFocusIn)
    }
  }, [
    clearSelection,
    empty,
    helpOpen,
    nudge,
    openExport,
    pendingDelete,
    readOnly,
    requestDelete,
    restoreFile,
    selectOnly,
    selection,
    setTool,
    surface,
    tool,
    unhide,
  ])

  // MARK: Context for nodes

  const ui: BoardUi = useMemo(
    () => ({
      actions,
      tool,
      readOnly,
      editingId,
      setEditingId,
      editingEdgeId,
      setEditingEdgeId,
      focusBody: (id: string) => {
        selectOnly([id])
        requestAnimationFrame(() => document.getElementById('wb-body')?.focus())
      },
    }),
    [actions, editingEdgeId, editingId, readOnly, selectOnly, tool]
  )

  // The pulse class is on only for the length of the animation (900ms, whiteboard.css).
  // It used to stay on forever: a second click could not replay it, and cards hidden later,
  // or panned back into view (remounted), pulsed on their own.
  const pulseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (pulseTimer.current) clearTimeout(pulseTimer.current)
    },
    []
  )
  const showHidden = () => {
    if (reducedMotion) return
    if (pulseTimer.current) clearTimeout(pulseTimer.current)
    // Off for one frame first, so a click during a pulse restarts the animation.
    setPulse(0)
    requestAnimationFrame(() => {
      setPulse(Date.now())
      pulseTimer.current = setTimeout(() => setPulse(0), 1_000)
    })
  }

  const inspector = (
    <Inspector
      board={board}
      selection={selection}
      onDelete={requestDelete}
      onSelect={selectOnly}
      onExportSelection={() => openExport('selection')}
      onUnhideFrame={(frame, readable) => setUnhide({ frame, readable })}
      readOnly={readOnly}
    />
  )
  const hasSelection = selection.nodes.length + selection.edges.length > 0

  return (
    <BoardUiContext.Provider value={ui}>
      <div
        className={cn(
          'relative grid h-full min-h-0 grid-rows-[56px_minmax(0,1fr)] overflow-hidden rounded-panel border border-pp-line bg-[rgba(251,248,244,0.97)] shadow-panel backdrop-blur-md',
          tier === 'lg' ? 'grid-cols-[minmax(0,1fr)_320px]' : 'grid-cols-1'
        )}
      >
        <TopBar
          unsaved={
            board.status.failing > 0 ||
            (!board.status.online && board.status.pending > 0) ||
            Object.keys(board.errors).length > 0
          }
          className="col-span-full"
          pill={
            <SavePill
              load={load}
              status={board.status}
              rejected={Object.keys(board.errors).length}
              onRetry={actions.retryAll}
            />
          }
          hiddenCount={board.hiddenCount}
          onHiddenClick={showHidden}
          backup={
            <BackupMenu
              open={surface === 'backup'}
              onToggle={open => setSurface(open ? 'backup' : null)}
              onRestore={pickRestoreFile}
              beforeDownload={() => board.queue.flush()}
              compact={tier !== 'lg'}
            />
          }
          agents={
            <AgentsButton
              open={surface === 'agents'}
              onToggle={open => setSurface(open ? 'agents' : null)}
              compact={tier !== 'lg'}
            />
          }
          exportDisabled={readOnly || empty}
          exportOpen={surface === 'export'}
          onExport={() =>
            surface === 'export' ? setSurface(null) : openExport('all')
          }
          compact={tier === 'sm'}
        />

        <section
          aria-label="Canvas"
          className="relative col-start-1 row-start-2 min-h-0 min-w-0"
        >
          {/* Before the canvas in the DOM so Tab reaches the tools first (DR9). */}
          {drawingAllowed ? (
            <ToolRail
              tool={tool}
              onTool={setTool}
              disabled={readOnly}
              large={tier !== 'lg'}
            />
          ) : (
            <p className="absolute left-3 top-3 z-10 flex items-center gap-2 rounded-full border border-pp-line bg-white/90 px-3 py-2 text-[12px] text-pp-muted">
              <Pencil
                aria-hidden
                size={13}
              />
              Drawing needs a larger screen
            </p>
          )}

          <Canvas
            board={board}
            tool={tool}
            readOnly={readOnly}
            tier={tier}
            pulse={pulse}
            nodeState={nodeState}
            setNodeState={setNodeState}
            edgeSelection={edgeSelection}
            setEdgeSelection={setEdgeSelection}
            onEditItem={setEditingId}
            onEditEdge={setEditingEdgeId}
            onCreate={create}
            onErase={erase}
          >
            <ZoomControls />
          </Canvas>

          {tool === 'pen' && !readOnly ? (
            <InkLayer
              onStroke={(points, origin) => actions.addInk(points, origin)}
            />
          ) : null}

          {empty ? (
            <EmptyBoard
              onText={() => createAtCentre('text')}
              onFrame={() => createAtCentre('frame')}
              onRestore={pickRestoreFile}
            />
          ) : null}
          {load.phase === 'error' ? (
            <BoardLoadFailed
              message={load.message}
              onRetry={board.retryLoad}
            />
          ) : null}
          {board.notice ? (
            <div
              role="status"
              className="absolute bottom-3.5 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 rounded-full border border-pp-line bg-pp-panel-strong px-4 py-2 text-[12.5px] text-pp-text shadow-panel"
            >
              {board.notice}
              <button
                type="button"
                className="font-semibold text-pp-muted hover:text-pp-text"
                onClick={() => board.setNotice(null)}
              >
                Dismiss
              </button>
            </div>
          ) : null}
        </section>

        {tier === 'lg' ? (
          <div className="col-start-2 row-start-2 min-h-0 overflow-y-auto border-l border-pp-line bg-white/70">
            {inspector}
          </div>
        ) : hasSelection ? (
          <div
            className="absolute inset-x-0 bottom-0 z-30 max-h-[60dvh] overflow-y-auto rounded-t-[1.4rem] border-t border-pp-line bg-pp-panel-strong pb-[env(safe-area-inset-bottom)] shadow-panel"
            role="dialog"
            aria-label="Inspector"
          >
            {inspector}
          </div>
        ) : null}

        {surface === 'export' ? (
          <ExportSheet
            key={exportScope}
            board={board}
            selectionIds={selection.nodes}
            initialScope={exportScope}
            onClose={() => setSurface(null)}
          />
        ) : null}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        aria-hidden
        tabIndex={-1}
        onChange={event => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) setRestoreFile(file)
        }}
      />
      {restoreFile ? (
        <RestoreDialog
          file={restoreFile}
          pendingSaves={board.status.pending}
          onClose={() => setRestoreFile(null)}
          onRestored={board.retryLoad}
        />
      ) : null}
      <ConfirmDialog
        open={unhide !== null}
        title={`Make "${unhide?.frame.title || 'Untitled frame'}" readable?`}
        message={
          <p>
            {unhide?.readable} item{unhide?.readable === 1 ? '' : 's'} inside
            become{unhide?.readable === 1 ? 's' : ''} agent-readable.
          </p>
        }
        destructive={false}
        secondaryLabel="Keep items private"
        onSecondary={() => {
          if (unhide)
            actions.updateItem(
              unhide.frame._id,
              { includeInAi: true },
              { delay: 0, keepChildrenPrivate: true }
            )
          setUnhide(null)
        }}
        confirmLabel="Make all readable"
        onConfirm={() => {
          if (unhide)
            actions.updateItem(
              unhide.frame._id,
              { includeInAi: true },
              { delay: 0 }
            )
          setUnhide(null)
        }}
        onCancel={() => setUnhide(null)}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        title={
          pendingDelete
            ? `Delete ${pendingDelete.items.length} item${pendingDelete.items.length === 1 ? '' : 's'}${
                pendingDelete.links
                  ? ` and ${pendingDelete.links} link${pendingDelete.links === 1 ? '' : 's'}`
                  : ''
              }?`
            : ''
        }
        message={
          <>
            <p>
              This is permanent. Download a backup first if you might want it
              back.
            </p>
            {pendingDelete?.frameChildren ? (
              <p className="mt-2">
                {pendingDelete.hiddenFrame
                  ? `Its ${pendingDelete.frameChildren} items stay on the board, and stay private.`
                  : `Its ${pendingDelete.frameChildren} items stay on the board.`}
              </p>
            ) : null}
          </>
        }
        confirmLabel="Delete permanently"
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
      <ShortcutsHelp
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
      />
    </BoardUiContext.Provider>
  )
}
