'use client'

import { createContext, useContext } from 'react'

import type { Tool } from '@/components/whiteboard/shortcuts'
import type { BoardActions } from '@/components/whiteboard/useBoard'
import type { ClientItem } from '@/lib/whiteboard/types'

/**
 * What a node or an edge needs from the board without it riding along in `node.data`.
 *
 * React Flow re-renders a node when its `data` object changes, so `data` carries only the
 * item and its derived flags. Actions and the "who is being edited" state live here instead,
 * which keeps a keystroke in one card from re-rendering every other card.
 */
export interface BoardUi {
  actions: BoardActions
  tool: Tool
  readOnly: boolean
  editingId: string | null
  setEditingId: (id: string | null) => void
  editingEdgeId: string | null
  setEditingEdgeId: (id: string | null) => void
  /** Focus the inspector's Body field ("... more" on a clamped card, DR10). */
  focusBody: (id: string) => void
}

export const BoardUiContext = createContext<BoardUi | null>(null)

export function useBoardUi(): BoardUi {
  const ui = useContext(BoardUiContext)
  if (!ui) throw new Error('useBoardUi outside the whiteboard')
  return ui
}

/** The flags a node renders from, computed once per item by the canvas. */
export interface ItemNodeData extends Record<string, unknown> {
  item: ClientItem
  /** Effectively hidden from agents (own flag, or a hidden/missing frame). */
  hidden: boolean
  /** Hidden because its frame is, whatever its own flag says. */
  hiddenByFrame: boolean
  error: string | null
  childCount: number
  pulse: number
}
