'use client'

import { ReactFlowProvider, useReactFlow } from '@xyflow/react'
import { Eye, Undo2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import ConfirmDialog from '@/components/admin/ConfirmDialog'
import { BackupMenu, RestoreDialog } from '@/components/whiteboard/Backup'
import BoardSwitcher from '@/components/whiteboard/BoardSwitcher'
import ExportSheet from '@/components/whiteboard/ExportSheet'
import InkLayer from '@/components/whiteboard/InkLayer'
import {
  BoardLoadFailed,
  EmptyBoard,
  SharedEmptyBoard,
} from '@/components/whiteboard/BoardStates'
import { OWNER_ACCESS, type BoardAccess } from '@/components/whiteboard/access'
import { BoardUiContext, type BoardUi } from '@/components/whiteboard/board-ui'
import Canvas from '@/components/whiteboard/Canvas'
import {
  selectOnly as selectOnlyIn,
  type TransientMap,
} from '@/components/whiteboard/canvas-state'
import Inspector from '@/components/whiteboard/Inspector'
import SavePill from '@/components/whiteboard/SavePill'
import { CopyLinkButton, ShareMenu } from '@/components/whiteboard/ShareMenu'
import ShortcutsHelp from '@/components/whiteboard/ShortcutsHelp'
import { deletePlan, deletedText } from '@/components/whiteboard/delete-plan'
import {
  canvasNodeId,
  escapeTarget,
  shortcutFor,
  type Tool,
} from '@/components/whiteboard/shortcuts'
import ToolRail from '@/components/whiteboard/ToolRail'
import VocabDialog from '@/components/whiteboard/VocabDialog'
import {
  VocabProvider,
  useVocabState,
} from '@/components/whiteboard/vocab-context'
import TopBar from '@/components/whiteboard/TopBar'
import { useBoard } from '@/components/whiteboard/useBoard'
import { useBoards } from '@/components/whiteboard/useBoards'
import {
  useCoarsePointer,
  useReducedMotion,
  useTier,
} from '@/components/whiteboard/useTier'
import ZoomControls from '@/components/whiteboard/ZoomControls'
import { cn } from '@/lib/utils'
import type { Form, Shape } from '@/lib/whiteboard/limits'
import type { ClientItem } from '@/lib/whiteboard/types'
import type { VocabKind } from '@/lib/whiteboard/vocab'

/**
 * `/admin/whiteboard` - the canvas app, client-only (React Flow measures the DOM).
 *
 * ```
 *   ┌ frame (viewport-sized, DR2) ──────────────────────────────────────────────┐
 *   │ TopBar: [grid] Whiteboard (pill)   [N hidden] [Backup] [Export]            │
 *   ├────────────────────────────────────────────────────────────┬──────────────┤
 *   │ ToolRail   Canvas (React Flow, dot grid)                   │ Inspector    │
 *   │                                                            │ (only while  │
 *   │                                                            │  selected)   │
 *   │                   Export sheet (DR3)  Zoom + lock (right) │ 320px (lg)   │
 *   └────────────────────────────────────────────────────────────┴──────────────┘
 *     md: inspector becomes a bottom sheet (60dvh)
 *     sm: + the rail lies along the top and folds away; the inspector covers the whole
 *         canvas, header to bottom edge, with a close button (DR8)
 *     every tier has every tool; a finger (not the width) changes the gestures (Canvas.tsx)
 * ```
 *
 * ## Locked (the lock beside the zoom)
 *
 * `frozen` is `readOnly || locked`, and everything here checks it in place of `readOnly`:
 * the canvas (no drag, resize, link, create or select), create, delete, nudge, the tool
 * keys, undo/redo and the inline editors (`ui.readOnly`). So a locked board is a view link
 * for as long as the lock is on: pan and zoom, nothing else. Nothing selects either, so no
 * inspector opens - the owner asked for that (2026-09-25): a tap on a locked board is for
 * looking, and a sheet over the whole phone screen is the opposite of looking. Locking
 * clears the selection for the same reason. Undo is frozen too: stepping history back is an
 * edit, and a locked board promised none. Save and Export stay live, because neither
 * changes the board.
 *
 * ## Keyboard (DR9)
 *
 * One window listener, gated by `shortcutFor`, which refuses every single-key shortcut while
 * focus is in a field - a "t" typed into a title must be a letter. Esc peels one layer at a
 * time (tool, then an open surface, then the selection). Tab onto a card selects it, Enter
 * edits it, and the arrows nudge the selection 10px (Shift 50px) through the debounced
 * PATCH. Nothing reaches the canvas while a dialog is open.
 *
 * ## Delete does not ask (R3-7, D30)
 *
 * Delete removes the selection at once and says so on a toast that carries Undo, and
 * Cmd/Ctrl+Z does the same from the keyboard. It used to open a confirm counting the items
 * and links, which was the only thing standing between a mis-aimed Delete and a hard delete
 * - and it charged that toll on every deliberate delete too, which is most of them. An undo
 * that restores the cards, their links and their frame membership is a better answer to the
 * same danger, so the dialog came out rather than being kept as well: a confirm in front of
 * an undoable action is a click that protects nothing.
 *
 * ## One app for the owner and for a share link (access.ts)
 *
 * ```
 *   owner            every control, the owner API
 *   shared 'edit'    the same canvas and tools, the share API; no switcher, backup, export,
 *                    vocab editing or AI switches - Share is "Copy link"
 *   shared 'view'    the same canvas, read-only for good: no rail, no inspector column
 * ```
 *
 * View mode is the `readOnly` the canvas already has for a board that is still loading
 * (DR4), held on permanently, so it reuses every guard that state already had - nothing
 * drags, nothing opens an editor, no shortcut writes. The server refuses the writes anyway
 * (share.ts); this is only the page not offering them.
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

export default function WhiteboardApp({
  boardId,
  access = OWNER_ACCESS,
}: {
  boardId: string
  access?: BoardAccess
}) {
  return (
    <ReactFlowProvider>
      <WhiteboardShell
        boardId={boardId}
        access={access}
      />
    </ReactFlowProvider>
  )
}

function WhiteboardShell({
  boardId,
  access,
}: {
  boardId: string
  access: BoardAccess
}) {
  const shared = access.kind === 'shared'
  const isOwner = !shared
  const viewOnly = access.kind === 'shared' && access.mode === 'view'
  const scope = useMemo(() => ({ board: boardId, shared }), [boardId, shared])
  const vocabState = useVocabState(scope)
  const board = useBoard(scope, vocabState.vocab)
  const boards = useBoards({ enabled: isOwner })
  const current = boards.boards.find(entry => entry._id === boardId) ?? null
  const { data, load, actions } = board
  const tier = useTier()
  const coarse = useCoarsePointer()
  const reducedMotion = useReducedMotion()
  const flow = useReactFlow()

  const [tool, setToolState] = useState<Tool>('select')
  // Touch only (Canvas.tsx): the next one-finger drag on the pane draws a selection box.
  const [boxSelect, setBoxSelect] = useState(false)
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
  const [surface, setSurface] = useState<null | 'export' | 'backup' | 'share'>(
    null
  )
  const [helpOpen, setHelpOpen] = useState(false)
  const [vocabKind, setVocabKind] = useState<VocabKind | null>(null)
  const closeVocab = useCallback(() => setVocabKind(null), [])
  const [pulse, setPulse] = useState(0)
  const [exportScope, setExportScope] = useState<'all' | 'selection'>('all')
  const [restoreFile, setRestoreFile] = useState<File | null>(null)
  const [unhide, setUnhide] = useState<{
    frame: ClientItem
    readable: number
  } | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const readOnly = load.phase !== 'ready' || viewOnly
  const [locked, setLocked] = useState(false)
  const frozen = readOnly || locked
  // Below md only (the horizontal rail): the tools fold away behind one button.
  const [railOpen, setRailOpen] = useState(true)
  const empty = load.phase === 'ready' && Object.keys(data.items).length === 0
  const setTool = useCallback((next: Tool) => {
    setBoxSelect(false)
    setToolState(next)
  }, [])
  const toggleBoxSelect = useCallback(() => {
    setToolState('select')
    setBoxSelect(on => !on)
  }, [])
  const endBoxSelect = useCallback(() => setBoxSelect(false), [])

  const selectOnly = useCallback((ids: string[]) => {
    setNodeState(prev => selectOnlyIn(prev, ids))
    setEdgeSelection(new Set())
  }, [])

  const clearSelection = useCallback(() => selectOnly([]), [selectOnly])

  // MARK: Create

  const create = useCallback(
    (which: Tool, at: { x: number; y: number }) => {
      const spec = CREATE_FORM[which]
      if (!spec || frozen) return
      const half = HALF[spec.form]
      const topLeft = {
        x: Math.round(at.x - half.x),
        y: Math.round(at.y - half.y),
      }
      const id =
        spec.form === 'shape' && spec.shape
          ? actions.addShape(spec.shape, topLeft)
          : actions.createItem(spec.form, topLeft)
      // Not selected: a selection opens the inspector (the bottom sheet below lg), and a new
      // card goes straight into its own title editor instead. A click selects it, as with
      // any other card. Whatever was selected before lets go, so no stale inspector lingers.
      selectOnly([])
      setToolState('select')
      setEditingId(id)
    },
    [actions, frozen, selectOnly]
  )

  const viewCentre = useCallback(() => {
    const bounds = document.querySelector('.wb-flow')?.getBoundingClientRect()
    return bounds
      ? flow.screenToFlowPosition({
          x: bounds.left + bounds.width / 2,
          y: bounds.top + bounds.height / 2,
        })
      : { x: 0, y: 0 }
  }, [flow])

  const createAtCentre = useCallback(
    (which: Tool) => create(which, viewCentre()),
    [create, viewCentre]
  )

  const openExport = useCallback(
    (which: 'all' | 'selection') => {
      // Export to AI feeds the owner's agents; a share link has no export (access.ts).
      if (readOnly || empty || !isOwner) return
      setExportScope(which)
      setSurface('export')
    },
    [empty, isOwner, readOnly]
  )

  const pickRestoreFile = useCallback(() => fileInputRef.current?.click(), [])

  /** "Add sample data" (D33): a board's worth of cards around the middle of the view. */
  const addMock = useCallback(() => {
    if (frozen || !isOwner) return
    const ids = actions.addMock(viewCentre())
    setSurface(null)
    selectOnly([])
    // Frame the result, so the seed is not dropped somewhere off screen.
    requestAnimationFrame(() =>
      flow.fitView({
        nodes: ids.map(id => ({ id })),
        duration: 300,
        padding: 0.2,
      })
    )
  }, [actions, flow, frozen, isOwner, selectOnly, viewCentre])

  // MARK: Undo / redo (D30)

  const stepHistory = useCallback(
    (which: 'undo' | 'redo') => {
      if (frozen) return
      const plan =
        which === 'undo' ? board.history.undo() : board.history.redo()
      // Cards that came back are selected, so the inspector is on what just reappeared and
      // a second Delete is aimed at it rather than at nothing.
      if (plan?.createItems.length)
        selectOnly(plan.createItems.map(item => item._id))
    },
    [board.history, frozen, selectOnly]
  )
  const undoStep = useCallback(() => stepHistory('undo'), [stepHistory])
  const redoStep = useCallback(() => stepHistory('redo'), [stepHistory])

  // MARK: Delete (R3-7, R3-19, D30)

  const deleteSelection = useCallback(() => {
    if (frozen) return
    const plan = deletePlan(selection, data)
    if (!plan) return
    if (plan.kind === 'links') actions.deleteLinks(plan.ids)
    else
      actions.deleteItems(
        plan.items,
        selection.edges.filter(id => data.links[id])
      )
    clearSelection()
    // After the actions: each of them clears a stale Undo toast as it records its own step.
    board.setNotice({ text: deletedText(plan), undo: undoStep })
  }, [actions, board, clearSelection, data, frozen, selection, undoStep])

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
        modalOpen: Boolean(helpOpen || unhide || restoreFile || vocabKind),
      })
      if (!action) return
      switch (action.type) {
        case 'edit':
          if (frozen) return
          event.preventDefault()
          selectOnly([action.id])
          setEditingId(action.id)
          return
        case 'nudge':
          if (frozen || !selection.nodes.length) return
          event.preventDefault()
          nudge(action.dx, action.dy)
          return
        case 'tool':
          if (frozen) return
          event.preventDefault()
          setTool(action.tool)
          return
        case 'delete':
          event.preventDefault()
          deleteSelection()
          return
        case 'save':
          // Always prevented, in both modes: the browser's own Save dialog on a canvas app
          // is never what the chord meant.
          event.preventDefault()
          if (!readOnly) board.saveNow()
          return
        case 'undo':
        case 'redo':
          event.preventDefault()
          stepHistory(action.type)
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
          if (layer === 'tool') setTool('select')
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
      if (!id || frozen || !el.matches?.(':focus-visible')) return
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
    board,
    clearSelection,
    deleteSelection,
    empty,
    frozen,
    helpOpen,
    nudge,
    openExport,
    readOnly,
    restoreFile,
    selectOnly,
    selection,
    setTool,
    stepHistory,
    surface,
    tool,
    unhide,
    vocabKind,
  ])

  // An Undo toast takes itself away: its offer expires with the next edit anyway (useBoard
  // clears it), and a delete the owner meant to make should not leave a bar on the canvas.
  const { notice, setNotice } = board
  useEffect(() => {
    if (!notice?.undo) return
    const timer = setTimeout(() => setNotice(null), 8_000)
    return () => clearTimeout(timer)
  }, [notice, setNotice])

  // MARK: Context for nodes

  const ui: BoardUi = useMemo(
    () => ({
      actions,
      tool,
      // The nodes' own editors and resize handles: locked is as good as read-only to them.
      readOnly: frozen,
      editingId,
      setEditingId,
      editingEdgeId,
      setEditingEdgeId,
      focusBody: (id: string) => {
        selectOnly([id])
        requestAnimationFrame(() => document.getElementById('wb-body')?.focus())
      },
    }),
    [actions, editingEdgeId, editingId, frozen, selectOnly, tool]
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
      onDelete={deleteSelection}
      onSelect={selectOnly}
      onExportSelection={isOwner ? () => openExport('selection') : undefined}
      onUnhideFrame={(frame, readable) => setUnhide({ frame, readable })}
      onManageVocab={isOwner ? setVocabKind : undefined}
      readOnly={frozen}
      aiControls={isOwner}
    />
  )
  const hasSelection = selection.nodes.length + selection.edges.length > 0

  const toggleLock = useCallback(() => {
    setLocked(on => !on)
    // Whatever was mid-edit, mid-tool or selected lets go, so locking never leaves an editor
    // or an inspector open on a board that now refuses both.
    setTool('select')
    setEditingId(null)
    setEditingEdgeId(null)
    clearSelection()
  }, [clearSelection, setTool])
  /**
   * Writes that leaving would lose. A write that is merely queued under auto-save is not one
   * of them: it goes out on unmount and finishes during the navigation. One that is held
   * (D31), failed, refused, or waiting for the network does not.
   */
  const unsavedCount =
    (board.status.holding || !board.status.online
      ? board.status.pending
      : board.status.failing) + Object.keys(board.errors).length

  /**
   * Every way off this canvas (the top bar's grid icon, and the switcher's three) runs
   * through here: leaving unmounts the board and stops its queue, and a paused queue sends
   * nothing on the way out, so anything held is gone. `beforeunload` covers a reload or a
   * closed tab; a client-side navigation never fires it.
   */
  const [leaving, setLeaving] = useState<{ go: () => void } | null>(null)
  const onLeave = useCallback(
    (go: () => void) => {
      if (unsavedCount > 0) setLeaving({ go })
      else go()
    },
    [unsavedCount]
  )

  return (
    <VocabProvider value={vocabState}>
      <BoardUiContext.Provider value={ui}>
        <div
          className={cn(
            'relative grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-panel border border-pp-line bg-[rgba(251,248,244,0.97)] shadow-panel backdrop-blur-md',
            // The column is there only while something is selected: "Nothing selected" and a
            // shortcut list took 320px of canvas on every visit (the list is still on `?`).
            tier === 'lg' && !viewOnly && hasSelection
              ? 'grid-cols-[minmax(0,1fr)_320px]'
              : 'grid-cols-1'
          )}
        >
          <TopBar
            onLeave={isOwner ? onLeave : undefined}
            className="col-span-full"
            pill={
              // A view link saves nothing, so "Saved" would be a claim about nothing; say
              // what the page is instead - once it has loaded, so a failed load still shows.
              viewOnly && load.phase === 'ready' ? (
                <span
                  data-testid="wb-view-only"
                  className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-pp-line bg-white/80 px-2.5 py-1 font-display text-[10.5px] font-semibold uppercase tracking-[0.13em] text-pp-muted"
                >
                  <Eye
                    aria-hidden
                    size={13}
                  />
                  View only
                </span>
              ) : (
                <SavePill
                  load={load}
                  status={board.status}
                  rejected={Object.keys(board.errors).length}
                  onRetry={actions.retryAll}
                />
              )
            }
            save={
              viewOnly
                ? undefined
                : {
                    autoSave: board.autoSave,
                    onAutoSave: board.setAutoSave,
                    onSave: board.saveNow,
                    pending: board.status.pending,
                    disabled: readOnly,
                  }
            }
            hiddenCount={
              // "Hidden from AI" is the owner's business, not a visitor's (access.ts).
              shared
                ? 0
                : // A board agents cannot read hides everything on it, so the chip says so
                  // rather than counting the cards that happen to carry their own switch (D32).
                  current && !current.includeInAi
                  ? Object.keys(data.items).length
                  : board.hiddenCount
            }
            boardHidden={current ? !current.includeInAi : false}
            onHiddenClick={showHidden}
            boardSwitcher={
              access.kind === 'shared' ? (
                <h1
                  className="min-w-0 truncate px-1 font-display text-[15px] font-semibold tracking-[-0.01em] text-pp-text"
                  title={access.title || 'Whiteboard'}
                >
                  {access.title || 'Whiteboard'}
                </h1>
              ) : (
                <BoardSwitcher
                  boards={boards.boards}
                  currentId={boardId}
                  title={current?.title || 'Whiteboard'}
                  onCreate={async () => {
                    const made = await boards
                      .create('New board')
                      .catch(() => null)
                    return made?._id ?? null
                  }}
                  onRename={next => boards.rename(boardId, next)}
                  onIncludeInAi={on => boards.setIncludeInAi(boardId, on)}
                  onLeave={onLeave}
                />
              )
            }
            onOpenShare={isOwner ? () => setSurface('share') : undefined}
            onOpenBackup={isOwner ? () => setSurface('backup') : undefined}
            share={
              access.kind === 'shared' ? (
                <CopyLinkButton path={access.path} />
              ) : (
                <ShareMenu
                  board={current}
                  open={surface === 'share'}
                  onToggle={open => setSurface(open ? 'share' : null)}
                  onChange={patch => boards.setSharing(boardId, patch)}
                />
              )
            }
            backup={
              isOwner ? (
                <BackupMenu
                  boardId={boardId}
                  open={surface === 'backup'}
                  onToggle={open => setSurface(open ? 'backup' : null)}
                  onRestore={pickRestoreFile}
                  onMock={addMock}
                  mockDisabled={frozen}
                  beforeDownload={() => board.queue.flush()}
                  heldWrites={board.status.holding ? board.status.pending : 0}
                />
              ) : undefined
            }
            exportDisabled={readOnly || empty}
            exportOpen={surface === 'export'}
            onExport={
              isOwner
                ? () =>
                    surface === 'export' ? setSurface(null) : openExport('all')
                : undefined
            }
          />

          <section
            aria-label="Canvas"
            className="relative col-start-1 row-start-2 min-h-0 min-w-0"
          >
            {/* Before the canvas in the DOM so Tab reaches the tools first (DR9). A view link
                has no tools to offer, so no rail rather than a rail of disabled buttons. */}
            {viewOnly ? null : (
              <ToolRail
                tool={tool}
                onTool={setTool}
                disabled={frozen}
                large={tier !== 'lg' || coarse}
                horizontal={tier === 'sm'}
                boxSelect={
                  coarse
                    ? { on: boxSelect, onToggle: toggleBoxSelect }
                    : undefined
                }
                // Where there may be no keyboard for Cmd/Ctrl+Z (ToolRail).
                history={
                  tier !== 'lg' || coarse
                    ? {
                        onUndo: undoStep,
                        onRedo: redoStep,
                        canUndo: board.history.canUndo,
                        canRedo: board.history.canRedo,
                      }
                    : undefined
                }
                collapse={
                  tier === 'sm'
                    ? { open: railOpen, onToggle: () => setRailOpen(o => !o) }
                    : undefined
                }
              />
            )}

            <Canvas
              board={board}
              tool={tool}
              readOnly={frozen}
              aiStyling={isOwner}
              coarse={coarse}
              boxSelect={boxSelect}
              onBoxSelectDone={endBoxSelect}
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
              <ZoomControls
                lock={
                  viewOnly
                    ? undefined
                    : { on: locked, onToggle: toggleLock, disabled: readOnly }
                }
              />
            </Canvas>

            {tool === 'pen' && !frozen ? (
              <InkLayer
                onStroke={(points, origin) => actions.addInk(points, origin)}
              />
            ) : null}

            {empty && isOwner ? (
              <EmptyBoard
                onText={() => createAtCentre('text')}
                onFrame={() => createAtCentre('frame')}
                onMock={addMock}
                onRestore={pickRestoreFile}
              />
            ) : null}
            {empty && shared ? (
              <SharedEmptyBoard
                onText={viewOnly ? undefined : () => createAtCentre('text')}
                onFrame={viewOnly ? undefined : () => createAtCentre('frame')}
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
                data-testid="wb-notice"
                // Above the zoom cluster, not beside it: on a phone, and on a narrow lg canvas
                // next to the inspector, the two are wider together than the board.
                className="absolute bottom-[4.75rem] left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 rounded-full border border-pp-line bg-pp-panel-strong px-4 py-2 text-[12.5px] text-pp-text shadow-panel lg:bottom-16"
              >
                {board.notice.text}
                {board.notice.undo ? (
                  <button
                    type="button"
                    className="flex items-center gap-1.5 font-semibold text-pp-text hover:text-pp-blue"
                    onClick={board.notice.undo}
                  >
                    <Undo2
                      aria-hidden
                      size={13}
                    />
                    Undo
                  </button>
                ) : null}
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

          {viewOnly || !hasSelection ? null : tier === 'lg' ? (
            <div className="col-start-2 row-start-2 min-h-0 overflow-y-auto border-l border-pp-line bg-white/70">
              {inspector}
            </div>
          ) : (
            <div
              className={cn(
                'z-30 overflow-y-auto border-pp-line bg-pp-panel-strong pb-[env(safe-area-inset-bottom)] shadow-panel',
                // A phone: the canvas's whole cell, header to bottom edge. A 60dvh sheet
                // left a strip of board too thin to use and a form too short to fill in.
                tier === 'sm'
                  ? 'relative col-start-1 row-start-2 min-h-0'
                  : 'absolute inset-x-0 bottom-0 max-h-[60dvh] rounded-t-[1.4rem] border-t',
                // The Export sheet's entrance (whiteboard.css), so the two sheets arrive alike.
                // Only on appearing: the sheet stays mounted while the selection moves from one
                // card to the next, so picking another card does not replay it.
                !reducedMotion && 'animate-[wb-sheet-up_180ms_ease-out]'
              )}
              role="dialog"
              aria-label="Inspector"
            >
              {/* Outside the inspector's fieldset, so a board still loading can close it. */}
              <div className="sticky top-0 z-10 flex justify-end bg-pp-panel-strong/95 px-2 pt-2 backdrop-blur-sm">
                <button
                  type="button"
                  aria-label="Close inspector"
                  title="Close"
                  onClick={clearSelection}
                  className="grid h-10 w-10 place-items-center rounded-full text-pp-muted hover:bg-pp-text/5 hover:text-pp-text"
                >
                  <X
                    aria-hidden
                    size={18}
                  />
                </button>
              </div>
              {inspector}
            </div>
          )}

          {surface === 'export' && isOwner ? (
            <ExportSheet
              key={exportScope}
              board={board}
              boardVisible={current?.includeInAi ?? true}
              unsavedCount={unsavedCount}
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
        {restoreFile && isOwner ? (
          <RestoreDialog
            boardId={boardId}
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
          open={leaving !== null}
          title="Leave with unsaved changes?"
          message={
            <p>
              {unsavedCount === 1
                ? '1 change has not been written to the server'
                : `${unsavedCount} changes have not been written to the server`}
              . Leaving loses them. Save first, or download a backup.
            </p>
          }
          confirmLabel="Leave without saving"
          onConfirm={() => {
            const go = leaving?.go
            setLeaving(null)
            go?.()
          }}
          onCancel={() => setLeaving(null)}
        />

        <ShortcutsHelp
          open={helpOpen}
          onClose={() => setHelpOpen(false)}
        />
        {isOwner ? (
          <VocabDialog
            // A fresh dialog per open, on the tab it was opened from.
            key={vocabKind ?? 'closed'}
            kind={vocabKind}
            onClose={closeVocab}
          />
        ) : null}
      </BoardUiContext.Provider>
    </VocabProvider>
  )
}
