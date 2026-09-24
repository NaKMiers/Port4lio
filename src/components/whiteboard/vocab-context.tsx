'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'

import { DEFAULT_VOCAB, type Vocab } from '@/lib/whiteboard/vocab'
import { getVocabApi, type VocabSnapshot } from '@/requests/whiteboard'

/**
 * The owner's meanings and statuses, for everything on the canvas that names one: chips,
 * inspector options, the export filters, the status rule the board mirrors locally.
 *
 * ```
 *   WhiteboardShell ──▶ useVocabState (GET /api/admin/whiteboard/vocab once) ──▶ Provider
 *   Manage dialog ──▶ a write answers the whole new list ──▶ setSnapshot ──▶ every chip
 * ```
 *
 * A context rather than `node.data`: a list change is rare and should re-render every chip,
 * while `data` is what React Flow compares per node (board-ui.tsx). Until the first answer
 * the original list stands in, so a board that never changed it renders exactly as before.
 */

export interface VocabState {
  vocab: Vocab
  usage: VocabSnapshot['usage'] | null
  loaded: boolean
  /** A write's answer (the whole list, and the usage). */
  setSnapshot: (snapshot: VocabSnapshot) => void
  reload: () => Promise<void>
}

const VocabContext = createContext<VocabState | null>(null)

export const VocabProvider = VocabContext.Provider

export function useVocabState(): VocabState {
  const [snapshot, setSnapshot] = useState<VocabSnapshot | null>(null)

  const reload = useCallback(async () => {
    try {
      setSnapshot(await getVocabApi())
    } catch (error) {
      // The default list keeps the board usable; the dialog shows its own load error.
      console.error('[whiteboard] vocab load failed', error)
    }
  }, [])

  useEffect(() => {
    // The setState runs after the fetch resolves, never synchronously in this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload()
  }, [reload])

  // Stable between list changes: every chip reads this context, and a new object per shell
  // render would re-render all of them on every keystroke.
  return useMemo(
    () => ({
      vocab: snapshot?.vocab ?? DEFAULT_VOCAB,
      usage: snapshot?.usage ?? null,
      loaded: snapshot !== null,
      setSnapshot,
      reload,
    }),
    [reload, snapshot]
  )
}

export function useVocab(): VocabState {
  const state = useContext(VocabContext)
  if (!state) throw new Error('useVocab outside the whiteboard')
  return state
}
