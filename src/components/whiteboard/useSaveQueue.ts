'use client'

import { useCallback, useEffect, useState } from 'react'

import { SaveQueue, type QueueStatus } from '@/components/whiteboard/save-queue'
import { sendSaveOpApi } from '@/requests/whiteboard'

/**
 * The React side of the save queue: one `SaveQueue` per board, plus the browser signals it
 * needs.
 *
 * ```
 *   useBoard actions ──▶ queue.createItem / patchItem / bulkMove / deleteItem / ...
 *                              │           (ordering, debounce, deps, retry: save-queue.ts)
 *                              ▼
 *                        sendSaveOpApi ──▶ /api/admin/whiteboard/*
 *
 *   window 'offline' ──▶ queue.setOnline(false)   pill: "Offline - changes kept"
 *   window 'online'  ──▶ queue.setOnline(true)    everything waiting goes now
 *   auto-save off    ──▶ queue.setPaused(true)    pill: "N unsaved", Save sends them (D31)
 *   beforeunload     ──▶ warn while anything is pending or rejected
 *   unmount          ──▶ queue.stop(): debounced edits go now, no more retry timers
 * ```
 *
 * ## Why the auto-save preference lives in `localStorage`
 *
 * It is a habit, not board data: someone who wants to think in drafts and save deliberately
 * wants that tomorrow too, and a preference that quietly resets on every reload is one the
 * owner has to remember to set. It is per browser, like the rail width on the blog editor,
 * and the default is auto-save ON - the setting only ever moves in the direction the owner
 * chose, and the dangerous direction (holding writes) is the one they have to ask for and
 * the one the top bar keeps saying out loud.
 *
 * ## Why the queue is a plain class, created once
 *
 * Its whole value is in rules that are easy to get subtly wrong - a child racing its frame, a
 * deleted card being recreated by a late retry - and those are tested in
 * `tests/unit/whiteboard-save-queue.test.ts` with a fake clock and a fake network. Keeping it
 * free of React is what makes that possible; this hook is only the wiring.
 *
 * ## Why `beforeunload` counts rejected edits too
 *
 * A 4xx is permanent - the queue has already let go of it - but the change is still only on
 * this canvas. Closing the tab would lose it exactly as surely as a pending write.
 */
const AUTO_SAVE_STORAGE_KEY = 'wb-auto-save'

function storedAutoSave(): boolean {
  try {
    // Only an explicit "off" turns it off: an unreadable or missing value means the default.
    return window.localStorage.getItem(AUTO_SAVE_STORAGE_KEY) !== 'off'
  } catch {
    return true
  }
}

export function useSaveQueue({
  boardId,
  rejectedCount,
}: {
  boardId: string
  rejectedCount: number
}) {
  // Bound to the board it was made for (D32): the page remounts for another board, so a
  // queue never outlives the canvas whose writes it holds.
  const [queue] = useState(
    () => new SaveQueue({ send: op => sendSaveOpApi(op, boardId) })
  )

  const [status, setStatus] = useState<QueueStatus>(() => queue.status())
  const [autoSave, setAutoSave] = useState(storedAutoSave)

  useEffect(() => {
    queue.setPaused(!autoSave)
    try {
      window.localStorage.setItem(
        AUTO_SAVE_STORAGE_KEY,
        autoSave ? 'on' : 'off'
      )
    } catch {
      // A browser with storage blocked keeps the setting for this session only.
    }
  }, [autoSave, queue])

  const saveNow = useCallback(() => queue.saveNow(), [queue])

  // Leaving the page stops the timers (no retries in a tab that moved on); see `stop`.
  useEffect(() => {
    queue.start()
    return () => queue.stop()
  }, [queue])

  useEffect(() => {
    const goOnline = () => queue.setOnline(true)
    const goOffline = () => queue.setOnline(false)
    if (typeof navigator !== 'undefined' && navigator.onLine === false)
      queue.setOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [queue])

  const unsaved = status.pending > 0 || rejectedCount > 0
  useEffect(() => {
    if (!unsaved) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      // Chrome still requires returnValue to be set for the prompt to show.
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [unsaved])

  return { queue, status, setStatus, autoSave, setAutoSave, saveNow }
}
