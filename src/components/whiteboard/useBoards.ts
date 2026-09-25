'use client'

import { useCallback, useEffect, useState } from 'react'

import type { ClientBoard } from '@/lib/whiteboard/data'
import type { SharePatch } from '@/lib/whiteboard/limits'
import {
  createBoardApi,
  deleteBoardApi,
  getBoardsApi,
  patchBoardApi,
} from '@/requests/whiteboard'

/**
 * The board list (D32), shared by the index page and the top bar's switcher.
 *
 * Not the save queue: a board is renamed or deleted once in a while, deliberately, and each
 * of those is one request the owner is waiting for. The queue exists for the canvas, where
 * an edit is one of fifty a minute and must never block the hand that made it.
 *
 * Every write updates the local list from the server's answer rather than guessing, so a
 * title the server trimmed is the title on screen.
 *
 * `enabled: false` is the shared canvas (a share link): the list is the owner's, the route
 * behind it is owner-only, and a visitor's page asking for it would be a 401 at best.
 */
export interface BoardsState {
  boards: ClientBoard[]
  loading: boolean
  error: string | null
  reload: () => void
  create: (title: string) => Promise<ClientBoard>
  rename: (id: string, title: string) => Promise<void>
  setIncludeInAi: (id: string, includeInAi: boolean) => Promise<void>
  /** Who the link lets in, and/or its readable name (`null` clears it). */
  setSharing: (id: string, patch: SharePatch) => Promise<void>
  remove: (id: string) => Promise<void>
}

export function useBoards({ enabled = true } = {}): BoardsState {
  const [boards, setBoards] = useState<ClientBoard[]>([])
  // Starts true and only ever ends: a reload keeps the list on screen rather than blanking
  // it, so renaming a board does not make the page flash back to a spinner.
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    getBoardsApi()
      .then(list => {
        if (cancelled) return
        setBoards(list)
        setError(null)
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setError(e instanceof Error ? e.message : 'Could not load boards.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [enabled, nonce])

  const reload = useCallback(() => setNonce(n => n + 1), [])

  const create = useCallback(async (title: string) => {
    const board = await createBoardApi(title)
    setBoards(prev => [...prev, board])
    return board
  }, [])

  const replace = (board: ClientBoard) =>
    setBoards(prev => prev.map(b => (b._id === board._id ? board : b)))

  const rename = useCallback(async (id: string, title: string) => {
    replace(await patchBoardApi(id, { title }))
  }, [])

  const setIncludeInAi = useCallback(
    async (id: string, includeInAi: boolean) => {
      replace(await patchBoardApi(id, { includeInAi }))
    },
    []
  )

  const setSharing = useCallback(async (id: string, patch: SharePatch) => {
    replace(await patchBoardApi(id, patch))
  }, [])

  const remove = useCallback(async (id: string) => {
    await deleteBoardApi(id)
    setBoards(prev => prev.filter(board => board._id !== id))
  }, [])

  return {
    boards,
    loading,
    error,
    reload,
    create,
    rename,
    setIncludeInAi,
    setSharing,
    remove,
  }
}
